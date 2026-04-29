import { afterAll, beforeAll, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MAX_PATCH_BYTES,
  validateRequest,
  type EditToolRequest,
  type ValidationContext,
} from "./common.js";

const REPO_ROOT = "/tmp/meta-edit-test-repo";
const ctx: ValidationContext = { repoRoot: REPO_ROOT };

function makePatch(file: string, isCreation = false, isDeletion = false): string {
  if (isCreation) {
    return `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,1 @@\n+hello\n`;
  }
  if (isDeletion) {
    return `--- a/${file}\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-hello\n`;
  }
  return `--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,1 @@\n-foo\n+bar\n`;
}

function baseRequest(overrides: Partial<EditToolRequest> = {}): EditToolRequest {
  return {
    target_file: "src/foo.ts",
    patch: makePatch("src/foo.ts"),
    rationale: "Tighten boundary check to avoid off-by-one.",
    risk_level: "medium",
    test_files: ["tests/foo.test.ts"],
    ...overrides,
  };
}

describe("validateRequest", () => {
  describe("rationale", () => {
    it("rejects empty rationale", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ rationale: "   " }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("rationale"))).toBe(true);
      }
    });
  });

  describe("test_files cardinality", () => {
    it("rejects empty test_files for tools that require them", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ test_files: [] }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) => w.includes("test_files must be non-empty")),
        ).toBe(true);
      }
    });

    it("allows empty test_files for edit_refactor_only", () => {
      const r = validateRequest(
        "edit_refactor_only",
        baseRequest({ test_files: [] }),
        ctx,
      );
      expect(r.ok).toBe(true);
    });

    it("requires test_files to be empty for edit_test_only_change", () => {
      const r = validateRequest(
        "edit_test_only_change",
        baseRequest({
          target_file: "tests/foo.test.ts",
          patch: makePatch("tests/foo.test.ts"),
          test_files: ["tests/foo.test.ts"],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) =>
            w.includes("test_files must be empty for edit_test_only_change"),
          ),
        ).toBe(true);
      }
    });

    it("accepts edit_test_only_change with empty test_files and target_file-only patch", () => {
      const r = validateRequest(
        "edit_test_only_change",
        baseRequest({
          target_file: "tests/foo.test.ts",
          patch: makePatch("tests/foo.test.ts"),
          test_files: [],
        }),
        ctx,
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("path safety", () => {
    it("rejects absolute target_file", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ target_file: "/etc/passwd" }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("absolute"))).toBe(true);
      }
    });

    it("rejects ../ traversal", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ target_file: "../outside.ts" }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("escapes repository root"))).toBe(
          true,
        );
      }
    });

    it("rejects edits inside .meta-edit/state/", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          target_file: ".meta-edit/state/edits.jsonl",
          patch: makePatch(".meta-edit/state/edits.jsonl"),
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("protected"))).toBe(true);
      }
    });

    it("rejects edits inside .meta-edit/tmp/", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          target_file: ".meta-edit/tmp/scratch.txt",
          patch: makePatch(".meta-edit/tmp/scratch.txt"),
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("protected"))).toBe(true);
      }
    });

    it("rejects target_file aliasing into protected path via traversal", () => {
      const aliased = "src/../.meta-edit/state/edits.jsonl";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          target_file: aliased,
          patch: makePatch(aliased),
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes("protected") && w.includes("resolves"),
          ),
        ).toBe(true);
      }
    });

    it("rejects patch-internal path aliasing into protected path via traversal", () => {
      const innerAlias = "tests/../.meta-edit/tmp/scratch.txt";
      const aliasedPatch =
        `--- a/${innerAlias}\n+++ b/${innerAlias}\n@@ -1,1 +1,1 @@\n-x\n+y\n`;
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: aliasedPatch }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes("protected") && w.includes("resolves"),
          ),
        ).toBe(true);
      }
    });
  });

  describe("modify-only enforcement", () => {
    it("rejects file creation", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: makePatch("src/foo.ts", true, false) }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("creation"))).toBe(true);
      }
    });

    it("rejects file deletion", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: makePatch("src/foo.ts", false, true) }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("deletion"))).toBe(true);
      }
    });

    it("rejects rename", () => {
      const renamePatch =
        "--- a/src/foo.ts\n+++ b/src/bar.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar\n";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: renamePatch }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("rename"))).toBe(true);
      }
    });
  });

  describe("patch scope", () => {
    it("rejects patch touching files outside target_file + test_files", () => {
      const multiFilePatch =
        "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar\n" +
        "--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: multiFilePatch }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) => w.includes('"src/other.ts"') && w.includes("scope")),
        ).toBe(true);
      }
    });

    it("accepts patch touching target_file and listed test_files", () => {
      const multiFilePatch =
        "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar\n" +
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: multiFilePatch }),
        ctx,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.touchedFiles.sort()).toEqual(
          ["src/foo.ts", "tests/foo.test.ts"].sort(),
        );
      }
    });

    it("rejects edit_test_only_change patch touching files other than target_file", () => {
      const multiFilePatch =
        "--- a/tests/foo.test.ts\n+++ b/tests/foo.test.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar\n" +
        "--- a/tests/bar.test.ts\n+++ b/tests/bar.test.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n";
      const r = validateRequest(
        "edit_test_only_change",
        baseRequest({
          target_file: "tests/foo.test.ts",
          patch: multiFilePatch,
          test_files: [],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes('"tests/bar.test.ts"') && w.includes("scope"),
          ),
        ).toBe(true);
      }
    });
  });

  describe("patch parsing", () => {
    it("rejects unparseable patch", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: "this is not a unified diff" }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) =>
              w.includes("could not be parsed") ||
              w.includes("did not contain any file headers") ||
              w.includes("no file header") ||
              w.includes("no hunks"),
          ),
        ).toBe(true);
      }
    });
  });

  describe("happy path", () => {
    it("accepts a well-formed boundary condition edit", () => {
      const r = validateRequest("edit_boundary_condition", baseRequest(), ctx);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.touchedFiles).toEqual(["src/foo.ts"]);
      }
    });
  });

  describe("diff prefix conventions", () => {
    it("accepts c/d-prefixed unified diffs as modify-only", () => {
      const cdPatch =
        "--- c/src/foo.ts\n+++ d/src/foo.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar\n";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: cdPatch }),
        ctx,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.touchedFiles).toEqual(["src/foo.ts"]);
      }
    });

    it("accepts no-prefix unified diffs", () => {
      const noPrefix =
        "--- src/foo.ts\n+++ src/foo.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar\n";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: noPrefix }),
        ctx,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.touchedFiles).toEqual(["src/foo.ts"]);
      }
    });
  });

  describe("git extended headers", () => {
    it("rejects a patch carrying `rename from` / `rename to`", () => {
      const renamePatch =
        "diff --git a/src/foo.ts b/src/bar.ts\n" +
        "similarity index 95%\n" +
        "rename from src/foo.ts\n" +
        "rename to src/bar.ts\n" +
        "--- a/src/foo.ts\n+++ b/src/bar.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar\n";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: renamePatch }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) => w.includes("rename from")),
        ).toBe(true);
      }
    });

    it("rejects a patch carrying `new file mode`", () => {
      const newFile =
        "diff --git a/src/new.ts b/src/new.ts\n" +
        "new file mode 100644\n" +
        "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+content\n";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: newFile }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) => w.includes("new file mode")),
        ).toBe(true);
      }
    });

    it("rejects a patch carrying `deleted file mode`", () => {
      const deletedFile =
        "diff --git a/src/old.ts b/src/old.ts\n" +
        "deleted file mode 100644\n" +
        "--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-content\n";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: deletedFile }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) => w.includes("deleted file mode")),
        ).toBe(true);
      }
    });

    const headerCases: Array<[string, string]> = [
      ["copy from", "copy from src/foo.ts\n"],
      ["copy to", "copy to src/bar.ts\n"],
      ["similarity index", "similarity index 100%\n"],
      ["dissimilarity index", "dissimilarity index 100%\n"],
    ];
    for (const [headerName, headerLine] of headerCases) {
      it(`rejects a patch carrying \`${headerName}\``, () => {
        const patch =
          `diff --git a/src/foo.ts b/src/foo.ts\n` +
          headerLine +
          `--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-foo\n+bar\n`;
        const r = validateRequest(
          "edit_boundary_condition",
          baseRequest({ patch }),
          ctx,
        );
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.warnings.some((w) => w.includes(headerName))).toBe(true);
        }
      });
    }
  });

  describe("input hardening (CVE-2026-24001 defense)", () => {
    it("rejects patches containing a NUL byte", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          patch: "--- a/foo.ts\n+++ b/foo.ts \n@@ -1,1 +1,1 @@\n-x\n+y\n",
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.warnings.some((w) => w.includes("NUL byte"))).toBe(true);
      }
    });

    it("rejects patches larger than the size limit before parsing", () => {
      const bigPatch = "x".repeat(MAX_PATCH_BYTES + 1);
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ patch: bigPatch }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) => w.includes("exceeds the") && w.includes("byte limit")),
        ).toBe(true);
      }
    });
  });
});

describe("validateRequest with real filesystem (symlink)", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-test-"));
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    fs.symlinkSync(
      path.join(tmpRoot, ".meta-edit", "state"),
      path.join(tmpRoot, "src", "state-link"),
    );
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("rejects target_file that traverses a symlink into protected dir", () => {
    const aliased = "src/state-link/edits.jsonl";
    const patch =
      `--- a/${aliased}\n+++ b/${aliased}\n@@ -1,1 +1,1 @@\n-x\n+y\n`;
    const r = validateRequest(
      "edit_boundary_condition",
      {
        target_file: aliased,
        patch,
        rationale: "should be rejected",
        risk_level: "medium",
        test_files: ["tests/foo.test.ts"],
      },
      { repoRoot: tmpRoot },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.warnings.some(
          (w) => w.includes("protected") || w.includes("escapes"),
        ),
      ).toBe(true);
    }
  });

  it("rejects patch-internal path that traverses a symlink into protected dir", () => {
    const innerAlias = "src/state-link/edits.jsonl";
    const aliasedPatch =
      `--- a/${innerAlias}\n+++ b/${innerAlias}\n@@ -1,1 +1,1 @@\n-x\n+y\n`;
    const r = validateRequest(
      "edit_boundary_condition",
      {
        target_file: "src/foo.ts",
        patch: aliasedPatch,
        rationale: "should be rejected via patch path",
        risk_level: "medium",
        test_files: ["tests/foo.test.ts"],
      },
      { repoRoot: tmpRoot },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.warnings.some(
          (w) => w.includes("protected") || w.includes("escapes"),
        ),
      ).toBe(true);
    }
  });

  it("fails closed when realpath cannot canonicalize (symlink loop)", () => {
    // Self-referential symlink: realpath returns ELOOP. We must reject
    // rather than fall back to the lexical form.
    const loopPath = path.join(tmpRoot, "loop");
    fs.symlinkSync(loopPath, loopPath);
    try {
      const r = validateRequest(
        "edit_boundary_condition",
        {
          target_file: "loop",
          patch: "--- a/loop\n+++ b/loop\n@@ -1,1 +1,1 @@\n-x\n+y\n",
          rationale: "should be rejected because realpath cannot resolve",
          risk_level: "medium",
          test_files: ["tests/foo.test.ts"],
        },
        { repoRoot: tmpRoot },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) =>
              w.includes("could not be canonicalized") ||
              w.includes("realpath"),
          ),
        ).toBe(true);
      }
    } finally {
      fs.unlinkSync(loopPath);
    }
  });
});

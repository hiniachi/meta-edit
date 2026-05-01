import { afterAll, beforeAll, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MAX_CHANGE_BYTES,
  validateRequest,
  type Change,
  type EditToolRequest,
  type ValidationContext,
} from "./common.js";
import { TOOL_NAMES } from "./descriptions.js";

const REPO_ROOT = "/tmp/meta-edit-test-repo";
const ctx: ValidationContext = { repoRoot: REPO_ROOT };

function makeChange(
  file: string,
  oldContent = "foo\n",
  newContent = "bar\n",
): Change {
  return { file, old_content: oldContent, new_content: newContent };
}

function baseRequest(
  overrides: Partial<EditToolRequest> = {},
): EditToolRequest {
  return {
    target_file: "src/foo.ts",
    rationale: "Tighten boundary check to avoid off-by-one.",
    risk_level: "medium",
    test_files: ["tests/foo.test.ts"],
    changes: [makeChange("src/foo.ts")],
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
          changes: [makeChange("tests/foo.test.ts")],
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

    it("accepts edit_test_only_change with empty test_files and target_file-only changes", () => {
      const r = validateRequest(
        "edit_test_only_change",
        baseRequest({
          target_file: "tests/foo.test.ts",
          changes: [makeChange("tests/foo.test.ts")],
          test_files: [],
        }),
        ctx,
      );
      expect(r.ok).toBe(true);
    });

    it("allows empty test_files for edit_docs_only", () => {
      const r = validateRequest(
        "edit_docs_only",
        baseRequest({
          target_file: "OBSERVED-FAILURES.md",
          changes: [makeChange("OBSERVED-FAILURES.md")],
          test_files: [],
        }),
        ctx,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.touchedFiles).toEqual(["OBSERVED-FAILURES.md"]);
      }
    });

    it("does not enforce empty test_files for edit_docs_only (test_files may be empty, per SPEC §4)", () => {
      const r = validateRequest(
        "edit_docs_only",
        baseRequest({
          target_file: "README.md",
          changes: [makeChange("README.md")],
          test_files: ["tests/foo.test.ts"],
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
        expect(
          r.warnings.some((w) => w.includes("escapes repository root")),
        ).toBe(true);
      }
    });

    it("rejects edits inside .meta-edit/state/", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          target_file: ".meta-edit/state/edits.jsonl",
          changes: [makeChange(".meta-edit/state/edits.jsonl")],
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
          changes: [makeChange(".meta-edit/tmp/scratch.txt")],
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
          changes: [makeChange(aliased)],
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

    it("rejects change.file aliasing into protected path via traversal", () => {
      const innerAlias = "tests/../.meta-edit/tmp/scratch.txt";
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          changes: [makeChange("src/foo.ts"), makeChange(innerAlias)],
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
  });

  describe("changes shape", () => {
    it("rejects an empty changes array via zod (the .min(1) refinement)", () => {
      // The schema enforces .min(1); but validateRequest is called with an
      // already-typed object so we exercise the in-handler defensive
      // re-check via a cast.
      const req = baseRequest({ changes: [] as unknown as EditToolRequest["changes"] });
      const r = validateRequest("edit_boundary_condition", req, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) => w.includes("changes") && w.includes("at least one")),
        ).toBe(true);
      }
    });

    it("rejects more than MAX_CHANGES_PER_REQUEST entries", () => {
      // Defensive cap: too many changes per request would force a
      // large `Buffer.byteLength` sweep + `createTwoFilesPatch`
      // synthesis. The cap is 100; 101 must be rejected.
      const tooMany = Array.from({ length: 101 }, (_, i) =>
        makeChange(`src/foo.ts`, `o${i}`, `n${i}`),
      );
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({ changes: tooMany }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes("entries") && w.includes("entry limit"),
          ),
        ).toBe(true);
      }
    });

    it("rejects total payload over MAX_CHANGE_BYTES", () => {
      const big = "x".repeat(MAX_CHANGE_BYTES);
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          changes: [makeChange("src/foo.ts", "y", big)],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes("exceeds the") && w.includes("byte limit"),
          ),
        ).toBe(true);
      }
    });

    it("rejects NUL byte in old_content", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          changes: [makeChange("src/foo.ts", "before\0after", "after")],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes("old_content") && w.includes("NUL"),
          ),
        ).toBe(true);
      }
    });

    it("rejects a no-op change (old_content === new_content)", () => {
      // Codex GitHub bot review on PR #29 (P2): pre-PR-D the jsdiff
      // parser rejected zero-hunk patches, so no-op edits never
      // reached apply. Under the content-pair shape we must enforce
      // the same posture explicitly — otherwise stage+rename runs
      // for semantically empty edits and bumps mtime / inode for
      // downstream watchers and audit consumers.
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          changes: [makeChange("src/foo.ts", "same\n", "same\n")],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes("no-op") && w.includes("src/foo.ts"),
          ),
        ).toBe(true);
      }
    });

    it("rejects NUL byte in new_content", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          changes: [makeChange("src/foo.ts", "before", "after\0and-more")],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes("new_content") && w.includes("NUL"),
          ),
        ).toBe(true);
      }
    });
  });

  describe("scope", () => {
    it("rejects a change touching files outside target_file + test_files", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          changes: [
            makeChange("src/foo.ts"),
            makeChange("src/other.ts", "x", "y"),
          ],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes('"src/other.ts"') && w.includes("scope"),
          ),
        ).toBe(true);
      }
    });

    it("rejects a request with multiple changes targeting the same canonical", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          changes: [
            makeChange("src/foo.ts", "alpha", "beta"),
            makeChange("src/foo.ts", "beta", "gamma"),
          ],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes("multiple entries") && w.includes("src/foo.ts"),
          ),
        ).toBe(true);
      }
    });

    it("accepts a change touching target_file and listed test_files", () => {
      const r = validateRequest(
        "edit_boundary_condition",
        baseRequest({
          changes: [
            makeChange("src/foo.ts"),
            makeChange("tests/foo.test.ts", "old", "new"),
          ],
        }),
        ctx,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.touchedFiles.sort()).toEqual(
          ["src/foo.ts", "tests/foo.test.ts"].sort(),
        );
      }
    });

    it("rejects edit_test_only_change with a change.file other than target_file", () => {
      // For edit_test_only_change, only target_file is in scope; test_files
      // must be empty so a second change is automatically out-of-scope.
      const r = validateRequest(
        "edit_test_only_change",
        baseRequest({
          target_file: "tests/foo.test.ts",
          changes: [
            makeChange("tests/foo.test.ts"),
            makeChange("tests/bar.test.ts", "x", "y"),
          ],
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

    it("accepts edit_docs_only with target_file plus declared test_files changes", () => {
      const r = validateRequest(
        "edit_docs_only",
        baseRequest({
          target_file: "README.md",
          changes: [
            makeChange("README.md"),
            makeChange("tests/foo.test.ts", "x", "y"),
          ],
          test_files: ["tests/foo.test.ts"],
        }),
        ctx,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.touchedFiles.sort()).toEqual(
          ["README.md", "tests/foo.test.ts"].sort(),
        );
      }
    });

    it("rejects edit_docs_only changes touching files outside target_file + test_files", () => {
      const r = validateRequest(
        "edit_docs_only",
        baseRequest({
          target_file: "README.md",
          changes: [
            makeChange("README.md"),
            makeChange("src/foo.ts", "x", "y"),
          ],
          test_files: [],
        }),
        ctx,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some(
            (w) => w.includes('"src/foo.ts"') && w.includes("scope"),
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
        expect(r.changes.length).toBe(1);
        expect(r.changes[0]?.canonical).toBe("src/foo.ts");
        expect(r.changes[0]?.oldContent).toBe("foo\n");
        expect(r.changes[0]?.newContent).toBe("bar\n");
      }
    });

    it("accepts the new shape for every one of the eighteen edit_* tools", () => {
      // Smoke test: validate each tool's typical request shape passes.
      // For tools requiring test_files, use the default test_files entry;
      // for edit_test_only_change, target only itself; for refactor /
      // docs, no test_files.
      for (const name of TOOL_NAMES) {
        let req: EditToolRequest;
        if (name === "edit_test_only_change") {
          req = baseRequest({
            target_file: "tests/foo.test.ts",
            changes: [makeChange("tests/foo.test.ts")],
            test_files: [],
          });
        } else if (name === "edit_refactor_only" || name === "edit_docs_only") {
          req = baseRequest({ test_files: [] });
        } else {
          req = baseRequest();
        }
        const r = validateRequest(name, req, ctx);
        expect(r.ok).toBe(true);
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
    const r = validateRequest(
      "edit_boundary_condition",
      {
        target_file: aliased,
        rationale: "should be rejected",
        risk_level: "medium",
        test_files: ["tests/foo.test.ts"],
        changes: [makeChange(aliased)],
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

  it("rejects change.file that traverses a symlink into protected dir", () => {
    const innerAlias = "src/state-link/edits.jsonl";
    const r = validateRequest(
      "edit_boundary_condition",
      {
        target_file: "src/foo.ts",
        rationale: "should be rejected via change path",
        risk_level: "medium",
        test_files: ["tests/foo.test.ts"],
        changes: [makeChange("src/foo.ts"), makeChange(innerAlias)],
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
    const loopPath = path.join(tmpRoot, "loop");
    fs.symlinkSync(loopPath, loopPath);
    try {
      const r = validateRequest(
        "edit_boundary_condition",
        {
          target_file: "loop",
          rationale: "should be rejected because realpath cannot resolve",
          risk_level: "medium",
          test_files: ["tests/foo.test.ts"],
          changes: [makeChange("loop")],
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

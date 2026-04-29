import { describe, it, expect } from "bun:test";
import {
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
});

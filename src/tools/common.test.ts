// Schema-level tests for the v0.2 / Case C EditToolRequest. The handler-
// level integration tests (handler.test.ts) exercise the full pipeline; this
// file covers validateRequest in isolation so a regression in the schema
// surface (cardinality, path safety, server-computed before_sha256) lights
// up here first.
//
// v0.2.1: client-supplied sha256 fields were removed. The server now reads
// disk and computes before_sha256 itself; there is no after_sha256 anywhere.

import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  EditToolRequestSchema,
  MAX_ADDITIONAL_FILES,
  SHA256_EMPTY,
  sha256Hex,
  validateRequest,
  type EditToolRequest,
  type ValidationContext,
} from "./common.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-common-"));
  fs.mkdirSync(path.join(tmpRoot, ".git"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function ctx(): ValidationContext {
  return { repoRoot: tmpRoot };
}

describe("EditToolRequestSchema — zod surface", () => {
  it("accepts a well-formed request without additional_files", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      test_files: ["t.test.ts"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown extra fields (strict)", () => {
    // v0.2.1: before_sha256 / after_sha256 must NOT be accepted any longer.
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      test_files: [],
      before_sha256: "a".repeat(64),
    });
    expect(r.success).toBe(false);
  });

  it("rejects after_sha256 even when target shape is otherwise valid", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      test_files: [],
      after_sha256: "b".repeat(64),
    });
    expect(r.success).toBe(false);
  });

  it("rejects additional_files with > MAX_ADDITIONAL_FILES entries", () => {
    const af = [];
    for (let i = 0; i <= MAX_ADDITIONAL_FILES; i++) {
      af.push({ file: `f${i}` });
    }
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "low",
      test_files: [],
      additional_files: af,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown risk_level", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "extreme",
      test_files: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects additional_files entries carrying sha256 fields (strict)", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "docs/a.md",
      rationale: "ok",
      risk_level: "low",
      test_files: [],
      additional_files: [
        {
          file: "docs/b.md",
          before_sha256: "a".repeat(64),
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("validateRequest — disk + path-safety", () => {
  function modifyReq(overrides: Partial<EditToolRequest> = {}): EditToolRequest {
    return {
      target_file: "src/foo.ts",
      rationale: "fix",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
      ...overrides,
    };
  }

  it("rejects an absolute target_file", () => {
    const r = validateRequest("edit_boundary_condition",
      modifyReq({ target_file: "/etc/passwd" }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("absolute"))).toBe(true);
    }
  });

  it("rejects `..` traversal in target_file", () => {
    const r = validateRequest("edit_boundary_condition",
      modifyReq({ target_file: "src/../escape.ts" }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("traversal"))).toBe(true);
    }
  });

  it("rejects target_file resolving to a protected path", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    writeFile(".meta-edit/state/x.txt", "");
    const r = validateRequest("edit_boundary_condition",
      modifyReq({
        target_file: ".meta-edit/state/x.txt",
      }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("protected"))).toBe(true);
    }
  });

  it("rejects a modify-only call when target_file does not exist", () => {
    const r = validateRequest("edit_boundary_condition",
      modifyReq({ target_file: "src/missing.ts" }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("does not exist"))).toBe(true);
    }
  });

  it("rejects edit_create_file when target_file already exists", () => {
    writeFile("src/foo.ts", "x\n");
    const r = validateRequest("edit_create_file", modifyReq(), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("already exists"))).toBe(true);
    }
  });

  it("succeeds on a valid edit_create_file declaration with sha256(\"\") binding", () => {
    const r = validateRequest("edit_create_file",
      modifyReq({
        target_file: "src/new.ts",
      }), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.primaryBinding.canonical).toBe("src/new.ts");
      expect(r.primaryBinding.before_sha256).toBe(SHA256_EMPTY);
      expect(r.additionalBindings).toEqual([]);
    }
  });

  // v0.2.1 regression-guard: server-computed before_sha256 must fail closed
  // on disk read failures (EISDIR / EACCES / ELOOP). Hook side has the same
  // guarantee covered in raw-edit-policy.test.ts; this pins the issuer side.
  it("rejects modify-only call when target_file is a directory (EISDIR)", () => {
    fs.mkdirSync(path.join(tmpRoot, "src/foo.ts"), { recursive: true });
    const r = validateRequest("edit_boundary_condition", modifyReq(), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // The server's read-and-sha256 path fails closed; the warning should
      // mention either the read failure or "must exist as a regular file".
      expect(
        r.warnings.some(
          (w) => /read|EISDIR|directory|regular file/i.test(w),
        ),
      ).toBe(true);
    }
  });

  it("computes before_sha256 from disk content for a modify-only tool", () => {
    writeFile("src/foo.ts", "hello\n");
    const r = validateRequest("edit_boundary_condition", modifyReq(), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.primaryBinding.canonical).toBe("src/foo.ts");
      expect(r.primaryBinding.before_sha256).toBe(sha256Hex("hello\n"));
    }
  });

  it("rejects additional_files for an SQLite-derived tool", () => {
    writeFile("src/foo.ts", "hello\n");
    writeFile("src/bar.ts", "world\n");
    const r = validateRequest("edit_boundary_condition",
      modifyReq({
        additional_files: [{ file: "src/bar.ts" }],
      }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("additional_files"))).toBe(true);
    }
  });

  it("rejects duplicate canonical paths within additional_files", () => {
    writeFile("docs/a.md", "alpha\n");
    writeFile("docs/b.md", "beta\n");
    const r = validateRequest("edit_docs_only", {
      target_file: "docs/a.md",
      rationale: "...",
      risk_level: "low",
      test_files: [],
      additional_files: [
        { file: "docs/b.md" },
        { file: "docs/b.md" },
      ],
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("duplicate"))).toBe(true);
    }
  });

  it("rejects when target_file appears again as an additional_files entry", () => {
    writeFile("docs/a.md", "alpha\n");
    const r = validateRequest("edit_docs_only", {
      target_file: "docs/a.md",
      rationale: "...",
      risk_level: "low",
      test_files: [],
      additional_files: [{ file: "docs/a.md" }],
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("duplicate"))).toBe(true);
    }
  });

  it("succeeds for edit_test_only_change with empty test_files", () => {
    writeFile("tests/foo.test.ts", "describe('foo', ()=>{})\n");
    const r = validateRequest("edit_test_only_change", {
      target_file: "tests/foo.test.ts",
      rationale: "tighten the assertion",
      risk_level: "low",
      test_files: [],
    }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.primaryBinding.before_sha256).toBe(
        sha256Hex("describe('foo', ()=>{})\n"),
      );
    }
  });

  it("rejects edit_test_only_change with non-empty test_files", () => {
    writeFile("tests/foo.test.ts", "x\n");
    const r = validateRequest("edit_test_only_change", {
      target_file: "tests/foo.test.ts",
      rationale: "...",
      risk_level: "low",
      test_files: ["tests/foo.test.ts"],
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("test_files"))).toBe(true);
    }
  });

  it("computes before_sha256 server-side for each additional_files entry", () => {
    writeFile("docs/a.md", "alpha\n");
    writeFile("docs/b.md", "beta\n");
    writeFile("docs/c.md", "gamma\n");
    const r = validateRequest("edit_docs_only", {
      target_file: "docs/a.md",
      rationale: "rename product across the docs",
      risk_level: "low",
      test_files: [],
      additional_files: [{ file: "docs/b.md" }, { file: "docs/c.md" }],
    }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.primaryBinding.before_sha256).toBe(sha256Hex("alpha\n"));
      const byFile = new Map(
        r.additionalBindings.map((b) => [b.canonical, b.before_sha256]),
      );
      expect(byFile.get("docs/b.md")).toBe(sha256Hex("beta\n"));
      expect(byFile.get("docs/c.md")).toBe(sha256Hex("gamma\n"));
    }
  });
});

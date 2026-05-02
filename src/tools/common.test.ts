// Schema-level tests for the v0.2 / Case C EditToolRequest. The handler-
// level integration tests (handler.test.ts) exercise the full pipeline; this
// file covers validateRequest in isolation so a regression in the schema
// surface (sha256 format, cardinality, path safety) lights up here first.

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

const HEX64 = "a".repeat(64);
const HEX64_B = "b".repeat(64);

describe("EditToolRequestSchema — zod surface", () => {
  it("accepts a well-formed request without additional_files", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      test_files: ["t.test.ts"],
      before_sha256: HEX64,
      after_sha256: HEX64_B,
    });
    expect(r.success).toBe(true);
  });

  it("rejects sha256 that is not exactly 64 lowercase hex", () => {
    const tries = ["short", "A".repeat(64), "z".repeat(64), "a".repeat(63)];
    for (const bad of tries) {
      const r = EditToolRequestSchema.safeParse({
        target_file: "src/foo.ts",
        rationale: "ok",
        risk_level: "medium",
        test_files: [],
        before_sha256: bad,
        after_sha256: HEX64_B,
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejects additional_files with > MAX_ADDITIONAL_FILES entries", () => {
    const af = [];
    for (let i = 0; i <= MAX_ADDITIONAL_FILES; i++) {
      af.push({ file: `f${i}`, before_sha256: HEX64, after_sha256: HEX64_B });
    }
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "low",
      test_files: [],
      before_sha256: HEX64,
      after_sha256: HEX64_B,
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
      before_sha256: HEX64,
      after_sha256: HEX64_B,
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
      before_sha256: sha256Hex("hello\n"),
      after_sha256: sha256Hex("hello world\n"),
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
        before_sha256: SHA256_EMPTY,
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
    const r = validateRequest("edit_create_file",
      modifyReq({ before_sha256: SHA256_EMPTY }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("already exists"))).toBe(true);
    }
  });

  it("succeeds on a valid edit_create_file declaration", () => {
    const r = validateRequest("edit_create_file",
      modifyReq({
        target_file: "src/new.ts",
        before_sha256: SHA256_EMPTY,
        after_sha256: sha256Hex("x\n"),
      }), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.primaryBinding.canonical).toBe("src/new.ts");
      expect(r.primaryBinding.before_sha256).toBe(SHA256_EMPTY);
      expect(r.additionalBindings).toEqual([]);
    }
  });

  it("rejects additional_files for an SQLite-derived tool", () => {
    writeFile("src/foo.ts", "hello\n");
    writeFile("src/bar.ts", "world\n");
    const r = validateRequest("edit_boundary_condition",
      modifyReq({
        before_sha256: sha256Hex("hello\n"),
        additional_files: [
          {
            file: "src/bar.ts",
            before_sha256: sha256Hex("world\n"),
            after_sha256: sha256Hex("changed\n"),
          },
        ],
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
      before_sha256: sha256Hex("alpha\n"),
      after_sha256: sha256Hex("alpha2\n"),
      additional_files: [
        {
          file: "docs/b.md",
          before_sha256: sha256Hex("beta\n"),
          after_sha256: sha256Hex("beta2\n"),
        },
        {
          file: "docs/b.md",
          before_sha256: sha256Hex("beta\n"),
          after_sha256: sha256Hex("beta3\n"),
        },
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
      before_sha256: sha256Hex("alpha\n"),
      after_sha256: sha256Hex("alpha2\n"),
      additional_files: [
        {
          file: "docs/a.md",
          before_sha256: sha256Hex("alpha\n"),
          after_sha256: sha256Hex("alpha-other\n"),
        },
      ],
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
      before_sha256: sha256Hex("describe('foo', ()=>{})\n"),
      after_sha256: sha256Hex("describe('foo', () => { it('x',()=>{})})\n"),
    }, ctx());
    expect(r.ok).toBe(true);
  });

  it("rejects edit_test_only_change with non-empty test_files", () => {
    writeFile("tests/foo.test.ts", "x\n");
    const r = validateRequest("edit_test_only_change", {
      target_file: "tests/foo.test.ts",
      rationale: "...",
      risk_level: "low",
      test_files: ["tests/foo.test.ts"],
      before_sha256: sha256Hex("x\n"),
      after_sha256: sha256Hex("y\n"),
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("test_files"))).toBe(true);
    }
  });
});

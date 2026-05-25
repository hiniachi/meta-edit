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
  ExecutionStateSchema,
  MAX_ADDITIONAL_FILES,
  SHA256_EMPTY,
  evaluateAdditionalFiles,
  evaluateKindExecutionStateValidity,
  evaluateKindProvenanceValidity,
  evaluateTargetSpecDerivation,
  rationaleHasArtifactCitation,
  sha256Hex,
  validateRequest,
  type EditToolRequest,
  type Provenance,
  type ValidationContext,
} from "./common.js";
import type { ToolName } from "./descriptions.js";
import {
  TOOLS_REQUIRING_TARGET,
  WORKFLOW_TOOLS,
} from "./descriptions.js";
import {
  makeTmpRoot,
  cleanTmpRoot,
  writeFileIn,
  captureStderr as captureStderrSync,
} from "../test-helpers.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = makeTmpRoot("common");
  fs.mkdirSync(path.join(tmpRoot, ".git"));
});

afterEach(() => {
  cleanTmpRoot(tmpRoot);
});

function writeFile(rel: string, content: string): void {
  writeFileIn(tmpRoot, rel, content);
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
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: ["t.test.ts"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a request missing execution_state (design §4.1)", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      target: "prod",
      provenance: "direct_observation",
      test_files: ["t.test.ts"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown extra fields (strict)", () => {
    // v0.2.1: before_sha256 / after_sha256 must NOT be accepted any longer.
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      provenance: "direct_observation",
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
      provenance: "direct_observation",
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
      provenance: "direct_observation",
      test_files: [],
      additional_files: af,
    });
    expect(r.success).toBe(false);
  });

  it("rejects requests missing the v0.6.0 provenance field", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      // provenance: omitted
      test_files: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // Zod's required-field error mentions the missing field by name.
      const msg = JSON.stringify(r.error.issues);
      expect(msg).toContain("provenance");
    }
  });

  it("rejects requests with an invalid provenance value", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      provenance: "made-up-source",
      test_files: [],
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
      provenance: "direct_observation",
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

describe("EditToolRequestSchema — opencode JSON-string array coercion", () => {
  // opencode v1.14.x mis-marshals empty `[]` array arguments as the
  // JSON-string `"[]"`. The schema accepts either form; tests pin the
  // coercion behavior so a future zod / refactor doesn't silently drop
  // it. See issues/2026-05-04-1700-opencode-empty-test-files-array-mismarshalled.md.

  const captureStderr = captureStderrSync;

  it("coerces test_files: '[]' (string) into []", () => {
    let parsed!: ReturnType<typeof EditToolRequestSchema.safeParse>;
    const stderr = captureStderr(() => {
      parsed = EditToolRequestSchema.safeParse({
        target_file: "docs/a.md",
        rationale: "ok",
        risk_level: "low",
        provenance: "direct_observation",
        execution_state: "normal",
        test_files: "[]" as unknown as string[],
      });
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.test_files).toEqual([]);
    }
    expect(stderr).toContain("coerced test_files JSON-string to array");
  });

  it("coerces test_files: '[\"a\"]' (string) into ['a']", () => {
    let parsed!: ReturnType<typeof EditToolRequestSchema.safeParse>;
    captureStderr(() => {
      parsed = EditToolRequestSchema.safeParse({
        target_file: "docs/a.md",
        rationale: "ok",
        risk_level: "low",
        provenance: "direct_observation",
        execution_state: "normal",
        test_files: '["src/foo.test.ts"]' as unknown as string[],
      });
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.test_files).toEqual(["src/foo.test.ts"]);
    }
  });

  it("passes proper test_files arrays through unchanged (no WARN, Claude Code path)", () => {
    let parsed!: ReturnType<typeof EditToolRequestSchema.safeParse>;
    const stderr = captureStderr(() => {
      parsed = EditToolRequestSchema.safeParse({
        target_file: "docs/a.md",
        rationale: "ok",
        risk_level: "low",
        provenance: "direct_observation",
        execution_state: "normal",
        test_files: [],
      });
    });
    expect(parsed.success).toBe(true);
    expect(stderr).toBe("");
  });

  it("rejects non-array, non-JSON-string test_files (e.g. number) with the original Zod error", () => {
    const parsed = EditToolRequestSchema.safeParse({
      target_file: "docs/a.md",
      rationale: "ok",
      risk_level: "low",
      provenance: "direct_observation",
      test_files: 42 as unknown as string[],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects garbage-string test_files (not JSON, not array) with the original Zod error", () => {
    const parsed = EditToolRequestSchema.safeParse({
      target_file: "docs/a.md",
      rationale: "ok",
      risk_level: "low",
      provenance: "direct_observation",
      test_files: "not json" as unknown as string[],
    });
    expect(parsed.success).toBe(false);
  });

  it("coerces additional_files: '[]' as well (symmetric to test_files)", () => {
    let parsed!: ReturnType<typeof EditToolRequestSchema.safeParse>;
    captureStderr(() => {
      parsed = EditToolRequestSchema.safeParse({
        target_file: "docs/a.md",
        rationale: "ok",
        risk_level: "low",
        provenance: "direct_observation",
        execution_state: "normal",
        test_files: [],
        additional_files: "[]" as unknown as { file: string }[],
      });
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.additional_files).toEqual([]);
    }
  });
});

describe("validateRequest — disk + path-safety", () => {
  function modifyReq(overrides: Partial<EditToolRequest> = {}): EditToolRequest {
    return {
      target_file: "src/foo.ts",
      rationale: "fix",
      risk_level: "medium",
      target: "prod",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: ["tests/foo.test.ts"],
      ...overrides,
    };
  }

  it("rejects calls when repoRoot has no .git/.jj sentinel (issue 1530)", () => {
    // Mirrors the production onboarding flow: server booted in a fresh
    // directory, ListTools landed descriptions in agent context, then the
    // agent attempts a typed_edit. validateRequest must surface a clear
    // not_a_repository error rather than letting the call land against
    // an unrelated filesystem location under process.cwd().
    const isolatedTmp = fs.mkdtempSync(
      path.join(os.tmpdir(), "meta-edit-common-norepo-"),
    );
    try {
      const r = validateRequest(
        "edit_boundary_condition",
        modifyReq(),
        { repoRoot: isolatedTmp },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.warnings.some((w) =>
            w.includes("does not appear to be a repository root"),
          ),
        ).toBe(true);
      }
    } finally {
      fs.rmSync(isolatedTmp, { recursive: true, force: true });
    }
  });

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

  it("accepts a declaration against a non-existent target_file, binding before_sha256 = sha256(\"\")", () => {
    const r = validateRequest("edit_boundary_condition",
      modifyReq({ target_file: "src/missing.ts" }), ctx());
    // v0.4.2: a declaration against a not-yet-created file is valid; it
    // binds sha256("") (parity with the hook's ENOENT→"" read). The old
    // "create the empty file first, THEN declare" dance is gone.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.primaryBinding.canonical).toBe("src/missing.ts");
      expect(r.primaryBinding.before_sha256).toBe(SHA256_EMPTY);
    }
  });

  // v0.3.1 removal: edit_create_file is gone. Empty file creation is
  // free at the deny-raw-edit hook level (no MCP declaration). Content
  // fills run in modify mode against the now-empty file via the
  // appropriate type-specific tool. The 5 prior tests that asserted
  // edit_create_file's parent-dir handling, sha256("") binding, and
  // already-exists rejection were dropped — they assumed a tool that
  // no longer exists. Hook-level coverage of the new "free empty
  // Write" path lives in src/hooks/raw-edit-policy.test.ts.

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
    const r = validateRequest("edit_explanation", {
      target_file: "docs/a.md",
      rationale: "...",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
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
    const r = validateRequest("edit_explanation", {
      target_file: "docs/a.md",
      rationale: "...",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: [],
      additional_files: [{ file: "docs/a.md" }],
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("duplicate"))).toBe(true);
    }
  });

  it("succeeds for impl tool with target=test and empty test_files", () => {
    writeFile("tests/foo.test.ts", "describe('foo', ()=>{})\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "tests/foo.test.ts",
      rationale: "tighten the boundary assertion",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
      target: "test",
      test_files: [],
    }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.primaryBinding.before_sha256).toBe(
        sha256Hex("describe('foo', ()=>{})\n"),
      );
    }
  });

  it("rejects impl tool with target=test and non-empty test_files", () => {
    writeFile("tests/foo.test.ts", "x\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "tests/foo.test.ts",
      rationale: "...",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
      target: "test",
      test_files: ["tests/foo.test.ts"],
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("test_files"))).toBe(true);
    }
  });

  it("rejects impl tool with target=prod and missing test_files", () => {
    writeFile("src/foo.ts", "x\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "src/foo.ts",
      rationale: "tighten boundary",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
      target: "prod",
      test_files: [],
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("test_files"))).toBe(true);
    }
  });

  it("rejects impl tool without target field", () => {
    writeFile("src/foo.ts", "x\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "src/foo.ts",
      rationale: "tighten boundary",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: ["tests/foo.test.ts"],
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("target"))).toBe(true);
    }
  });

  it("rejects edit_explanation when target field is provided", () => {
    writeFile("docs/a.md", "x\n");
    const r = validateRequest("edit_explanation", {
      target_file: "docs/a.md",
      rationale: "doc tweak",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
      target: "prod",
      test_files: [],
    }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("target"))).toBe(true);
    }
  });

  it("succeeds for edit_cosmetic with target=prod and empty test_files", () => {
    writeFile("src/foo.ts", "x\n");
    const r = validateRequest("edit_cosmetic", {
      target_file: "src/foo.ts",
      rationale: "reformat trailing whitespace",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
      target: "prod",
      test_files: [],
    }, ctx());
    expect(r.ok).toBe(true);
  });

  it("records execution_state_repeating_failure for an impl tool in repeating_failure", () => {
    const res = validateRequest(
      "edit_boundary_condition",
      modifyReq({ execution_state: "repeating_failure" }),
      ctx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(
        res.auditWarnings.some((w) => w.code === "execution_state_repeating_failure"),
      ).toBe(true);
    }
  });

  it("computes before_sha256 server-side for each additional_files entry", () => {
    writeFile("docs/a.md", "alpha\n");
    writeFile("docs/b.md", "beta\n");
    writeFile("docs/c.md", "gamma\n");
    const r = validateRequest("edit_explanation", {
      target_file: "docs/a.md",
      rationale: "rename product across the docs",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
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

// =====================================================================
// v0.6.0 kind × provenance matrices (RFC §3.3.x)
// =====================================================================
//
// These tests are the spec, in the sense of CLAUDE.md §4: the
// validation matrices in common.ts mirror the tables in
// docs/SPEC.md §3.3 / docs/plan/docs-kind-subdivision-and-provenance/
// rfc.md §3.3. Drift in either side trips an assertion here.

describe("evaluateKindProvenanceValidity (RFC §3.3.1 / §3.3.3)", () => {
  const ALL_PROVENANCES: Provenance[] = [
    "user_confirmed",
    "accepted_artifact",
    "direct_observation",
    "inference",
    "speculation",
  ];

  it("edit_cosmetic accepts user_confirmed / accepted_artifact / direct_observation only", () => {
    expect(evaluateKindProvenanceValidity("edit_cosmetic", "user_confirmed")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_cosmetic", "accepted_artifact")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_cosmetic", "direct_observation")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_cosmetic", "inference")).toBe("reject");
    expect(evaluateKindProvenanceValidity("edit_cosmetic", "speculation")).toBe("reject");
  });

  it("edit_decision rejects inference / speculation", () => {
    expect(evaluateKindProvenanceValidity("edit_decision", "user_confirmed")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_decision", "accepted_artifact")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_decision", "direct_observation")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_decision", "inference")).toBe("reject");
    expect(evaluateKindProvenanceValidity("edit_decision", "speculation")).toBe("reject");
  });

  it("edit_explanation rejects speculation, warns on inference", () => {
    expect(evaluateKindProvenanceValidity("edit_explanation", "user_confirmed")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_explanation", "accepted_artifact")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_explanation", "direct_observation")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_explanation", "inference")).toBe("warn");
    expect(evaluateKindProvenanceValidity("edit_explanation", "speculation")).toBe("reject");
  });

  it("edit_observation warns on inference, accepts the rest", () => {
    expect(evaluateKindProvenanceValidity("edit_observation", "user_confirmed")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_observation", "accepted_artifact")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_observation", "direct_observation")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_observation", "inference")).toBe("warn");
    expect(evaluateKindProvenanceValidity("edit_observation", "speculation")).toBe("accept");
  });

  it("edit_progress and edit_proposal accept every provenance", () => {
    for (const prov of ALL_PROVENANCES) {
      expect(evaluateKindProvenanceValidity("edit_progress", prov)).toBe("accept");
      expect(evaluateKindProvenanceValidity("edit_proposal", prov)).toBe("accept");
    }
  });

  it("all 14 impl SQLite-derived tools accept every provenance (no rejects, no warns)", () => {
    const impl: ToolName[] = [
      "edit_boundary_condition",
      "edit_boolean_condition",
      "edit_state_transition",
      "edit_db_schema",
      "edit_data_migration",
      "edit_api_contract",
      "edit_serialization",
      "edit_error_handling",
      "edit_retry_timeout",
      "edit_concurrency",
      "edit_external_side_effect",
      "edit_cache_invalidation",
      "edit_permission_logic",
      "edit_dependency_config",
    ];
    for (const kind of impl) {
      for (const prov of ALL_PROVENANCES) {
        expect(evaluateKindProvenanceValidity(kind, prov)).toBe("accept");
      }
    }
  });

  it("edit_policy_change accepts confirmed sources and rejects inference / speculation", () => {
    // policy bytes must trace back to a confirmed source; an
    // inference- or speculation-grade policy change is a contradiction
    // in terms (and would let unverified opinion become operating
    // procedure for the next session).
    expect(evaluateKindProvenanceValidity("edit_policy_change", "user_confirmed")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_policy_change", "accepted_artifact")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_policy_change", "direct_observation")).toBe("accept");
    expect(evaluateKindProvenanceValidity("edit_policy_change", "inference")).toBe("reject");
    expect(evaluateKindProvenanceValidity("edit_policy_change", "speculation")).toBe("reject");
  });
});

describe("evaluateAdditionalFiles (RFC §3.3.2)", () => {
  it("edit_progress rejects in every cell", () => {
    const provs: Provenance[] = [
      "user_confirmed",
      "accepted_artifact",
      "direct_observation",
      "inference",
      "speculation",
    ];
    for (const prov of provs) {
      expect(evaluateAdditionalFiles("edit_progress", prov)).toBe("reject");
    }
  });

  it("edit_observation rejects user_confirmed, warns the rest", () => {
    expect(evaluateAdditionalFiles("edit_observation", "user_confirmed")).toBe("reject");
    expect(evaluateAdditionalFiles("edit_observation", "accepted_artifact")).toBe("warn");
    expect(evaluateAdditionalFiles("edit_observation", "direct_observation")).toBe("warn");
    expect(evaluateAdditionalFiles("edit_observation", "inference")).toBe("warn");
    expect(evaluateAdditionalFiles("edit_observation", "speculation")).toBe("warn");
  });

  it("edit_proposal accepts accepted_artifact / speculation, warns the rest", () => {
    expect(evaluateAdditionalFiles("edit_proposal", "user_confirmed")).toBe("warn");
    expect(evaluateAdditionalFiles("edit_proposal", "accepted_artifact")).toBe("accept");
    expect(evaluateAdditionalFiles("edit_proposal", "direct_observation")).toBe("warn");
    expect(evaluateAdditionalFiles("edit_proposal", "inference")).toBe("warn");
    expect(evaluateAdditionalFiles("edit_proposal", "speculation")).toBe("accept");
  });

  it("edit_decision accepts user_confirmed / accepted_artifact, warns direct_observation", () => {
    expect(evaluateAdditionalFiles("edit_decision", "user_confirmed")).toBe("accept");
    expect(evaluateAdditionalFiles("edit_decision", "accepted_artifact")).toBe("accept");
    expect(evaluateAdditionalFiles("edit_decision", "direct_observation")).toBe("warn");
    // inference / speculation are unreachable by §3.3.1 reject, but the
    // matrix returns reject defensively so an additional_files call
    // cannot slip through if §3.3.1 ever loosens.
    expect(evaluateAdditionalFiles("edit_decision", "inference")).toBe("reject");
    expect(evaluateAdditionalFiles("edit_decision", "speculation")).toBe("reject");
  });

  it("edit_explanation accepts user_confirmed / accepted_artifact / direct_observation, warns inference", () => {
    expect(evaluateAdditionalFiles("edit_explanation", "user_confirmed")).toBe("accept");
    expect(evaluateAdditionalFiles("edit_explanation", "accepted_artifact")).toBe("accept");
    expect(evaluateAdditionalFiles("edit_explanation", "direct_observation")).toBe("accept");
    expect(evaluateAdditionalFiles("edit_explanation", "inference")).toBe("warn");
    // speculation is unreachable by §3.3.1 reject; defensive reject here.
    expect(evaluateAdditionalFiles("edit_explanation", "speculation")).toBe("reject");
  });

  it("impl tools and edit_cosmetic reject additional_files at the matrix (the schema-level whitelist already filters them out)", () => {
    const impls: ToolName[] = [
      "edit_cosmetic",
      "edit_boundary_condition",
      "edit_state_transition",
      "edit_api_contract",
    ];
    for (const kind of impls) {
      expect(evaluateAdditionalFiles(kind, "direct_observation")).toBe("reject");
    }
  });

  it("edit_policy_change accepts user_confirmed / accepted_artifact and warns on direct_observation (CLAUDE.md verbatim-mirror batch pattern)", () => {
    expect(evaluateAdditionalFiles("edit_policy_change", "user_confirmed")).toBe("accept");
    expect(evaluateAdditionalFiles("edit_policy_change", "accepted_artifact")).toBe("accept");
    expect(evaluateAdditionalFiles("edit_policy_change", "direct_observation")).toBe("warn");
    // inference / speculation are unreachable by §3.3.1 reject; defensive reject here.
    expect(evaluateAdditionalFiles("edit_policy_change", "inference")).toBe("reject");
    expect(evaluateAdditionalFiles("edit_policy_change", "speculation")).toBe("reject");
  });
});

// =====================================================================
// Task 1.1: execution_state enum + matrix (design §4.1, SPEC §3.4)
// =====================================================================

describe("ExecutionStateSchema (design §4.1)", () => {
  it("accepts the three states", () => {
    for (const s of ["normal", "repeating_failure", "recovery"]) {
      expect(ExecutionStateSchema.safeParse(s).success).toBe(true);
    }
  });
  it("rejects any other value", () => {
    expect(ExecutionStateSchema.safeParse("uncertain").success).toBe(false);
  });
});

describe("evaluateKindExecutionStateValidity (SPEC §3.4)", () => {
  it("warns for every impl tool in repeating_failure", () => {
    for (const k of TOOLS_REQUIRING_TARGET) {
      expect(evaluateKindExecutionStateValidity(k, "repeating_failure")).toBe("warn");
    }
  });
  it("accepts every workflow tool in repeating_failure", () => {
    for (const k of WORKFLOW_TOOLS) {
      expect(evaluateKindExecutionStateValidity(k, "repeating_failure")).toBe("accept");
    }
  });
  it("accepts every tool in normal and recovery", () => {
    for (const k of [...TOOLS_REQUIRING_TARGET, ...WORKFLOW_TOOLS]) {
      expect(evaluateKindExecutionStateValidity(k, "normal")).toBe("accept");
      expect(evaluateKindExecutionStateValidity(k, "recovery")).toBe("accept");
    }
  });
});

describe("evaluateTargetSpecDerivation (SPEC §3.3.5)", () => {
  const SQLITE_KINDS: ToolName[] = TOOLS_REQUIRING_TARGET.filter(
    (k) => k !== "edit_cosmetic",
  );
  const ALL_PROVENANCES: Provenance[] = [
    "user_confirmed",
    "accepted_artifact",
    "direct_observation",
    "inference",
    "speculation",
  ];

  it("accepts every SQLite-derived impl tool with target='prod' regardless of provenance", () => {
    for (const k of SQLITE_KINDS) {
      for (const p of ALL_PROVENANCES) {
        expect(evaluateTargetSpecDerivation(k, "prod", p)).toBe("accept");
      }
    }
  });

  it("accepts target='test' × user_confirmed for every SQLite-derived impl tool", () => {
    for (const k of SQLITE_KINDS) {
      expect(evaluateTargetSpecDerivation(k, "test", "user_confirmed")).toBe("accept");
    }
  });

  it("accepts target='test' × accepted_artifact for every SQLite-derived impl tool", () => {
    for (const k of SQLITE_KINDS) {
      expect(evaluateTargetSpecDerivation(k, "test", "accepted_artifact")).toBe("accept");
    }
  });

  it("warns on target='test' × direct_observation for every SQLite-derived impl tool", () => {
    for (const k of SQLITE_KINDS) {
      expect(evaluateTargetSpecDerivation(k, "test", "direct_observation")).toBe("warn");
    }
  });

  it("rejects target='test' × inference for every SQLite-derived impl tool", () => {
    for (const k of SQLITE_KINDS) {
      expect(evaluateTargetSpecDerivation(k, "test", "inference")).toBe("reject");
    }
  });

  it("rejects target='test' × speculation for every SQLite-derived impl tool", () => {
    for (const k of SQLITE_KINDS) {
      expect(evaluateTargetSpecDerivation(k, "test", "speculation")).toBe("reject");
    }
  });

  it("accepts every (target, provenance) combination for edit_cosmetic (carve-out)", () => {
    for (const t of ["prod", "test"] as const) {
      for (const p of ALL_PROVENANCES) {
        expect(evaluateTargetSpecDerivation("edit_cosmetic", t, p)).toBe("accept");
      }
    }
  });
});

describe("rationaleHasArtifactCitation (RFC §3.2 citation lint)", () => {
  it("accepts rationale carrying §-style spec references", () => {
    expect(rationaleHasArtifactCitation("per SPEC.md §4")).toBe(true);
  });

  it("accepts ADR-* references", () => {
    expect(rationaleHasArtifactCitation("following ADR-007")).toBe(true);
  });

  it("accepts RFC-* references", () => {
    expect(rationaleHasArtifactCitation("per RFC-001 §3")).toBe(true);
  });

  it("accepts issues/* references", () => {
    expect(rationaleHasArtifactCitation("see issues/2026-05-21-foo.md")).toBe(true);
  });

  it("accepts URL references", () => {
    expect(rationaleHasArtifactCitation("see https://example.com/spec")).toBe(true);
  });

  it("rejects rationale with no recognizable artifact reference", () => {
    expect(rationaleHasArtifactCitation("because it seems right")).toBe(false);
    expect(rationaleHasArtifactCitation("the user agreed yesterday")).toBe(false);
  });
});

describe("validateRequest — kind × provenance integration (v0.6.0)", () => {
  let tmpRoot2: string;
  let writeFile2: (rel: string, content: string) => void;
  let ctx2: () => ValidationContext;

  beforeEach(() => {
    tmpRoot2 = makeTmpRoot("kp");
    fs.mkdirSync(path.join(tmpRoot2, ".git"));
    writeFile2 = (rel, content) => writeFileIn(tmpRoot2, rel, content);
    ctx2 = () => ({ repoRoot: tmpRoot2 });
  });

  afterEach(() => {
    cleanTmpRoot(tmpRoot2);
  });

  function workflowReq(
    kind: ToolName,
    provenance: Provenance,
    overrides: Partial<EditToolRequest> = {},
  ): EditToolRequest {
    return {
      target_file: "docs/a.md",
      rationale: "explain feature X (see SPEC.md §4)",
      risk_level: "low",
      provenance,
      execution_state: "normal",
      test_files: [],
      ...overrides,
    };
  }

  it("rejects edit_cosmetic + speculation", () => {
    writeFile2("src/foo.ts", "x\n");
    const r = validateRequest("edit_cosmetic", {
      target_file: "src/foo.ts",
      rationale: "reformat",
      risk_level: "low",
      target: "prod",
      provenance: "speculation",
      execution_state: "normal",
      test_files: [],
    }, ctx2());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("§3.3"))).toBe(true);
    }
  });

  it("rejects edit_decision + inference", () => {
    writeFile2("docs/a.md", "x\n");
    const r = validateRequest("edit_decision", workflowReq("edit_decision", "inference"), ctx2());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.warnings.some((w) => w.includes("rejected"))).toBe(true);
    }
  });

  it("rejects edit_explanation + speculation", () => {
    writeFile2("docs/a.md", "x\n");
    const r = validateRequest("edit_explanation", workflowReq("edit_explanation", "speculation"), ctx2());
    expect(r.ok).toBe(false);
  });

  it("accepts edit_observation + inference with a warn cell in auditWarnings", () => {
    writeFile2("docs/notes.md", "x\n");
    const r = validateRequest("edit_observation", {
      target_file: "docs/notes.md",
      rationale: "noted that X breaks Y",
      risk_level: "low",
      provenance: "inference",
      execution_state: "normal",
      test_files: [],
    }, ctx2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.auditWarnings.some((w) => w.code === "kind_provenance_warn")).toBe(true);
    }
  });

  it("warns when accepted_artifact rationale has no citation", () => {
    writeFile2("docs/a.md", "x\n");
    const r = validateRequest("edit_explanation", {
      target_file: "docs/a.md",
      rationale: "explain feature X",
      risk_level: "low",
      provenance: "accepted_artifact",
      execution_state: "normal",
      test_files: [],
    }, ctx2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.auditWarnings.some((w) => w.code === "citation_lint_missing"),
      ).toBe(true);
    }
  });

  it("does NOT warn on accepted_artifact rationale carrying §-style citation", () => {
    writeFile2("docs/a.md", "x\n");
    const r = validateRequest("edit_explanation", {
      target_file: "docs/a.md",
      rationale: "explain feature X per SPEC.md §4",
      risk_level: "low",
      provenance: "accepted_artifact",
      execution_state: "normal",
      test_files: [],
    }, ctx2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.auditWarnings.some((w) => w.code === "citation_lint_missing"),
      ).toBe(false);
    }
  });

  it("rejects a workflow declaration that carries non-empty test_files (PR #96 codex review P2)", () => {
    // Workflow kinds promise "Required tests: NONE" in their
    // descriptions; the validator must enforce that the bytes match
    // the contract so audit data does not silently record fake test
    // obligations on prose / policy edits.
    writeFile2("CLAUDE.md", "x\n");
    const r = validateRequest("edit_policy_change", {
      target_file: "CLAUDE.md",
      rationale: "the user confirmed this in the current session",
      risk_level: "medium",
      provenance: "user_confirmed",
      execution_state: "normal",
      test_files: ["tests/policy.test.ts"],
    }, ctx2());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.warnings.some((w) => w.includes("test_files must be empty")),
      ).toBe(true);
    }
  });

  it("rejects every workflow kind with non-empty test_files", () => {
    // Drift guard mirroring the WORKFLOW_TOOLS membership: each one
    // must reject test_files at validation time, regardless of which
    // kind carries the test_files array.
    const workflowKinds: ToolName[] = [
      "edit_progress",
      "edit_observation",
      "edit_proposal",
      "edit_decision",
      "edit_explanation",
      "edit_policy_change",
    ];
    writeFile2("docs/a.md", "x\n");
    for (const kind of workflowKinds) {
      const r = validateRequest(kind, {
        target_file: "docs/a.md",
        rationale: "per SPEC.md §4",
        risk_level: "low",
        provenance: "accepted_artifact",
        execution_state: "normal",
        test_files: ["tests/a.test.ts"],
      }, ctx2());
      expect(r.ok, `kind=${kind} silently accepted non-empty test_files`).toBe(false);
    }
  });

  it("rejects edit_progress with additional_files (every cell rejects)", () => {
    writeFile2("docs/log.md", "x\n");
    writeFile2("docs/log2.md", "y\n");
    const r = validateRequest("edit_progress", {
      target_file: "docs/log.md",
      rationale: "session work-log",
      risk_level: "low",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: [],
      additional_files: [{ file: "docs/log2.md" }],
    }, ctx2());
    expect(r.ok).toBe(false);
  });

  it("accepts edit_proposal + speculation + additional_files (typical kickoff burst)", () => {
    writeFile2("issues/a.md", "x\n");
    writeFile2("issues/b.md", "y\n");
    const r = validateRequest("edit_proposal", {
      target_file: "issues/a.md",
      rationale: "feature kickoff: file follow-up issues",
      risk_level: "low",
      provenance: "speculation",
      execution_state: "normal",
      test_files: [],
      additional_files: [{ file: "issues/b.md" }],
    }, ctx2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.additionalBindings.length).toBe(1);
    }
  });

  it("warns on edit_explanation + inference + additional_files (atypical batch cell)", () => {
    writeFile2("docs/a.md", "x\n");
    writeFile2("docs/b.md", "y\n");
    const r = validateRequest("edit_explanation", {
      target_file: "docs/a.md",
      rationale: "explain X based on observed behavior",
      risk_level: "low",
      provenance: "inference",
      execution_state: "normal",
      test_files: [],
      additional_files: [{ file: "docs/b.md" }],
    }, ctx2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.auditWarnings.some((w) => w.code === "additional_files_warn"),
      ).toBe(true);
    }
  });

  it("does not warn for an escape edit_observation in repeating_failure", () => {
    writeFile2("docs/obs.md", "x\n");
    const res = validateRequest(
      "edit_observation",
      workflowReq("edit_observation", "direct_observation", {
        target_file: "docs/obs.md",
        execution_state: "repeating_failure",
      }),
      ctx2(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(
        res.auditWarnings.some((w) => w.code === "execution_state_repeating_failure"),
      ).toBe(false);
    }
  });
  it("records additional_files_warn but NOT execution_state_repeating_failure on a batched workflow declaration in repeating_failure", () => {
    // The pair (edit_proposal, direct_observation) is a WARN cell in
    // §3.3.2 — it produces additional_files_warn. The test confirms
    // execution_state_repeating_failure (impl-only) does NOT co-occur:
    // design §4.1's "never co-occur on one declaration" invariant.
    writeFile2("docs/a.md", "x\n");
    writeFile2("docs/b.md", "y\n");
    const res = validateRequest(
      "edit_proposal",
      workflowReq("edit_proposal", "direct_observation", {
        target_file: "docs/a.md",
        execution_state: "repeating_failure",
        rationale: "RFC sweep across docs/a.md and docs/b.md (direct observation)",
        additional_files: [{ file: "docs/b.md" }],
      }),
      ctx2(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(
        res.auditWarnings.some((w) => w.code === "additional_files_warn"),
      ).toBe(true);
      expect(
        res.auditWarnings.some((w) => w.code === "execution_state_repeating_failure"),
      ).toBe(false);
    }
  });

  it("rejects impl tools that supply additional_files (schema-level whitelist)", () => {
    writeFile2("src/foo.ts", "x\n");
    writeFile2("src/bar.ts", "y\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "src/foo.ts",
      rationale: "tighten boundary",
      risk_level: "low",
      target: "prod",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: ["tests/foo.test.ts"],
      additional_files: [{ file: "src/bar.ts" }],
    }, ctx2());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.warnings.some((w) => w.includes("does not accept additional_files")),
      ).toBe(true);
    }
  });

  // SPEC §3.3.5 — (kind, target, provenance) test-obligation matrix.
  it("warns target_spec_derivation_warn on target=test × direct_observation for an impl tool", () => {
    writeFile2("src/foo.test.ts", "x\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "src/foo.test.ts",
      rationale: "pin upper bound at 100/101 — observed external API behavior",
      risk_level: "low",
      target: "test",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: [],
    }, ctx2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.auditWarnings.some((w) => w.code === "target_spec_derivation_warn"),
      ).toBe(true);
    }
  });

  it("rejects target=test × inference for an impl tool", () => {
    writeFile2("src/foo.test.ts", "x\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "src/foo.test.ts",
      rationale: "based on the surrounding code, likely the bound is 100",
      risk_level: "low",
      target: "test",
      provenance: "inference",
      execution_state: "normal",
      test_files: [],
    }, ctx2());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.warnings.some((w) => w.includes("§3.3.5")),
      ).toBe(true);
    }
  });

  it("rejects target=test × speculation for an impl tool", () => {
    writeFile2("src/foo.test.ts", "x\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "src/foo.test.ts",
      rationale: "**Hypothesis**: the bound should be 100",
      risk_level: "low",
      target: "test",
      provenance: "speculation",
      execution_state: "normal",
      test_files: [],
    }, ctx2());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.warnings.some((w) => w.includes("§3.3.5")),
      ).toBe(true);
    }
  });

  it("does not emit target_spec_derivation_warn on target=prod × direct_observation", () => {
    writeFile2("src/foo.ts", "x\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "src/foo.ts",
      rationale: "tighten upper bound; observed from src/foo.ts:42",
      risk_level: "low",
      target: "prod",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: ["src/foo.test.ts"],
    }, ctx2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.auditWarnings.some((w) => w.code === "target_spec_derivation_warn"),
      ).toBe(false);
    }
  });

  it("edit_cosmetic + target=test + direct_observation is exempt from §3.3.5 (carve-out)", () => {
    writeFile2("src/foo.test.ts", "x\n");
    const r = validateRequest("edit_cosmetic", {
      target_file: "src/foo.test.ts",
      rationale: "fix indentation; observed via prettier diff",
      risk_level: "low",
      target: "test",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: [],
    }, ctx2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.auditWarnings.some((w) => w.code === "target_spec_derivation_warn"),
      ).toBe(false);
    }
  });
});

// =====================================================================
// SPEC §3.5 — high-impact kind unconditional audit warn (v0.9.0)
// =====================================================================

describe("validateRequest — high_impact_kind_warn (SPEC §3.5)", () => {
  let tmpRoot3: string;
  let ctx3: () => ValidationContext;

  beforeEach(() => {
    tmpRoot3 = makeTmpRoot("hik");
    fs.mkdirSync(path.join(tmpRoot3, ".git"));
    ctx3 = () => ({ repoRoot: tmpRoot3 });
  });

  afterEach(() => {
    cleanTmpRoot(tmpRoot3);
  });

  it("fires on every accepted declaration of a high-impact impl kind", () => {
    // Use edit_permission_logic as a representative impl kind in the set.
    writeFileIn(tmpRoot3, "src/authz.ts", "x\n");
    const r = validateRequest("edit_permission_logic", {
      target_file: "src/authz.ts",
      rationale: "tighten role deny per ADR-007",
      risk_level: "high",
      target: "prod",
      provenance: "accepted_artifact",
      execution_state: "normal",
      test_files: ["src/authz.test.ts"],
    }, ctx3());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warns = r.auditWarnings.filter((w) => w.code === "high_impact_kind_warn");
      expect(warns.length).toBe(1);
      const message = warns[0]?.message ?? "";
      expect(message).toContain("edit_permission_logic");
      expect(message).toContain("high-impact");
    }
  });

  it("fires on edit_policy_change (the workflow-axis high-impact kind)", () => {
    writeFileIn(tmpRoot3, "CLAUDE.md", "x\n");
    const r = validateRequest("edit_policy_change", {
      target_file: "CLAUDE.md",
      rationale: "the user confirmed this in the current session: <quote>",
      risk_level: "medium",
      provenance: "user_confirmed",
      execution_state: "normal",
      test_files: [],
    }, ctx3());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.auditWarnings.some((w) => w.code === "high_impact_kind_warn"),
      ).toBe(true);
    }
  });

  it("does NOT fire on a non-high-impact kind (e.g. edit_boundary_condition)", () => {
    writeFileIn(tmpRoot3, "src/foo.ts", "x\n");
    const r = validateRequest("edit_boundary_condition", {
      target_file: "src/foo.ts",
      rationale: "tighten upper bound per SPEC.md §4",
      risk_level: "low",
      target: "prod",
      provenance: "accepted_artifact",
      execution_state: "normal",
      test_files: ["src/foo.test.ts"],
    }, ctx3());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.auditWarnings.some((w) => w.code === "high_impact_kind_warn"),
      ).toBe(false);
    }
  });

  it("fires regardless of provenance / target / execution_state for a high-impact kind", () => {
    // Same kind, three different (provenance, execution_state, target)
    // shapes — the warn fires on each. The point of "unconditional" is
    // that the audit surface does not depend on the other axes.
    writeFileIn(tmpRoot3, "src/schema.sql", "x\n");
    writeFileIn(tmpRoot3, "src/schema.test.ts", "x\n");
    const shapes: Array<Partial<EditToolRequest>> = [
      { provenance: "user_confirmed", execution_state: "normal", target: "prod" },
      { provenance: "accepted_artifact", execution_state: "recovery", target: "prod" },
      { provenance: "direct_observation", execution_state: "normal", target: "test", target_file: "src/schema.test.ts", test_files: [] },
    ];
    for (const shape of shapes) {
      const r = validateRequest("edit_db_schema", {
        target_file: "src/schema.sql",
        rationale: "add NOT NULL column with backfill per ADR-009",
        risk_level: "high",
        provenance: "user_confirmed",
        execution_state: "normal",
        target: "prod",
        test_files: ["src/schema.test.ts"],
        ...shape,
      } as EditToolRequest, ctx3());
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(
          r.auditWarnings.some((w) => w.code === "high_impact_kind_warn"),
        ).toBe(true);
      }
    }
  });

  it("the full high-impact set: each kind fires the warn on at least one accepted declaration", () => {
    // Drift guard: if HIGH_IMPACT_KINDS gains or loses a member, this
    // test surfaces it. The (target_file, target, test_files, prov)
    // shape is the simplest acceptance for each kind.
    const cases: Array<[ToolName, "prod" | undefined]> = [
      ["edit_policy_change", undefined],
      ["edit_db_schema", "prod"],
      ["edit_data_migration", "prod"],
      ["edit_api_contract", "prod"],
      ["edit_permission_logic", "prod"],
      ["edit_dependency_config", "prod"],
      ["edit_concurrency", "prod"],
      ["edit_external_side_effect", "prod"],
      ["edit_cache_invalidation", "prod"],
      ["edit_retry_timeout", "prod"],
    ];
    writeFileIn(tmpRoot3, "src/a.ts", "x\n");
    writeFileIn(tmpRoot3, "src/a.test.ts", "x\n");
    writeFileIn(tmpRoot3, "CLAUDE.md", "x\n");
    for (const [kind, target] of cases) {
      const isPolicy = kind === "edit_policy_change";
      const r = validateRequest(kind, {
        target_file: isPolicy ? "CLAUDE.md" : "src/a.ts",
        rationale: "tighten/extend per ADR-001",
        risk_level: "high",
        provenance: "accepted_artifact",
        execution_state: "normal",
        ...(target !== undefined ? { target } : {}),
        test_files: isPolicy ? [] : ["src/a.test.ts"],
      } as EditToolRequest, ctx3());
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(
          r.auditWarnings.some((w) => w.code === "high_impact_kind_warn"),
          `kind=${kind} did not emit high_impact_kind_warn`,
        ).toBe(true);
      }
    }
  });
});

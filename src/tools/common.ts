// Case C / v0.2 typed_edit common schema. Per docs/SPEC.md §3:
//
//   A typed_edit MCP call is a *declaration of intent*. The server validates
//   the request, reads disk to compute before_sha256 itself, issues a single-
//   use token bound to one or more (file, before_sha256) tuples, and returns.
//   It does not write. Native Edit / Write / MultiEdit performs the write
//   under hook validation.
//
// This module owns:
//   - the zod schema for EditToolRequest,
//   - the EditToolResult shape returned by the issuer,
//   - validateRequest(...): path-safety, cardinality, server-side
//     before_sha256 computation, and the create/modify-disk invariant.
//
// v0.2.1 thinning: client-supplied before_sha256 / after_sha256 fields are
// removed. The server reads disk and computes before_sha256 itself; there is
// no after_sha256 anywhere. Per Articles 3 (non-adversarial threat model) and
// 4 (descriptions read as a comfortable tool, not a hashing chore), the
// client-supplied digests added friction without proportional protective
// value. The hook re-reads disk to verify staleness only.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {
  TOOLS_REQUIRING_TARGET,
  TOOLS_REQUIRING_TEST_FILES,
  type ToolName,
} from "./descriptions.js";
import { isProtectedPath } from "../state/protected-paths.js";
import { canonicalizeRepoRelative } from "../utils/repo-paths.js";
import { repoIsValid } from "./repo-validity.js";

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const EditTargetSchema = z.enum(["prod", "test"]);
export type EditTarget = z.infer<typeof EditTargetSchema>;

const AdditionalFileSchema = z
  .object({
    file: z.string().min(1),
  })
  .strict();
export type AdditionalFile = z.infer<typeof AdditionalFileSchema>;

// Operational hygiene cap on additional_files cardinality. Per SPEC §3 this
// is "≤ 32 (operational hygiene; not a constitutional value)" — large enough
// to cover sweeping docs renames and small scaffolds, small enough that an
// honest workflow tool cannot accidentally swamp the audit log with one call.
export const MAX_ADDITIONAL_FILES = 32;

// SQLite-derived tools (the 17): MUST omit `additional_files`.
// Workflow tool (only 1 remaining post-v0.3.1: edit_docs_only): MAY
// include it for sweeping documentation updates. v0.3.1 dropped
// edit_create_file and edit_create_planning_artifact when empty
// creates became free at the deny-raw-edit hook level (no MCP
// declaration needed for an empty Write to a non-existent in-repo
// path). additional_files now functions purely as a doc-batching
// affordance.
export const TOOLS_ACCEPTING_ADDITIONAL_FILES: readonly ToolName[] = [
  "edit_docs_only",
];

/**
 * z.preprocess shim: opencode (v1.14.x) mis-marshals empty `[]` array
 * arguments as the JSON-string `"[]"` when calling typed_edit MCP
 * tools. Claude Code does not — it correctly sends an actual array.
 *
 * To unblock opencode users without changing the wire contract, we
 * accept either form at the schema boundary. The transform is purely
 * defensive: a proper array passes through unchanged; a JSON-encoded
 * array string is parsed back into an array; anything else falls
 * through to the array validation, which fails with the original
 * "expected array" Zod error.
 *
 * When coercion fires we emit a stderr WARN naming the field, so the
 * upstream bug remains observable and we can tell when the workaround
 * is no longer needed (i.e. when WARN frequency drops to zero in real
 * deployments). See
 * `issues/2026-05-04-1700-opencode-empty-test-files-array-mismarshalled.md`.
 */
function coerceJsonStringToArray(fieldName: string) {
  return (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      return v;
    }
    if (!Array.isArray(parsed)) return v;
    process.stderr.write(
      `[meta-edit] WARN: coerced ${fieldName} JSON-string to array (opencode harness mis-marshaling); ` +
        `see issues/2026-05-04-1700-opencode-empty-test-files-array-mismarshalled.md\n`,
    );
    return parsed;
  };
}

export const EditToolRequestSchema = z
  .object({
    target_file: z.string().min(1),
    rationale: z.string(),
    risk_level: RiskLevelSchema,
    // `target` is required on the 16 impl tools (15 SQLite-derived +
    // edit_cosmetic) and absent on edit_docs_only. The schema accepts it
    // as optional; validateRequest enforces presence-on-impl and
    // absence-on-docs per TOOLS_REQUIRING_TARGET (see descriptions.ts).
    target: EditTargetSchema.optional(),
    test_files: z.preprocess(
      coerceJsonStringToArray("test_files"),
      z.array(z.string()),
    ),
    additional_files: z
      .preprocess(
        coerceJsonStringToArray("additional_files"),
        z.array(AdditionalFileSchema).max(MAX_ADDITIONAL_FILES),
      )
      .optional(),
  })
  .strict();

export type EditToolRequest = z.infer<typeof EditToolRequestSchema>;

export type EditToolResult = {
  /**
   * Token id when the declaration succeeded. Empty string on rejection — the
   * caller MUST inspect `warnings` (and `audit_error`) to determine outcome.
   * The MCP-layer wrapper in registry.ts elides empty tokens before
   * returning to the agent so a rejected call never carries a usable token.
   */
  token: string;
  /** ISO-8601 expiry (issued_at + GRANT_TTL_MS). Empty string on rejection. */
  expires_at: string;
  /** edit_id is always present so audit reconciles even on rejection. */
  edit_id: string;
  warnings: string[];
  /**
   * Set IFF an edit-log append threw. Distinct from `warnings` so callers can
   * react to audit-trail gaps without string-matching the routine warning
   * channel. The field's only contract is "an audit-log write failed for
   * this request" — callers MUST check the edit log directly for ground
   * truth.
   */
  audit_error?: string;
  /**
   * Human-readable reminder, present IFF a token was issued. Tells the agent
   * that the deny-raw-edit hook will resolve this declaration automatically
   * on the next native Edit / Write / MultiEdit call against the bound
   * file(s); the agent passes no extra parameters. (v0.2.2: replaces the
   * v0.2.0/v0.2.1 message that asked the agent to pass `_meta_edit_token`,
   * which Claude Code's strict input schema rejected.) Per SPEC §3 /
   * Article 4: the server takes care of bookkeeping; the agent only
   * declares intent and is told what comes next. Omitted on rejection.
   */
  next_action?: string;
};

export type ValidationContext = {
  repoRoot: string;
};

// A single file binding distilled from the request after path safety and
// disk-content read. The issuer hands these directly to grants.issue().
//
// v0.2.1: only `before_sha256` is bound; the server reads disk to compute it.
// `after_sha256` was removed — under the non-adversarial threat model, the
// post-condition simulate() check was friction without proportional value.
export type ValidatedBinding = {
  /**
   * Repository-relative canonical path (post-realpath, normalized). This is
   * also what the IssuedEntry's `binding[i].file` field carries — so the
   * deny-raw-edit hook can match a native Edit/Write canonical against the
   * same form.
   */
  canonical: string;
  /** Lowercase hex sha256(64) of the disk content at declaration time. */
  before_sha256: string;
};

export type ValidationFailure = {
  ok: false;
  warnings: string[];
};

export type ValidationSuccess = {
  ok: true;
  /** target_file binding (always first). */
  primaryBinding: ValidatedBinding;
  /** additional_files bindings (workflow tools only; empty otherwise). */
  additionalBindings: ValidatedBinding[];
};

export type ValidationResult = ValidationFailure | ValidationSuccess;

/** Lowercase-hex sha256 of a UTF-8 string. */
export function sha256Hex(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** sha256("") — used as the before_sha256 sentinel for empty-file
 * creation (v0.3.1: free at the deny-raw-edit hook level for
 * content === "" Write to a non-existent in-repo path). */
export const SHA256_EMPTY = sha256Hex("");

export function validateRequest(
  toolName: ToolName,
  request: EditToolRequest,
  ctx: ValidationContext,
): ValidationResult {
  const warnings: string[] = [];

  // ---- 0. Repo-root sentinel (A1 / issue 1530) ------------------------
  // The MCP server intentionally boots even when the configured root
  // lacks a `.git` / `.jj` directory, so ListTools can inject the
  // seventeen tool descriptions into the agent's context. The actual
  // typed_edit calls, however, must refuse to run against a non-repo
  // root — silently accepting them would write into an unrelated
  // directory under `process.cwd()`, defeating the protected-path /
  // canonicalization guarantees that repo-relative paths assume.
  const repoCheck = repoIsValid(ctx.repoRoot);
  if (!repoCheck.ok) {
    return { ok: false, warnings: [repoCheck.error] };
  }

  // ---- 1. Rationale ----------------------------------------------------
  if (request.rationale.trim().length === 0) {
    warnings.push("rationale must be non-empty");
  }

  // ---- 2a. target field presence (impl tools require it; docs forbids it) -
  const toolRequiresTarget = TOOLS_REQUIRING_TARGET.includes(toolName);
  if (toolRequiresTarget) {
    if (request.target === undefined) {
      warnings.push(
        `target must be declared as "prod" or "test" for ${toolName}`,
      );
    }
  } else {
    if (request.target !== undefined) {
      warnings.push(
        `${toolName} does not accept a target field (prod/test split does ` +
          `not apply to this tool)`,
      );
    }
  }

  // ---- 2b. test_files cardinality (per §4 obligations + target rules) -----
  // The pair-by-tool model (v0.5.0): when target === "test", the
  // target_file IS the test file, so test_files must be empty. When
  // target === "prod", impl tools (excluding edit_cosmetic) must
  // forward-declare the test files the paired target: test call(s)
  // will modify.
  if (request.target === "test") {
    if (request.test_files.length > 0) {
      warnings.push(
        `test_files must be empty when target is "test" (target_file IS the test file)`,
      );
    }
  } else if (
    request.target === "prod" &&
    TOOLS_REQUIRING_TEST_FILES.includes(toolName)
  ) {
    if (request.test_files.length === 0) {
      warnings.push(
        `test_files must be non-empty for ${toolName} with target "prod"`,
      );
    }
  }

  // ---- 3. additional_files acceptance gate -----------------------------
  // The 17 SQLite-derived tools MUST omit `additional_files`. The remaining
  // workflow tool (edit_docs_only) MAY include it (cardinality already capped
  // by zod via .max(MAX_ADDITIONAL_FILES) above). v0.3.1 dropped
  // edit_create_file and edit_create_planning_artifact, so only edit_docs_only
  // accepts the field today.
  if (
    request.additional_files !== undefined &&
    !TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)
  ) {
    warnings.push(
      `${toolName} does not accept additional_files; this field is reserved for ` +
        `the workflow tool (edit_docs_only). Submit each ` +
        `file as its own typed_edit call.`,
    );
  }

  // ---- 4. test_files path-safety (forward declaration only — no binding) -
  // Per Article 6 / SPEC §6: test_files is a forward declaration recorded in
  // the audit log; it does NOT authorize writes. We still validate path
  // safety so a malformed entry surfaces at declaration time.
  for (const tf of request.test_files) {
    const c = checkPathSafety(tf, ctx.repoRoot);
    if (!c.ok) {
      warnings.push(`test_files entry "${tf}": ${c.error}`);
    }
  }

  // ---- 5. target_file path-safety + disk read -------------------------
  // v0.3.1: every typed_edit tool runs in modify mode. Empty file
  // creation is now hook-level (deny-raw-edit allows Write with
  // content === "" to a non-existent in-repo path); the typed
  // declaration that follows runs against the now-existing empty file
  // and binds before_sha256 := sha256(""). No CREATE flag needed.
  const targetCheck = checkPathSafety(request.target_file, ctx.repoRoot);
  let primaryBinding: ValidatedBinding | null = null;
  if (!targetCheck.ok) {
    warnings.push(`target_file: ${targetCheck.error}`);
  } else {
    const beforeRead = computeBeforeSha256(
      targetCheck.canonical,
      ctx.repoRoot,
      "target_file",
    );
    if (!beforeRead.ok) {
      warnings.push(beforeRead.error);
    } else {
      primaryBinding = {
        canonical: targetCheck.canonical,
        before_sha256: beforeRead.before_sha256,
      };
    }
  }

  // ---- 6. additional_files path-safety + disk read --------------------
  // v0.3.1: only edit_docs_only retains additional_files (multi-file
  // doc sweeps). Each entry is a modify against an existing file.
  const additionalBindings: ValidatedBinding[] = [];
  if (
    request.additional_files !== undefined &&
    TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)
  ) {
    const seenCanonicals = new Set<string>();
    if (primaryBinding !== null) {
      seenCanonicals.add(primaryBinding.canonical);
    }
    for (const af of request.additional_files) {
      const safe = checkPathSafety(af.file, ctx.repoRoot);
      if (!safe.ok) {
        warnings.push(`additional_files entry "${af.file}": ${safe.error}`);
        continue;
      }
      if (seenCanonicals.has(safe.canonical)) {
        warnings.push(
          `additional_files contains duplicate file "${safe.canonical}"; ` +
            `each binding must be unique within a single declaration.`,
        );
        continue;
      }
      seenCanonicals.add(safe.canonical);
      const beforeRead = computeBeforeSha256(
        safe.canonical,
        ctx.repoRoot,
        `additional_files entry "${af.file}"`,
      );
      if (!beforeRead.ok) {
        warnings.push(beforeRead.error);
        continue;
      }
      additionalBindings.push({
        canonical: safe.canonical,
        before_sha256: beforeRead.before_sha256,
      });
    }
  }

  if (warnings.length > 0 || primaryBinding === null) {
    return { ok: false, warnings };
  }
  return { ok: true, primaryBinding, additionalBindings };
}

// ---------------------------------------------------------------------
// Path safety (carried over from v0.1.x with the apply-time TOCTOU notes
// dropped — apply happens in native Edit now, the hook re-checks).
// ---------------------------------------------------------------------

export function checkPathSafety(
  p: string,
  repoRoot: string,
): { ok: true; canonical: string } | { ok: false; error: string } {
  // Issue-side policy (NOT shared with the consume side): the typed_edit
  // request must carry an already-canonical repository-relative path.
  if (path.isAbsolute(p)) {
    return {
      ok: false,
      error: `path "${p}" is absolute; must be repository-relative`,
    };
  }
  if (containsParentTraversal(p)) {
    return {
      ok: false,
      error:
        `path "${p}" contains a ".." traversal segment; pass an already-canonical repository-relative path so the resolved target is unambiguous`,
    };
  }

  // Canonical form via the ONE shared canonicalizer — byte-identical to
  // what the deny-raw-edit hook computes at consume time
  // (src/utils/repo-paths.ts canonicalizeRepoRelative). Existence-
  // independent, so a declaration against a not-yet-created file binds
  // the same key the later native Write resolves to.
  const res = canonicalizeRepoRelative(p, repoRoot);
  if (!res.ok) {
    if (res.code === "escapes") {
      return { ok: false, error: `path "${p}" escapes repository root` };
    }
    if (res.code === "is_root") {
      return {
        ok: false,
        error: `path "${p}" resolves to the repository root`,
      };
    }
    return {
      ok: false,
      error: `path "${p}" could not be canonicalized via realpath; failing closed`,
    };
  }
  if (isProtectedPath(res.canonical)) {
    return {
      ok: false,
      error: `path "${p}" resolves into a protected directory (.meta-edit/state/ or .meta-edit/tmp/)`,
    };
  }
  return { ok: true, canonical: res.canonical };
}

function containsParentTraversal(p: string): boolean {
  for (const seg of p.split(/[\\/]/)) {
    if (seg === "..") return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// before_sha256 computation (server-side disk read)
// ---------------------------------------------------------------------

/**
 * Read disk and compute before_sha256 for a binding entry.
 *   - For all current tools (modify-only, post-v0.3.1): the file MUST
 *     exist; before_sha256 := sha256(disk_content_utf8). When the file
 *     was just created empty by a free Write (v0.3.1 hook-level
 *     allowance), the digest is sha256("").
 *
 * Per Article 3 (non-adversarial threat model): we hash UTF-8 content. A
 * binary or non-UTF-8 file is not in the threat model — the hook re-reads
 * with the same encoding so the digests align.
 *
 * v0.2.1: this replaces the v0.2.0 verifyBeforeSha256() which compared a
 * client-supplied digest against disk. Removing the client-supplied digest
 * removes the agent friction (no more node/python sha256 invocation per
 * call) without weakening protection: the hook re-reads disk to detect
 * staleness regardless of who computed the issue-time digest.
 */
function computeBeforeSha256(
  canonical: string,
  repoRoot: string,
  fieldLabel: string,
):
  | { ok: true; before_sha256: string }
  | { ok: false; error: string } {
  const absolute = path.join(repoRoot, canonical);

  let onDisk: string | null = null;
  try {
    onDisk = fs.readFileSync(absolute, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      // v0.4.2: a declaration against a not-yet-existing file is valid.
      // It binds before_sha256 := sha256("") — the same value the
      // deny-raw-edit hook computes for an absent file
      // (raw-edit-policy.ts readFileForBinding returns "" on ENOENT).
      // The subsequent native Write creates the file (auto-mkdir-ing
      // parents) and the binding resolves. This drops the fragile
      // v0.3.1 "create the empty file first, THEN declare" dance whose
      // ordering sensitivity was a primary cause of binding failures
      // (issues/2026-05-17-grant-binding-canonicalization-parity.md).
      return { ok: true, before_sha256: SHA256_EMPTY };
    }
    return {
      ok: false,
      error:
        `${fieldLabel} "${canonical}": failed to read disk content for sha256 computation (${code ?? "ERR"})`,
    };
  }

  return { ok: true, before_sha256: sha256Hex(onDisk) };
}

// ---------------------------------------------------------------------
// Handler / issuer wiring (used by registry.ts).
// ---------------------------------------------------------------------

export type ToolHandler = (
  toolName: ToolName,
  args: EditToolRequest,
) => Promise<EditToolResult>;

/**
 * Stub handler that runs validation and returns a result with no token.
 * Useful for tests that don't want to wire a grants store or edit log.
 */
export function makeStubHandler(ctx: ValidationContext): ToolHandler {
  return async (toolName, args) => {
    const result = validateRequest(toolName, args, ctx);
    if (!result.ok) {
      return {
        token: "",
        expires_at: "",
        edit_id: "edit_00000000_0000",
        warnings: result.warnings,
      };
    }
    return {
      token: "",
      expires_at: "",
      edit_id: "edit_00000000_0000",
      warnings: [
        `${toolName}: validation passed; stub handler does not issue tokens`,
      ],
    };
  };
}

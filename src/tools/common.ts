// Case C / v0.2 typed_edit common schema. Per docs/SPEC.md §3:
//
//   A typed_edit MCP call is a *declaration of intent*. The server validates
//   the request, issues a single-use token bound to one or more sha256
//   tuples, and returns. It does not write. Native Edit / Write / MultiEdit
//   performs the write under hook validation.
//
// This module owns:
//   - the zod schema for EditToolRequest,
//   - the EditToolResult shape returned by the issuer,
//   - validateRequest(...): path-safety, sha256 format, cardinality, and the
//     before_sha256 ↔ disk content invariant.
//
// Apply-time mechanics (sibling-temp, parent-fsync, TOCTOU walks) belonged to
// v0.1.x and are intentionally removed: native Edit / Write owns those per
// Article 5 (binding principles) and Article 7 (out of scope).

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {
  TOOLS_REQUIRING_TEST_FILES,
  type ToolName,
} from "./descriptions.js";
import {
  isProtectedPath,
  normalizeRepoRelative,
} from "../state/protected-paths.js";
import { realpathOfDeepestExisting } from "../utils/realpath.js";

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// SHA-256 hex digest: exactly 64 lowercase hex characters. The grants store
// validates the same shape; we re-validate at the request boundary so a
// malformed digest never reaches the issuer.
export const HEX64_RE = /^[0-9a-f]{64}$/;

const Sha256HexSchema = z
  .string()
  .regex(HEX64_RE, "must be 64 lowercase hex characters (sha256)");

const AdditionalFileSchema = z.object({
  file: z.string().min(1),
  before_sha256: Sha256HexSchema,
  after_sha256: Sha256HexSchema,
});
export type AdditionalFile = z.infer<typeof AdditionalFileSchema>;

// Operational hygiene cap on additional_files cardinality. Per SPEC §3 this
// is "≤ 32 (operational hygiene; not a constitutional value)" — large enough
// to cover sweeping docs renames and small scaffolds, small enough that an
// honest workflow tool cannot accidentally swamp the audit log with one call.
export const MAX_ADDITIONAL_FILES = 32;

// SQLite-derived tools (the 17): MUST omit `additional_files`.
// Workflow tools (the 2: edit_docs_only, edit_create_file): MAY include it.
export const TOOLS_ACCEPTING_ADDITIONAL_FILES: readonly ToolName[] = [
  "edit_docs_only",
  "edit_create_file",
];

export const EditToolRequestSchema = z.object({
  target_file: z.string().min(1),
  rationale: z.string(),
  risk_level: RiskLevelSchema,
  test_files: z.array(z.string()),
  before_sha256: Sha256HexSchema,
  after_sha256: Sha256HexSchema,
  additional_files: z
    .array(AdditionalFileSchema)
    .max(MAX_ADDITIONAL_FILES)
    .optional(),
});

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
};

export type ValidationContext = {
  repoRoot: string;
};

// A single file binding distilled from the request after path safety,
// sha256 format, and disk-content checks. The issuer hands these directly
// to grants.issue().
export type ValidatedBinding = {
  /**
   * Repository-relative canonical path (post-realpath, normalized). This is
   * also what the IssuedEntry's `binding[i].file` field carries — so the
   * deny-raw-edit hook (Task C) can match a native Edit/Write canonical
   * against the same form.
   */
  canonical: string;
  before_sha256: string;
  after_sha256: string;
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

/** sha256("") — used as the before_sha256 sentinel for edit_create_file. */
export const SHA256_EMPTY = sha256Hex("");

export function validateRequest(
  toolName: ToolName,
  request: EditToolRequest,
  ctx: ValidationContext,
): ValidationResult {
  const warnings: string[] = [];

  // ---- 1. Rationale ----------------------------------------------------
  if (request.rationale.trim().length === 0) {
    warnings.push("rationale must be non-empty");
  }

  // ---- 2. test_files cardinality (per §4 obligations) ------------------
  if (toolName === "edit_test_only_change") {
    if (request.test_files.length > 0) {
      warnings.push("test_files must be empty for edit_test_only_change");
    }
  } else if (TOOLS_REQUIRING_TEST_FILES.includes(toolName)) {
    if (request.test_files.length === 0) {
      warnings.push(`test_files must be non-empty for ${toolName}`);
    }
  }

  // ---- 3. additional_files acceptance gate -----------------------------
  // The 17 SQLite-derived tools MUST omit `additional_files`. The 2 workflow
  // tools (edit_docs_only, edit_create_file) MAY include it (cardinality
  // already capped by zod via .max(MAX_ADDITIONAL_FILES) above).
  if (
    request.additional_files !== undefined &&
    !TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)
  ) {
    warnings.push(
      `${toolName} does not accept additional_files; this field is reserved for ` +
        `the 2 workflow tools (edit_docs_only, edit_create_file). Submit each ` +
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

  // ---- 5. target_file path-safety + binding shape ----------------------
  const isCreate = toolName === "edit_create_file";
  const targetCheck = checkPathSafety(request.target_file, ctx.repoRoot);
  let primaryBinding: ValidatedBinding | null = null;
  if (!targetCheck.ok) {
    warnings.push(`target_file: ${targetCheck.error}`);
  } else {
    const beforeCheck = verifyBeforeSha256(
      targetCheck.canonical,
      request.before_sha256,
      ctx.repoRoot,
      isCreate,
      "target_file",
    );
    if (!beforeCheck.ok) {
      warnings.push(beforeCheck.error);
    } else {
      primaryBinding = {
        canonical: targetCheck.canonical,
        before_sha256: request.before_sha256,
        after_sha256: request.after_sha256,
      };
    }
  }

  // ---- 6. additional_files path-safety + binding shape ----------------
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
      // For edit_create_file, ALL bindings are create entries: before_sha256
      // MUST be sha256("") and the file MUST NOT exist. For edit_docs_only,
      // each entry is a modify (the file MUST exist and before_sha256 MUST
      // match disk).
      const beforeCheck = verifyBeforeSha256(
        safe.canonical,
        af.before_sha256,
        ctx.repoRoot,
        isCreate,
        `additional_files entry "${af.file}"`,
      );
      if (!beforeCheck.ok) {
        warnings.push(beforeCheck.error);
        continue;
      }
      additionalBindings.push({
        canonical: safe.canonical,
        before_sha256: af.before_sha256,
        after_sha256: af.after_sha256,
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
  let norm: string;
  try {
    norm = normalizeRepoRelative(p);
  } catch (err) {
    return {
      ok: false,
      error: `path "${p}" is invalid: ${(err as Error).message}`,
    };
  }
  if (norm.length === 0) {
    return { ok: false, error: "path is empty after normalization" };
  }
  const lexicalRoot = path.resolve(repoRoot);
  const lexicalResolved = path.resolve(lexicalRoot, norm);
  if (
    lexicalResolved !== lexicalRoot &&
    !lexicalResolved.startsWith(lexicalRoot + path.sep)
  ) {
    return { ok: false, error: `path "${p}" escapes repository root` };
  }

  const realRoot = realpathOrSelf(lexicalRoot);
  const realResolved = realpathOfDeepestExisting(lexicalResolved);

  if (realResolved === null) {
    return {
      ok: false,
      error: `path "${p}" could not be canonicalized via realpath; failing closed`,
    };
  }

  if (
    realResolved !== realRoot &&
    !realResolved.startsWith(realRoot + path.sep)
  ) {
    return {
      ok: false,
      error: `path "${p}" escapes repository root after symlink resolution`,
    };
  }

  const canonical = normalizeRepoRelative(path.relative(realRoot, realResolved));
  if (canonical.length === 0) {
    return { ok: false, error: `path "${p}" resolves to the repository root` };
  }
  if (isProtectedPath(canonical)) {
    return {
      ok: false,
      error: `path "${p}" resolves into a protected directory (.meta-edit/state/ or .meta-edit/tmp/)`,
    };
  }
  return { ok: true, canonical };
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function containsParentTraversal(p: string): boolean {
  for (const seg of p.split(/[\\/]/)) {
    if (seg === "..") return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// before_sha256 ↔ disk reconciliation
// ---------------------------------------------------------------------

/**
 * Verify the declared before_sha256 against disk:
 *   - For edit_create_file: the file MUST NOT exist AND before_sha256 MUST
 *     equal sha256("").
 *   - For modify-only tools: the file MUST exist AND before_sha256 MUST
 *     equal sha256(disk_content_utf8).
 *
 * Per Article 3 (non-adversarial threat model): we hash UTF-8 content. A
 * binary file or non-UTF-8 file is not in the threat model — the agent
 * either picks it up via the same encoding or the hashes diverge.
 */
function verifyBeforeSha256(
  canonical: string,
  declaredBefore: string,
  repoRoot: string,
  isCreate: boolean,
  fieldLabel: string,
): { ok: true } | { ok: false; error: string } {
  const absolute = path.join(repoRoot, canonical);

  // Try to read disk content. ENOENT distinguishes create vs modify.
  let onDisk: string | null = null;
  try {
    onDisk = fs.readFileSync(absolute, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      // File does not exist on disk.
      if (!isCreate) {
        return {
          ok: false,
          error:
            `${fieldLabel} "${canonical}" does not exist on disk; modify-only tools require the file to already exist`,
        };
      }
      if (declaredBefore !== SHA256_EMPTY) {
        return {
          ok: false,
          error:
            `${fieldLabel} "${canonical}": before_sha256 must equal sha256("") for edit_create_file because the file does not yet exist on disk`,
        };
      }
      return { ok: true };
    }
    return {
      ok: false,
      error:
        `${fieldLabel} "${canonical}": failed to read disk content for sha256 verification (${code ?? "ERR"})`,
    };
  }

  // File exists on disk.
  if (isCreate) {
    return {
      ok: false,
      error:
        `${fieldLabel} "${canonical}" already exists on disk; edit_create_file refuses to overwrite an existing file (use a modify-only edit_* tool instead)`,
    };
  }
  const actual = sha256Hex(onDisk);
  if (actual !== declaredBefore) {
    return {
      ok: false,
      error:
        `${fieldLabel} "${canonical}": before_sha256 mismatch — declared ${shortHash(declaredBefore)} ` +
        `but disk content hashes to ${shortHash(actual)}. Re-read the file and recompute the digest before retrying.`,
    };
  }
  return { ok: true };
}

function shortHash(h: string): string {
  return h.length >= 12 ? `${h.slice(0, 12)}…` : h;
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

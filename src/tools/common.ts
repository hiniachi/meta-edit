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
  WORKFLOW_TOOLS,
  type ToolName,
} from "./descriptions.js";
import { isProtectedPath } from "../state/protected-paths.js";
import { canonicalizeRepoRelative } from "../utils/repo-paths.js";
import { repoIsValid } from "./repo-validity.js";

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const EditTargetSchema = z.enum(["prod", "test"]);
export type EditTarget = z.infer<typeof EditTargetSchema>;

// v0.6.0: every typed_edit declaration carries a required `provenance`
// field naming the epistemic source of the edit. Per SPEC §3 and the
// workflow-axis RFC (docs/plan/docs-kind-subdivision-and-provenance/
// rfc.md §3.2), the five values cover the epistemic strata that
// past-chat artifacts conflate. Schema-level: required, no default. The
// kind × provenance validity matrix lives below in
// `evaluateKindProvenanceValidity()`.
export const ProvenanceSchema = z.enum([
  "user_confirmed",
  "accepted_artifact",
  "direct_observation",
  "inference",
  "speculation",
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

// design §4.1: every typed_edit declaration carries a required
// execution_state field naming the state of the agent's work loop.
export const ExecutionStateSchema = z.enum([
  "normal",
  "repeating_failure",
  "recovery",
]);
export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

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

// Schema-level whitelist for `additional_files`: the 6 workflow-axis
// kinds may declare the field; the 14 SQLite-derived impl tools and
// edit_cosmetic MUST omit it. Acceptance of a particular declaration is
// then decided cell-wise by `evaluateAdditionalFiles(kind, provenance)`
// per RFC §3.3.2 — the workflow-axis-rfc replaces v0.5.x's kind-binary
// `["edit_docs_only"]` whitelist with a (kind, provenance) cell matrix.
export const TOOLS_ACCEPTING_ADDITIONAL_FILES: readonly ToolName[] =
  WORKFLOW_TOOLS;

// =====================================================================
// Kind × Provenance matrices (RFC §3.3, v0.6.0)
// =====================================================================
//
// The matrices below are the validation rule. They are the spec, in
// the sense of CLAUDE.md §4: any change here must update
// docs/SPEC.md §3 / §6 and
// docs/plan/docs-kind-subdivision-and-provenance/rfc.md §3.3 in the
// same commit.

export type MatrixVerdict = "accept" | "warn" | "reject";

/**
 * §3.3.1 / §3.3.3 — base validity of a (kind, provenance) declaration.
 * Returns:
 *   - "accept" when the cell is OK
 *   - "warn"  when the cell lands with a warning in audit_warnings
 *   - "reject" when the entire declaration is rejected
 *
 * Cells from RFC §3.3.1:
 *   workflow kinds — all OK except:
 *     edit_observation + inference        -> warn
 *     edit_decision + inference           -> reject
 *     edit_decision + speculation         -> reject
 *     edit_explanation + inference        -> warn
 *     edit_explanation + speculation      -> reject
 *     edit_policy_change + inference      -> reject
 *     edit_policy_change + speculation    -> reject
 *   impl 14 SQLite kinds — all OK (no rejects, no warns; prose
 *   obligation is in the description footer)
 *   edit_cosmetic (§3.3.3) —
 *     accept: user_confirmed, accepted_artifact, direct_observation
 *     reject: inference, speculation
 */
export function evaluateKindProvenanceValidity(
  kind: ToolName,
  provenance: Provenance,
): MatrixVerdict {
  if (kind === "edit_cosmetic") {
    if (provenance === "inference" || provenance === "speculation") {
      return "reject";
    }
    return "accept";
  }
  if (kind === "edit_decision") {
    if (provenance === "inference" || provenance === "speculation") {
      return "reject";
    }
    return "accept";
  }
  if (kind === "edit_policy_change") {
    // Policy bytes cannot be moved on the basis of inference or
    // speculation — a policy change must trace back to a confirmed
    // source (user_confirmed / accepted_artifact) or be the mechanical
    // mirroring of an existing policy line (direct_observation, which
    // carries a soft warn via evaluateAdditionalFiles when batched).
    if (provenance === "inference" || provenance === "speculation") {
      return "reject";
    }
    return "accept";
  }
  if (kind === "edit_explanation") {
    if (provenance === "speculation") return "reject";
    if (provenance === "inference") return "warn";
    return "accept";
  }
  if (kind === "edit_observation") {
    if (provenance === "inference") return "warn";
    return "accept";
  }
  // edit_progress, edit_proposal, and all 14 impl tools: all combinations OK.
  return "accept";
}

/**
 * §3.3.2 — `additional_files` acceptance matrix (cell-wise).
 * Called only when `additional_files` is declared.
 *
 *                       u_c    a_a    d_o    inf    spec
 * edit_progress         rej    rej    rej    rej    rej
 * edit_observation      rej    warn   warn   warn   warn
 * edit_proposal         warn   acc    warn   warn   acc
 * edit_decision         acc    acc    warn   n/a    n/a
 * edit_explanation      acc    acc    acc    warn   n/a
 * edit_policy_change    acc    acc    warn   n/a    n/a
 *
 * The n/a cells are unreachable here because §3.3.1 already rejects
 * the (kind, provenance) pair; the caller checks validity first.
 * Defensive: if §3.3.1 ever loosens, an n/a cell falls through to
 * "reject" so an additional_files declaration cannot slip through
 * silently.
 */
export function evaluateAdditionalFiles(
  kind: ToolName,
  provenance: Provenance,
): MatrixVerdict {
  if (kind === "edit_progress") return "reject";
  if (kind === "edit_observation") {
    if (provenance === "user_confirmed") return "reject";
    return "warn";
  }
  if (kind === "edit_proposal") {
    if (provenance === "accepted_artifact") return "accept";
    if (provenance === "speculation") return "accept";
    return "warn";
  }
  if (kind === "edit_decision") {
    if (provenance === "user_confirmed") return "accept";
    if (provenance === "accepted_artifact") return "accept";
    if (provenance === "direct_observation") return "warn";
    return "reject"; // n/a guard
  }
  if (kind === "edit_explanation") {
    if (provenance === "user_confirmed") return "accept";
    if (provenance === "accepted_artifact") return "accept";
    if (provenance === "direct_observation") return "accept";
    if (provenance === "inference") return "warn";
    return "reject"; // n/a guard (speculation already rejected by §3.3.1)
  }
  if (kind === "edit_policy_change") {
    // Mirrors edit_decision: the common batch pattern is a single
    // policy line propagated across CLAUDE.md / SPEC.md /
    // descriptions.ts (the verbatim-mirror rule).
    if (provenance === "user_confirmed") return "accept";
    if (provenance === "accepted_artifact") return "accept";
    if (provenance === "direct_observation") return "warn";
    return "reject"; // n/a guard (inference / speculation already rejected by §3.3.1)
  }
  // Impl tools / edit_cosmetic do not accept additional_files at all —
  // they are not in TOOLS_ACCEPTING_ADDITIONAL_FILES. Defensive reject
  // in case the schema-level gate is bypassed.
  return "reject";
}

// SPEC §3.4: (kind × execution_state) audit matrix. The only non-accept
// cell is an impl tool (a fix attempt) declared in repeating_failure.
// No "reject" cell — soft per design Q3.
export function evaluateKindExecutionStateValidity(
  kind: ToolName,
  executionState: ExecutionState,
): MatrixVerdict {
  if (
    executionState === "repeating_failure" &&
    TOOLS_REQUIRING_TARGET.includes(kind)
  ) {
    return "warn";
  }
  return "accept";
}

/**
 * SPEC §3.3.5 — (kind, target, provenance) test-obligation matrix.
 * Called only for impl tools (kind ∈ TOOLS_REQUIRING_TARGET); the
 * validator's own allow-list gate is the workflow-target guard.
 *
 *                              u_c    a_a    d_o    inf    spec
 * target="test", 15 SQLite     OK     OK     warn   REJ    REJ
 * target="test", edit_cosmetic OK     OK     OK     OK     OK   (carve-out)
 * target="prod", any impl      OK across the board
 *
 * `edit_cosmetic` is exempt: whitespace / formatter / information-
 * invariant comment edits do not pin behavior, so spec-derivation
 * discipline does not apply. The carve-out parallels §3.3.3.
 */
export function evaluateTargetSpecDerivation(
  kind: ToolName,
  target: EditTarget,
  provenance: Provenance,
): MatrixVerdict {
  if (target === "prod") return "accept";
  if (kind === "edit_cosmetic") return "accept";
  if (provenance === "inference" || provenance === "speculation") {
    return "reject";
  }
  if (provenance === "direct_observation") return "warn";
  return "accept";
}

/**
 * Citation lint for `provenance: "accepted_artifact"`. RFC §3.2:
 * "the rationale MUST include at least one artifact reference (`§...`,
 * `ADR-...`, `issues/...`, `RFC-...`, or a URL); the server lints this
 * and warns if no reference is present." This is a structure-only
 * check — we do NOT verify the artifact exists or that its content is
 * consistent with the declaration.
 *
 * Returns true when the rationale carries at least one acceptable
 * artifact reference shape.
 */
const ARTIFACT_CITATION_RE = new RegExp(
  [
    "§",
    "\\bADR-\\w",
    "\\bRFC-\\w",
    "\\bissues/",
    "https?://",
  ].join("|"),
);
export function rationaleHasArtifactCitation(rationale: string): boolean {
  return ARTIFACT_CITATION_RE.test(rationale);
}

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
    // `target` is required on the 15 impl tools (14 SQLite-derived +
    // edit_cosmetic) and absent on the 6 workflow kinds. The schema
    // accepts it as optional; validateRequest enforces presence-on-impl
    // and absence-on-workflow per TOOLS_REQUIRING_TARGET (see
    // descriptions.ts).
    target: EditTargetSchema.optional(),
    // v0.6.0: every typed_edit declaration carries the epistemic-source
    // declaration. Required at the schema boundary so an agent that
    // forgets to declare it gets a zod validation error immediately,
    // rather than a softer validateRequest warning that could be
    // mistaken for "shippable".
    provenance: ProvenanceSchema,
    // design §4.1: required, no default — the forcing function dies
    // with a default. The .strict() schema rejects omission.
    execution_state: ExecutionStateSchema,
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

/**
 * Soft-signal warnings produced by validation matrices: a (kind, provenance)
 * cell flagged "warn", a citation-lint miss on accepted_artifact, an
 * additional_files cell flagged "warn". These are recorded in the edit
 * log so audit can see the soft signal, and surfaced to the agent via
 * `next_action`, but they do not block the declaration.
 *
 * Kept distinct from `warnings` (the rejection-channel field) so
 * downstream consumers can tell "still landed, with caveat" apart from
 * "rejected".
 */
export type AuditWarning = {
  /** Stable category code so log readers can group consistently. */
  code:
    | "kind_provenance_warn"
    | "additional_files_warn"
    | "citation_lint_missing"
    | "execution_state_repeating_failure"
    | "target_spec_derivation_warn"
    | "high_impact_kind_warn";
  message: string;
};

// v0.7.x: the 10 kinds whose blast radius justifies an unconditional
// audit warn — every declaration of one of these surfaces in audit
// summaries for separate review, regardless of provenance / target /
// execution_state. The warn is a soft signal (no rejection); the
// declaration still issues a grant. The set covers edit_policy_change
// (policy bytes) plus the SQLite-derived kinds whose failure modes are
// hardest to undo: schema changes, data migrations, API contracts,
// authz logic, runtime dependency / build config, concurrency,
// external side effects, cache invalidation, retry / timeout budgets.
// Per SPEC §3.5 (high-impact kind audit). Adding a kind to this set
// is itself an edit_policy_change.
export const HIGH_IMPACT_KINDS: readonly ToolName[] = [
  "edit_policy_change",
  "edit_db_schema",
  "edit_data_migration",
  "edit_api_contract",
  "edit_permission_logic",
  "edit_dependency_config",
  "edit_concurrency",
  "edit_external_side_effect",
  "edit_cache_invalidation",
  "edit_retry_timeout",
];

export type EditToolResult = {
  /**
   * Short human-readable status line placed first in the JSON result so
   * collapsed / preview-oriented clients can show the specific edit kind
   * without requiring the user to expand the whole MCP call.
   */
  summary?: string;
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
  /** Soft signals produced by v0.6.0 matrices (warn cells, citation lint). */
  auditWarnings: AuditWarning[];
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
  const auditWarnings: AuditWarning[] = [];

  // ---- 0. Repo-root sentinel (A1 / issue 1530) ------------------------
  // The MCP server intentionally boots even when the configured root
  // lacks a `.git` / `.jj` directory, so ListTools can inject the
  // twenty-one tool descriptions into the agent's context. The actual
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

  // ---- 1b. kind × provenance validity (RFC §3.3.1 / §3.3.3) -----------
  // The matrix is the validation rule. Cosmetic + inference/speculation,
  // decision + inference/speculation, and explanation + speculation are
  // rejected here. Observation + inference and explanation + inference
  // land but record a soft signal in auditWarnings.
  const kpVerdict = evaluateKindProvenanceValidity(toolName, request.provenance);
  if (kpVerdict === "reject") {
    warnings.push(
      `(kind=${toolName}, provenance=${request.provenance}) is rejected per ` +
        `SPEC §3.3.1 / §3.3.3. Reclassify the edit: pick a kind whose ` +
        `semantics permit this epistemic source, or pick a provenance ` +
        `whose certainty matches this kind.`,
    );
  } else if (kpVerdict === "warn") {
    auditWarnings.push({
      code: "kind_provenance_warn",
      message:
        `(kind=${toolName}, provenance=${request.provenance}) is atypical ` +
        `per SPEC §3.3.1. Land but consider whether the intent is closer ` +
        `to a different workflow kind.`,
    });
  }

  // ---- 1c. accepted_artifact citation lint (RFC §3.2) -----------------
  // Structure-only check (warn, never reject): a rationale that names
  // accepted_artifact as its source should also carry at least one
  // syntactically-recognizable citation. The lint does not verify the
  // artifact exists or that its content matches the declaration.
  if (
    request.provenance === "accepted_artifact" &&
    !rationaleHasArtifactCitation(request.rationale)
  ) {
    auditWarnings.push({
      code: "citation_lint_missing",
      message:
        `provenance="accepted_artifact" but the rationale has no ` +
        `recognizable artifact reference (\`§...\`, \`ADR-...\`, ` +
        `\`RFC-...\`, \`issues/...\`, or a URL). Add a citation so ` +
        `future readers can re-source the artifact.`,
    });
  }

  // ---- 1d. kind × execution_state validity (SPEC §3.4) ----------------
  if (
    evaluateKindExecutionStateValidity(toolName, request.execution_state) ===
    "warn"
  ) {
    auditWarnings.push({
      code: "execution_state_repeating_failure",
      message:
        `execution_state="repeating_failure" was declared on ${toolName}, ` +
        `an implementation fix attempt. This is a self-flagged loop signal, ` +
        `not a mismatch — group it by code, separate from §3.3 warnings. ` +
        `The escape move is edit_observation or edit_proposal: record the ` +
        `failure (reproduction conditions, recent changes, hypotheses) ` +
        `before stacking another fix.`,
    });
  }

  // ---- 1d-bis. high-impact kind unconditional warn (SPEC §3.5) --------
  // Every accepted declaration of a high-impact kind (HIGH_IMPACT_KINDS)
  // carries an unconditional audit warning so the declaration surfaces
  // in audit summaries for separate review. The warn is independent of
  // provenance / target / execution_state — it fires on every accepted
  // declaration of one of the listed kinds. (Rejected declarations
  // already carry the rejection signal in `warnings`; this channel
  // drops on rejection per the ValidationSuccess-only auditWarnings
  // contract.) The message is a single generic line so the set can
  // grow without per-kind prose maintenance.
  if (HIGH_IMPACT_KINDS.includes(toolName)) {
    auditWarnings.push({
      code: "high_impact_kind_warn",
      message:
        `kind=${toolName} is high-impact: the warn is unconditional so ` +
        `every declaration of this kind surfaces in audit summaries for ` +
        `separate review. No action required; the declaration lands ` +
        `(this signal does not block). Re-read the rationale, the ` +
        `obligation footer, and any LOOSEN-restriction implications ` +
        `once before the paired hook applies the patch.`,
    });
  }

  // ---- 1e. kind × target × provenance validity (SPEC §3.3.5) ----------
  // Defense-in-depth: gate on the impl-tools allow-list, not just on
  // request.target presence. A future schema regression that let a
  // workflow kind carry target cannot silently extend this matrix's
  // scope.
  if (
    TOOLS_REQUIRING_TARGET.includes(toolName) &&
    request.target !== undefined
  ) {
    const tsVerdict = evaluateTargetSpecDerivation(
      toolName,
      request.target,
      request.provenance,
    );
    if (tsVerdict === "reject") {
      warnings.push(
        `(kind=${toolName}, target="${request.target}", provenance=` +
          `${request.provenance}) is rejected per SPEC §3.3.5. A test ` +
          `declared with inferred or speculative provenance cannot pin ` +
          `spec-defined behavior. If the spec is unclear, stop and ask ` +
          `which document defines the behavior the test should pin.`,
      );
    } else if (tsVerdict === "warn") {
      auditWarnings.push({
        code: "target_spec_derivation_warn",
        message:
          `target="${request.target}" with provenance=` +
          `"${request.provenance}" usually means the test pins ` +
          `implementation-observed behavior, not spec-defined behavior ` +
          `(SPEC §3.3.5 impl-mirror smell). If the observation source ` +
          `is an external system (e.g. third-party API contract under ` +
          `test as regression), make the externality visible in the ` +
          `rationale. Otherwise re-classify provenance to ` +
          `accepted_artifact or user_confirmed citing the spec the ` +
          `test pins.`,
      });
    }
  }

  // ---- 2a. target field presence (impl tools require it; workflow forbids it) -
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
          `not apply to this workflow tool)`,
      );
    }
  }

  // ---- 2b. test_files cardinality (per §4 obligations + target rules) -----
  // The pair-by-tool model (v0.5.0): when target === "test", the
  // target_file IS the test file, so test_files must be empty. When
  // target === "prod", impl tools (excluding edit_cosmetic) must
  // forward-declare the test files the paired target: test call(s)
  // will modify. The 6 workflow-axis kinds carry no target and have
  // no executable behavior to forward-declare tests against — their
  // tool descriptions promise "Required tests: NONE. ... test_files
  // must be empty"; enforce that here so the promise actually holds
  // (a workflow declaration with test_files: ["..."] would otherwise
  // silently record fake test obligations in audit data — PR #96
  // codex review P2 on the policy_change reshape).
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
  } else if (WORKFLOW_TOOLS.includes(toolName)) {
    if (request.test_files.length > 0) {
      warnings.push(
        `test_files must be empty for ${toolName} (workflow-axis kinds ` +
          `carry no executable behavior — Required tests: NONE per the ` +
          `tool description)`,
      );
    }
  }

  // ---- 3. additional_files acceptance gate -----------------------------
  // Schema-level: only the 6 workflow-axis kinds (WORKFLOW_TOOLS, mirrored
  // into TOOLS_ACCEPTING_ADDITIONAL_FILES) may carry `additional_files`.
  // The 14 SQLite-derived impl tools and edit_cosmetic MUST omit it.
  //
  // Cell-level (RFC §3.3.2): for the 6 workflow kinds, acceptance is
  // decided by `evaluateAdditionalFiles(kind, provenance)`. The matrix
  // returns "accept" / "warn" / "reject". A reject here fails the whole
  // declaration; a warn records an audit signal and lands.
  if (request.additional_files !== undefined) {
    if (!TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName)) {
      warnings.push(
        `${toolName} does not accept additional_files; this field is reserved ` +
          `for the workflow-axis kinds (edit_observation, edit_proposal, ` +
          `edit_decision, edit_explanation, edit_policy_change; ` +
          `edit_progress always rejects). ` +
          `Submit each file as its own typed_edit call.`,
      );
    } else {
      const afVerdict = evaluateAdditionalFiles(toolName, request.provenance);
      if (afVerdict === "reject") {
        warnings.push(
          `(kind=${toolName}, provenance=${request.provenance}) does not ` +
            `accept additional_files per SPEC §3.3.2. Split the declaration: ` +
            `submit each file as its own typed_edit call, or pick a ` +
            `(kind, provenance) cell that accepts batching.`,
        );
      } else if (afVerdict === "warn") {
        auditWarnings.push({
          code: "additional_files_warn",
          message:
            `additional_files batch under (kind=${toolName}, ` +
            `provenance=${request.provenance}) is atypical per SPEC §3.3.2. ` +
            `Land but consider splitting if the unifying theme is thin. ` +
            `The rationale MUST name the theme explicitly.`,
        });
      }
    }
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
  // v0.6.0 / v0.7.x: the 6 workflow-axis kinds may carry additional_files.
  // Acceptance was decided cell-wise in step 3; this step just resolves
  // the bindings.
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
  return { ok: true, primaryBinding, additionalBindings, auditWarnings };
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

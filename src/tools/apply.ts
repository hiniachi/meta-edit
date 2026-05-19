// Case C / v0.2 thin grant issuer.
//
// In v0.1.x this module owned sibling-temp + parent-fsync + multi-phase
// TOCTOU defenses. In Case C the MCP server does NOT write — native Edit /
// Write performs the write under hook validation (Article 5). What remains
// is a thin path: validate the request, verify before_sha256 against disk,
// issue a single-use TTL-bound token, append the IssuedEntry to the edit
// log, return.
//
// The module name is preserved for git-history continuity. Its
// responsibility shifted; its size shrank from ~720 lines to ~150.

import {
  validateRequest,
  type EditToolRequest,
  type EditToolResult,
  type ToolHandler,
  type ValidatedBinding,
  type ValidationContext,
} from "./common.js";
import type { ToolName } from "./descriptions.js";
import type { GrantsStore } from "../state/grants.js";
import type { EditLog, IssuedEntry, RejectedEntry } from "../state/edit-log.js";
import { isoTimestamp } from "../state/edit-log.js";

export type IssuerDependencies = {
  ctx: ValidationContext;
  log: EditLog;
  grants: GrantsStore;
  /** Injectable clock for tests. Defaults to () => new Date(). */
  now?: () => Date;
};

/**
 * Wire a typed_edit handler that validates, verifies disk state, and issues
 * a single-use grant token. The actual write is performed later by native
 * Edit / Write, gated by the deny-raw-edit hook (Task C).
 */
export function makeIssuingHandler(deps: IssuerDependencies): ToolHandler {
  const { ctx, log, grants } = deps;
  const now = deps.now ?? (() => new Date());

  return async (toolName, args) => {
    return issueOnce(toolName, args, ctx, log, grants, now());
  };
}

async function issueOnce(
  toolName: ToolName,
  args: EditToolRequest,
  ctx: ValidationContext,
  log: EditLog,
  grants: GrantsStore,
  ts: Date,
): Promise<EditToolResult> {
  // Issue 0105-rejection-counter: defer the daily edit_id allocation
  // until AFTER validation passes. Rejected requests get a non-
  // sequential `reject_<dayKey>_<random>` audit handle so the daily
  // edit_id counter only advances on real issuances. Pre-fix the
  // counter advanced on every call, leaving permanent gaps in the
  // sequence; post-fix the sequence maps directly to "edits issued".
  const tsIso = isoTimestamp(ts);

  const validation = validateRequest(toolName, args, ctx);
  if (!validation.ok) {
    // Concatenate warnings into a single audit_error string per SPEC §6
    // ("non-empty audit_error so audit consumers always have an actionable
    // reason"). The warnings array on the EditToolResult preserves the
    // per-warning form for the caller.
    const auditMessage =
      validation.warnings.length === 0
        ? `${toolName}: validation rejected (no warnings)`
        : validation.warnings.join("; ");
    const rejectId = log.nextRejectId(ts);
    const rejected: RejectedEntry = {
      edit_id: rejectId,
      ts: tsIso,
      phase: "rejected",
      kind: toolName,
      target_file: args.target_file,
      audit_error: auditMessage,
    };
    const auditError = appendRejectedSafely(log, rejected);
    return {
      token: "",
      expires_at: "",
      edit_id: rejectId,
      warnings: validation.warnings,
      ...(auditError !== undefined ? { audit_error: auditError } : {}),
    };
  }

  // Validation passed — allocate the real edit_id, build the binding
  // list, and issue the grant.
  const editId = log.nextEditId(ts);
  const bindings: ValidatedBinding[] = [
    validation.primaryBinding,
    ...validation.additionalBindings,
  ];
  let grant;
  try {
    grant = await grants.issue({
      edit_id: editId,
      binding: bindings.map((b) => ({
        file: b.canonical,
        before_sha256: b.before_sha256,
      })),
    });
  } catch (e) {
    // Grant store failure is structurally distinct from validation failure:
    // the request is well-formed but persistence broke. Surface as a
    // warning and an audit_error, log a rejected entry so the gap is
    // visible in the audit trail.
    const reason = (e as Error | undefined)?.message ?? String(e);
    const rejected: RejectedEntry = {
      edit_id: editId,
      ts: tsIso,
      phase: "rejected",
      kind: toolName,
      target_file: args.target_file,
      audit_error: `grants.issue failed: ${reason}`,
    };
    const auditError = appendRejectedSafely(log, rejected);
    return {
      token: "",
      expires_at: "",
      edit_id: editId,
      warnings: [`grants.issue failed: ${reason}`],
      ...(auditError !== undefined
        ? { audit_error: auditError }
        : { audit_error: `grants.issue failed: ${reason}` }),
    };
  }

  const issued: IssuedEntry = {
    edit_id: editId,
    ts: tsIso,
    phase: "issued",
    kind: toolName,
    target_file: args.target_file,
    rationale: args.rationale,
    risk_level: args.risk_level,
    test_files: args.test_files,
    binding: bindings.map((b) => ({
      file: b.canonical,
      before_sha256: b.before_sha256,
    })),
    token: grant.token_id,
  };
  const auditError = appendIssuedSafely(log, issued);
  // Sanitize bound file paths for embedding in the human-readable
  // next_action string: replace ASCII control characters (including
  // newline / carriage return / tab) with '?' so a pathological
  // filename cannot corrupt the multi-line message rendered to the
  // agent's transcript. NUL is already rejected by checkPathSafety;
  // this guards the remaining 0x01-0x1f / 0x7f range.
  // eslint-disable-next-line no-control-regex
  const sanitize = (p: string) => p.replace(/[\x00-\x1f\x7f]/g, "?");
  const fileList = bindings.map((b) => sanitize(b.canonical)).join(", ");
  // v0.2.2: agent passes nothing extra to native Edit / Write / MultiEdit.
  // Claude Code's strict input schema strips additional fields, so the
  // hook resolves the active declaration server-side by file path. This
  // message tells the agent it can just call the native tool normally.
  const nFiles = bindings.length;
  const fileNoun = nFiles === 1 ? "file" : "files";
  // edit_docs_only is the one batch-friendly workflow tool: a single
  // declaration binds the whole batch and authorizes consecutive native
  // edits (one per bound file, any order, no per-file re-declaration)
  // until the batch is exhausted or the TTL expires (SPEC Article 6).
  // Surface that at declaration time so the agent does not re-declare
  // per file.
  const batchNote =
    toolName === "edit_docs_only"
      ? ` Because this is edit_docs_only (the batch-friendly workflow ` +
        `tool), this one declaration covers the whole batch: issue ` +
        `consecutive native Edit / Write calls against the bound ` +
        `${fileNoun} in any order — one per bound file, no per-file ` +
        `re-declaration — until every bound file is consumed or the ` +
        `TTL expires.`
      : "";
  const nextAction =
    `On your next native Edit / Write / MultiEdit call against ${fileList}, ` +
    `the deny-raw-edit hook will resolve this declaration automatically (no ` +
    `extra parameters needed). The declaration covers ${nFiles} ${fileNoun} ` +
    `and expires at ${grant.expires_at}.` +
    batchNote;
  return {
    token: grant.token_id,
    expires_at: grant.expires_at,
    edit_id: editId,
    warnings: [],
    next_action: nextAction,
    ...(auditError !== undefined ? { audit_error: auditError } : {}),
  };
}

function appendIssuedSafely(log: EditLog, entry: IssuedEntry): string | undefined {
  try {
    log.appendIssued(entry);
    return undefined;
  } catch (e) {
    return formatAuditError(entry.edit_id, e);
  }
}

function appendRejectedSafely(
  log: EditLog,
  entry: RejectedEntry,
): string | undefined {
  try {
    log.appendRejected(entry);
    return undefined;
  } catch (e) {
    return formatAuditError(entry.edit_id, e);
  }
}

function formatAuditError(editId: string, e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  const msg = (e as Error | undefined)?.message ?? String(e);
  return `failed to append edit log entry "${editId}" (${code ?? "ERR"}: ${msg}); the call result is reported but the audit record may be missing or incomplete`;
}

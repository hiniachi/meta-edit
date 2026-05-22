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
  TOOLS_ACCEPTING_ADDITIONAL_FILES,
  validateRequest,
  type EditToolRequest,
  type EditToolResult,
  type ToolHandler,
  type ValidatedBinding,
  type ValidationContext,
} from "./common.js";
import { type ToolName } from "./descriptions.js";
import type { GrantsStore } from "../state/grants.js";
import { buildReminderContext } from "../reminders/context.js";
import type {
  AuditWarningEntry,
  EditLog,
  IssuedEntry,
  RejectedEntry,
} from "../state/edit-log.js";
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
      ...(args.target !== undefined ? { target: args.target } : {}),
      // v0.6.0: log provenance on rejection so audit can group rejected
      // declarations by (kind, provenance) cell.
      provenance: args.provenance,
      audit_error: auditMessage,
    };
    const auditError = appendRejectedSafely(log, rejected);
    return {
      summary: rejectedSummary(toolName, args, validation.warnings.length),
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
      declaration: {
        kind: toolName,
        ...(args.target !== undefined ? { target: args.target } : {}),
        provenance: args.provenance,
        target_file: args.target_file,
        test_files: [...args.test_files],
      },
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
      ...(args.target !== undefined ? { target: args.target } : {}),
      provenance: args.provenance,
      audit_error: `grants.issue failed: ${reason}`,
    };
    const auditError = appendRejectedSafely(log, rejected);
    return {
      summary: rejectedSummary(toolName, args, 1),
      token: "",
      expires_at: "",
      edit_id: editId,
      warnings: [`grants.issue failed: ${reason}`],
      ...(auditError !== undefined
        ? { audit_error: auditError }
        : { audit_error: `grants.issue failed: ${reason}` }),
    };
  }

  // v0.6.0: capture validation's soft-signal warnings into the audit log
  // so meta-edit summary / log --provenance can recover them later. The
  // shape of AuditWarning lines up byte-for-byte with AuditWarningEntry
  // by design.
  const auditWarningEntries: AuditWarningEntry[] = validation.auditWarnings.map(
    (w) => ({ code: w.code, message: w.message }),
  );
  const issued: IssuedEntry = {
    edit_id: editId,
    ts: tsIso,
    phase: "issued",
    kind: toolName,
    target_file: args.target_file,
    rationale: args.rationale,
    risk_level: args.risk_level,
    // v0.5.0: persist the prod/test target so audit analysis can split
    // a kind's edits into prod vs test (the reshape's core motivation).
    // The 5 workflow kinds never set target; impl tools always have it
    // post-validation.
    ...(args.target !== undefined ? { target: args.target } : {}),
    // v0.6.0: provenance is required on every declaration; persist it
    // so audit and `meta-edit log --provenance` filters work.
    provenance: args.provenance,
    ...(auditWarningEntries.length > 0
      ? { audit_warnings: auditWarningEntries }
      : {}),
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
  // The 5 workflow-axis kinds (edit_observation / edit_proposal /
  // edit_decision / edit_explanation; edit_progress excluded since the
  // §3.3.2 matrix rejects additional_files for it) accept
  // additional_files batching. When a workflow kind binds multiple
  // files, surface the batch-consumption pattern at declaration time so
  // the agent does not re-declare per file. v0.6.0 replaces the v0.5.x
  // edit_docs_only single-tool batch note with the same wording scoped
  // to the workflow kinds.
  const batchNote =
    TOOLS_ACCEPTING_ADDITIONAL_FILES.includes(toolName) && nFiles > 1
      ? ` Because this is a workflow-axis kind (${toolName}) carrying ` +
        `additional_files, this one declaration covers the whole batch: ` +
        `issue consecutive native Edit / Write calls against the bound ` +
        `${fileNoun} in any order — one per bound file, no per-file ` +
        `re-declaration — until every bound file is consumed or the ` +
        `TTL expires.`
      : "";
  const declarationReminder = buildReminderContext({
    phase: "declaration_accepted",
    kind: toolName,
    ...(args.target !== undefined ? { target: args.target } : {}),
    provenance: args.provenance,
    targetFile: args.target_file,
    declaredTestFiles: args.test_files,
    auditWarnings: validation.auditWarnings,
  });
  const nextAction =
    `On your next native Edit / Write / MultiEdit call against ${fileList}, ` +
    `the deny-raw-edit hook will resolve this declaration automatically (no ` +
    `extra parameters needed). The declaration covers ${nFiles} ${fileNoun} ` +
    `and expires at ${grant.expires_at}.` +
    batchNote +
    `\n\n${declarationReminder}`;
  return {
    summary: declaredSummary(toolName, args, nFiles),
    token: grant.token_id,
    expires_at: grant.expires_at,
    edit_id: editId,
    warnings: [],
    next_action: nextAction,
    ...(auditError !== undefined ? { audit_error: auditError } : {}),
  };
}

function declaredSummary(
  toolName: ToolName,
  args: EditToolRequest,
  bindingCount: number,
): string {
  return [
    `${toolName} declared: ${sanitizeSummaryFragment(args.target_file)}`,
    args.target !== undefined ? `target=${args.target}` : undefined,
    `provenance=${args.provenance}`,
    `bindings=${bindingCount}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

function rejectedSummary(
  toolName: ToolName,
  args: EditToolRequest,
  warningCount: number,
): string {
  return [
    `${toolName} rejected: ${sanitizeSummaryFragment(args.target_file)}`,
    args.target !== undefined ? `target=${args.target}` : undefined,
    `provenance=${args.provenance}`,
    `warnings=${warningCount}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

// eslint-disable-next-line no-control-regex
const SUMMARY_CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;

function sanitizeSummaryFragment(value: string): string {
  return value.replace(SUMMARY_CONTROL_CHARS_RE, "?");
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

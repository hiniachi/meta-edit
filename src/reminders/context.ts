export type ReminderPhase = "declaration_accepted" | "write_allowed";

export type ReminderInput = {
  phase: ReminderPhase;
  kind?: string;
  target?: "prod" | "test";
  provenance?: string;
  targetFile?: string;
  declaredTestFiles?: readonly string[];
  auditWarnings?: readonly {
    code: string;
    message: string;
  }[];
  executionState?: string;
};

/**
 * Build the model-visible reminder text shared by typed-edit tool results
 * and successful raw-write hook allows. The wording follows the
 * reminder-style hook RFC: first-person recovery cue, semantic consequence,
 * and "wrong tool" language rather than blame.
 */
export function buildReminderContext(input: ReminderInput): string {
  const lines: string[] = [
    phaseLine(input),
    scopeReviewLine(input.phase),
    kindCueLine(input.kind),
    provenanceLine(input.provenance, input.phase),
    executionStateLine(input),
    targetFollowupLine(input),
    auditWarningsLine(input.auditWarnings, input.phase),
  ].filter((line): line is string => line !== undefined && line.length > 0);

  return `meta-edit reminder:\n\n${lines.join("\n\n")}`;
}

function phaseLine(input: ReminderInput): string {
  const kind = input.kind ?? "a typed meta-edit declaration";
  const target = targetPhrase(input.target, input.phase);
  const file = input.targetFile ? ` for ${sanitize(input.targetFile)}` : "";

  if (input.phase === "write_allowed") {
    return `This native write matched my ${kind}${target} declaration${file}. The tool result tells me whether the bytes actually landed.`;
  }

  return `I declared this as ${kind}${target}${file}. The next native Edit / Write / MultiEdit should stay inside that declaration.`;
}

function targetPhrase(
  target: ReminderInput["target"],
  phase: ReminderPhase,
): string {
  if (target === "prod") {
    return phase === "write_allowed"
      ? " production-code"
      : " for production code";
  }
  if (target === "test") return ' target="test"';
  return "";
}

function scopeReviewLine(phase: ReminderPhase): string | undefined {
  if (phase !== "write_allowed") return undefined;
  return (
    "Before moving on, I should check whether the chosen kind and file scope still match the actual edit. " +
    "If the write crossed another kind or file, the next move is a fresh typed declaration for that scope."
  );
}

function kindCueLine(kind: string | undefined): string | undefined {
  switch (kind) {
    case "edit_boundary_condition":
      return "The next test should pin just below, at, and just above the boundary.";
    case "edit_boolean_condition":
      return "The next test should make the important true/false condition combinations visible.";
    case "edit_state_transition":
      return "The next test should show the allowed transition and the forbidden transition.";
    case "edit_db_schema":
      return "The next check should cover the schema shape and the migration impact.";
    case "edit_data_migration":
      return "The next test should compare existing data before and after, and check idempotency.";
    case "edit_api_contract":
      return "The next test should expose the compatibility, status-code, or missing/extra-field contract.";
    case "edit_serialization":
      return "The next test should cover round-trip behavior and any legacy format still accepted.";
    case "edit_error_handling":
      return "The next test should drive the intended failure path and check the surfaced context.";
    case "edit_retry_timeout":
      return "The next test should cover retry count, timeout, and exhaustion behavior.";
    case "edit_concurrency":
      return "The next test should exercise the interleaving or duplicate action this change is meant to handle.";
    case "edit_external_side_effect":
      return "The next check should protect against duplicate or unintended external action.";
    case "edit_cache_invalidation":
      return "The next test should distinguish stale reads from refreshed reads.";
    case "edit_permission_logic":
      return "The next test should distinguish allowed and denied actors or states.";
    case "edit_dependency_config":
      return "The next check should make the runtime or environment impact explicit.";
    case "edit_policy_change":
      return "The next move should confirm the user-facing scope before treating this as settled policy.";
    case "edit_cosmetic":
      return "This should remain a semantic no-op: whitespace, comments, or formatter output only.";
    case "edit_decision":
      return "An edit_decision will be read as accepted project intent. If that is not true, edit_decision is the wrong tool.";
    case "edit_explanation":
      return "An edit_explanation will be read as shipped behavior for future readers. It should stay consistent with the code or observation source.";
    case "edit_progress":
      return "This should record session progress, not create new project policy.";
    case "edit_observation":
      return "This should keep the observed fact and evidence visible.";
    case "edit_proposal":
      return "This should stay proposal-shaped until accepted.";
    default:
      return kind === undefined
        ? undefined
        : "I should follow the obligations in the selected tool description before moving on.";
  }
}

const WORKFLOW_KINDS: ReadonlySet<string> = new Set([
  "edit_progress",
  "edit_observation",
  "edit_proposal",
  "edit_decision",
  "edit_explanation",
]);
const ESCAPE_KINDS: ReadonlySet<string> = new Set([
  "edit_observation",
  "edit_proposal",
]);

function executionStateLine(input: ReminderInput): string | undefined {
  const state = input.executionState;
  if (state === undefined || state === "normal") return undefined;
  if (state === "recovery") {
    return (
      "I am in recovery — a deliberate diagnosis mode entered after " +
      "recognizing a failure. Verify assumptions against primary sources " +
      "(official documentation, etc.), confirm a single hypothesis, and " +
      "make the next fix only then. Keep steps small and reversible. " +
      "Return to normal once the failure is resolved."
    );
  }
  if (state !== "repeating_failure") return undefined; // catch-all: unknown state values produce no text
  const kind = input.kind;
  if (kind === undefined) return undefined;
  if (ESCAPE_KINDS.has(kind)) {
    return (
      "I have acknowledged repeating_failure and I am recording it — this " +
      "is the right move. Write reproduction conditions, recent changes, " +
      "and competing hypotheses as three separate items. Ground each " +
      "hypothesis by checking my assumptions against primary sources " +
      "before forming it, and do not return to implementation fixes until " +
      "a single hypothesis is isolated."
    );
  }
  if (WORKFLOW_KINDS.has(kind)) {
    // edit_progress / edit_decision / edit_explanation: not a fix attempt
    // and not the escape move — no execution_state text.
    return undefined;
  }
  // impl tool (a fix attempt)
  if (input.phase === "write_allowed") {
    return (
      "This fix landed while I had declared repeating_failure. If I have " +
      "not yet run the escape procedure — record the failure with " +
      "edit_observation, check my assumptions against primary sources, " +
      "isolate one hypothesis — I should do that before the next edit " +
      "instead of stacking another fix."
    );
  }
  return (
    "I was about to keep implementing while repeating the same kind of " +
    "failure. Before stacking another fix I should run the escape " +
    "procedure — (1) record it with edit_observation: write reproduction " +
    "conditions, recent changes, and competing hypotheses as separate " +
    "items; (2) re-read the error message literally and check my " +
    "assumptions against primary sources (official documentation, the " +
    "actual source, execution logs); (3) narrow to a single hypothesis " +
    "and verify it with a minimal reproduction; (4) only then decide the " +
    "next move."
  );
}

function provenanceLine(
  provenance: string | undefined,
  phase: ReminderPhase,
): string | undefined {
  switch (provenance) {
    case "user_confirmed":
      return "Because the provenance is user-confirmed, the prose should stay inside the confirmed user intent.";
    case "accepted_artifact":
      return "Because the provenance is accepted artifact, the prose should keep the accepted artifact or citation visible.";
    case "direct_observation":
      return "Because the provenance is direct observation, the prose should keep the observation source visible.";
    case "inference":
      if (phase === "write_allowed") {
        return "Because the provenance is inference, if the landed prose sounds confirmed, I should revise it with a fresh typed declaration so the uncertainty is visible.";
      }
      return "Because the provenance is inference, I should land only if the prose carries that uncertainty instead of sounding confirmed.";
    case "speculation":
      if (phase === "write_allowed") {
        return "Because the provenance is speculation, if the landed prose reads as established fact, I should revise it with a fresh typed declaration so it stays marked as an unverified hypothesis.";
      }
      return "Because the provenance is speculation, I should land only if the prose is strongly hedged as an unverified hypothesis.";
    default:
      return undefined;
  }
}

function targetFollowupLine(input: ReminderInput): string | undefined {
  if (input.target === "prod" && input.declaredTestFiles && input.declaredTestFiles.length > 0) {
    return (
      `If the matching test was written first, the next move is to run that red test and confirm this production edit is what makes it pass. ` +
      `If no matching test exists yet, the next move is a target="test" declaration for ` +
      `${input.declaredTestFiles.map(sanitize).join(", ")}.`
    );
  }
  if (input.target === "test") {
    return (
      `This test edit should exercise this same kind of change, not drift into unrelated cleanup. ` +
      `If this is the TDD red step, it should fail against the current production code for the intended reason. ` +
      `If it already passes, it may not be proving the intended change.`
    );
  }
  return undefined;
}

function auditWarningsLine(
  auditWarnings: ReminderInput["auditWarnings"],
  phase: ReminderPhase,
): string | undefined {
  if (auditWarnings === undefined || auditWarnings.length === 0) {
    return undefined;
  }
  const summary = auditWarnings
    .map((w) => `[${w.code}] ${w.message}`)
    .join("\n  - ");
  if (phase === "write_allowed") {
    return (
      `audit warnings were recorded for this declaration:\n  - ${summary}\n` +
      `If the landed edit did not account for them, I should revise with a fresh typed declaration and keep the chosen kind honest.`
    );
  }
  return (
    `audit warnings recorded for this declaration:\n  - ${summary}\n` +
    `I should land only if the prose carries that uncertainty and the chosen kind is still the right tool.`
  );
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;

function sanitize(value: string): string {
  return value.replace(CONTROL_CHARS_RE, "?");
}

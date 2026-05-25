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
    kindObligationsLine(input),
    provenanceLine(input.provenance, input.phase),
    executionStateLine(input),
    targetFollowupLine(input),
    auditWarningsLine(input.auditWarnings, input.phase),
  ].filter((line): line is string => line !== undefined && line.length > 0);

  return `meta-edit reminder:\n\n${lines.join("\n\n")}`;
}

// SPEC §3.3.5 per-kind × per-target obligations relocated from
// description bodies into the reminder. Workflow kinds (no target
// axis) and edit_cosmetic (carve-out) return undefined. Wording is
// SQLite-testing-methodology-derived (see docs/plan/spec-derivation-
// matrix/design.md §6.1) but runtime text strips section markers per
// D15 — the reading agent should not be sent to sqlite.org/testing.html
// from a declaration result.
type KindTargetObligations = { readonly prod: string; readonly test: string };
const KIND_TARGET_OBLIGATIONS: Readonly<Record<string, KindTargetObligations>> = {
  edit_boundary_condition: {
    test:
      "This test pins the defined limits of the boundary — both sides of the threshold and the case just beyond it where the spec says an error is the correct answer. The impl-mirror smell is a single off-by-one fixed-point lifted from the production code; real boundary tests push the system right to the edge of its defined limits. Cite an accepted_artifact that names the limit; if the only provenance is direct_observation against prod, the boundary the test pins is whatever the implementation happens to do, not what was promised.",
    prod:
      "You forward-declared boundary-value tests; this production edit must keep the defined limits stable on both sides. Movement of the threshold itself is a different kind — re-classify, do not absorb.",
  },
  edit_boolean_condition: {
    test:
      "This test pins the decision — every atomic condition independently flips the outcome, not merely drives the predicate to true once and false once. The impl-mirror smell is one happy-path case and one failure case, which achieves statement coverage but cannot show that each sub-condition matters. Cite an accepted_artifact stating the rule the predicate encodes; direct_observation provenance usually means \"I read && and || and wrote a case per branch\", which mirrors the implementation.",
    prod:
      "You committed to predicate-level tests; this production edit must keep each clause's independent effect on the outcome observable. Collapsing two conditions or short-circuiting one away breaks the matrix — re-derive it from the spec, do not let the new code shape it.",
  },
  edit_state_transition: {
    test:
      "This test pins the legal transition graph — which states reach which, which transitions are forbidden, and what invariant holds across each edge. The impl-mirror smell is a test that walks the exact sequence the code happens to implement and only asserts the final state. Cite an accepted_artifact drawing the state diagram; cover at least one forbidden transition explicitly.",
    prod:
      "You forward-declared state-transition tests; this production edit must preserve which legal transitions reach which states, which transitions are forbidden, and the across-edge invariants. Adding or removing a state, or changing reachability, is a spec-level change — surface it.",
  },
  edit_db_schema: {
    test:
      "This test pins the schema invariants — uniqueness, foreign-key closure, nullability, index reachability. Inspecting the produced schema shape is fine; sourcing the expected shape from the current CREATE TABLE is the impl-mirror smell. Cite an accepted_artifact (ERD, data dictionary, ADR) naming each invariant; direct_observation against the migration is a happy-path round-trip, not an invariant test.",
    prod:
      "You committed to schema-invariant tests; this production edit must keep the invariants enforceable by the DB itself (constraints, indexes, FKs). Moving a constraint from the DB to application code is a separate decision — surface it, do not weaken the schema and lean on tests to catch it.",
  },
  edit_data_migration: {
    test:
      "This test pins the anomaly behavior of the migration — what holds if the process dies mid-way, what holds on re-run, what holds under compound failure. Inspecting produced data is fine; the expected before/after invariants come from the migration's stated invariants, not from sampling current prod rows. The impl-mirror smell is a \"ran in a clean DB, counted rows, looks fine\" test, which is the happy path. The idempotency test runs first.",
    prod:
      "You forward-declared anomaly-style migration tests; this production migration must remain safe under interruption and re-run. A new atomic step the old migration did not require changes the anomaly surface — re-derive the test list, do not reuse the old one.",
  },
  edit_api_contract: {
    test:
      "This test pins the published interface — request shape, response shape, status codes, error semantics — using only what callers can observe. The impl-mirror smell is a test asserting on internal serialization order, internal field names not in the contract, or response timing the spec does not promise. Cite an accepted_artifact (OpenAPI / IDL / RFC / contract doc); direct_observation lets the test accidentally pin implementation leaks.",
    prod:
      "You committed to contract-level tests; this production edit must keep the published interface stable. Adding a field, narrowing input, or widening output is a contract change — re-classify, do not absorb.",
  },
  edit_serialization: {
    test:
      "This test pins two things: round-trip equivalence (serialize → deserialize → same value) and malformed-input robustness (parser must reject bytes changed by some means other than the canonical serializer, without unwholesome actions). The impl-mirror smell is a test that round-trips through the same library version's own encoder and decoder — that proves a fixed point of the current implementation, not format compatibility. Include at least one cross-version or hand-crafted byte fixture.",
    prod:
      "You forward-declared round-trip and malformed-input tests; this production edit must keep the serialized form readable by older consumers (or explicitly bump a version) and keep the parser robust against bytes it did not produce. Regenerating fixtures from the new encoder destroys the equivalence signal — re-derive fixtures from the spec.",
  },
  edit_error_handling: {
    test:
      "This test pins behavior under injected failure, not behavior on the happy path — rig a dependency to fail after a certain number of operations and assert both that the error is reported correctly and no invariant is violated. The impl-mirror smell is a test asserting try/catch fires on a real (uninjected) error during setup: that mirrors the catch block the code happens to have, not the spec's promise about errors. Cite an accepted_artifact listing which failure modes the contract acknowledges; run both single-failure and continuous-failure modes where the surface allows.",
    prod:
      "You committed to fault-injection tests; this production edit must keep every error path observable from the outside (correct code returned, no resource leaked, no invariant violated). A catch that drops the error silently is the failure case those tests exist to detect.",
  },
  edit_retry_timeout: {
    test:
      "This test pins the exhaustion semantics — how many retries, what backoff, what the caller sees after the final attempt — and the compound case where the retry itself encounters a new failure. The impl-mirror smell is asserting \"after retry succeeds, value matches\": that proves the retry loop exits, not that the policy is correct. Cover the \"Nth attempt succeeds\" case (recovery point advances) and the \"every attempt fails\" case (continuous-failure mode) plus the compound case \"retry path itself hits a different failure\". Cite an accepted_artifact naming the retry budget.",
    prod:
      "You forward-declared retry/timeout exhaustion tests; this production edit must keep the budget, backoff schedule, and giveup signal compatible with what those tests assert. Silent budget extension masks an underlying error — surface it.",
  },
  edit_concurrency: {
    test:
      "This test pins the across-interleaving invariant — what must always hold regardless of which thread interleaves where — not a particular observed interleaving. Assert mutexes are held at all the right moments; assert that nothing is written to X which has not first been written and synced to Y. The impl-mirror smell is running two threads, hitting a race a few times by luck, and asserting no exception fires — that pins the OS schedule, not the invariant. Cite an accepted_artifact naming the invariant (lock order, happens-before relation, atomicity boundary); prefer a precondition/postcondition assertion to a probabilistic schedule.",
    prod:
      "You committed to interleaving-invariant tests; this production edit must keep the lock order / happens-before / atomicity boundary intact. Widening or narrowing a critical section is a relevant change — re-derive the invariant list, do not lean on existing tests to catch a regression they were not designed for.",
  },
  edit_external_side_effect: {
    test:
      "This test pins what is sent to the outside world — count, ordering, idempotency under replay — track outbound effects (emails, webhooks, payments, log lines) and report leaks on every test run. The impl-mirror smell is asserting the side-effect function was called once on the happy path, with no retry-replay assertion, no partial-failure assertion, no ordering assertion: that pins the call site, not the contract. Cite an accepted_artifact describing the at-least-once / at-most-once / exactly-once contract; direct_observation gives you the production frequency, which is a fact about traffic, not about the contract.",
    prod:
      "You forward-declared side-effect accounting tests; this production edit must keep the at-least-once / at-most-once / exactly-once posture stated in the test, and keep emissions idempotent under retry. Adding a side effect to a previously side-effect-free path is a re-classification. If your test makes a real external call, your test is wrong — that prohibition stays in force.",
  },
  edit_cache_invalidation: {
    test:
      "This test pins the freshness invariant: cached answer must equal authoritative answer for every input. The impl-mirror smell is a write-through read-back test (the easiest case, read-your-own-writes) that entirely skips the cross-actor invalidation case where someone else changed the underlying data. Run the scenario with the cache enabled and again with it busted, assert identical results. Cite an accepted_artifact naming the staleness budget; direct_observation gives you the TTL window, not the contract.",
    prod:
      "You committed to freshness-invariant tests; this production edit must keep the equivalence cached answer == authoritative answer intact for every documented invalidation trigger. A new write path that does not invalidate the cache silently widens the staleness window — the canonical failure this kind exists to catch.",
  },
  edit_permission_logic: {
    test:
      "This test pins the authorization matrix — every (principal, resource, action) cell exercised in both allow and deny direction, where each axis independently flips the decision. The impl-mirror smell is a test that walks the if/else ladder in the authz function and writes one case per leaf: that proves the code is consistent with itself, not that the matrix matches the policy. Cite an accepted_artifact (RBAC table, policy doc, ADR); direct_observation is a strong smell because in prod you only see allowed requests at scale — denied requests are the negative space and must be tested explicitly.",
    prod:
      "You forward-declared an authz matrix; this production edit must keep every cell's allow/deny decision matching the cited policy. Loosening a deny or tightening an allow is edit_policy_change, not this kind — re-classify, do not let the matrix drift.",
  },
  edit_dependency_config: {
    test:
      "This test pins behavior across the dependency / build matrix — the same answer must come out regardless of optimization level, signed-char default, endianness, or word size. The impl-mirror smell is a test that succeeds on the developer's exact toolchain version and silently depends on it: that pins the dev environment, not the supported environment. Cite an accepted_artifact (supported-versions table, MSRV / engines policy, build-matrix CI config); for a pinned dependency version, include at least the boundary versions of the supported range.",
    prod:
      "You committed to build-matrix tests; this production edit must keep the equivalence \"same answer across all supported build variants\" intact. Tightening a version range is edit_policy_change; widening it requires fresh evidence from each new supported point — do not extrapolate.",
  },
  // edit_policy_change is now a workflow-axis kind (v0.9.0): no
  // target field, no test_files, no kindObligationsLine. Its reminders
  // come from kindCueLine (the "confirm user-facing scope" cue) and
  // the description's load-bearing Fallback-obligation paragraph
  // ("ask the user before applying"). The reminder that policy-impl
  // code routes through edit_permission_logic / edit_dependency_config
  // / edit_api_contract lives in those tools' obligations, not here.
};

function kindObligationsLine(input: ReminderInput): string | undefined {
  const { kind, target } = input;
  if (kind === undefined || target === undefined) return undefined;
  if (kind === "edit_cosmetic") return undefined; // §3.3.5 carve-out
  const entry = KIND_TARGET_OBLIGATIONS[kind];
  if (entry === undefined) return undefined; // workflow kinds + any unknown kind
  return target === "prod" ? entry.prod : entry.test;
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
  "edit_policy_change",
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

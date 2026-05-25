// The twenty-one tool descriptions, copied verbatim from docs/SPEC.md §4.
// CLAUDE.md §4 forbids paraphrasing, summarizing, or "improving" these.
// If you change a description here, update docs/SPEC.md §4 in the same change.
//
// v0.3.1: edit_create_file and edit_create_planning_artifact were
// removed. Empty file creation is now free at the deny-raw-edit hook
// level (no MCP declaration required for content === "" Write to a
// non-existent in-repo path). Content fills go through the appropriate
// SQLite-derived tool's modify path, treating the now-empty file as
// before_sha256 = sha256(""). The "create" act stops being a special
// workflow and becomes orthogonal to the type system — empty files
// have no logic to gate.
//
// v0.5.0: edit_test_only_change was removed and edit_refactor_only was
// renamed to edit_cosmetic with a much narrower scope (whitespace /
// comments / formatter output only). Test edits are now expressed as a
// second invocation of the same impl tool with `target: "test"`, paired
// with the original `target: "prod"` declaration. The 33% information-
// less mass of edit_test_only_change is redistributed across the 15
// SQLite-derived impl tools; risk weight, audit and rationale follow
// the implementation domain rather than collapsing into a generic test
// bucket. edit_cosmetic's vocabulary is intentionally narrow — anything
// outside whitespace / comments / formatter output goes through a kind-
// specific tool or stop-and-ask.
//
// v0.6.0: edit_docs_only was retired and split along a workflow axis
// into five new kinds — edit_progress, edit_observation, edit_proposal,
// edit_decision, edit_explanation — so the same Markdown file is
// classified by the intent of the current session moment, not by its
// path. All twenty-one tools now carry a required `provenance` field
// declaring the epistemic source of the edit (user_confirmed /
// accepted_artifact / direct_observation / inference / speculation).
// edit_cosmetic was further narrowed to whitespace + formatter +
// information-invariant comment edits only; comments that add or change
// information go through the workflow kind matching their intent.

export const TOOL_NAMES = [
  "edit_cosmetic",
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
  // 6 workflow-axis kinds — v0.6.0 introduced 5 (replacing edit_docs_only);
  // v0.7.x added edit_policy_change as the 6th after the observation that
  // policy bytes are prose, not impl: the spec / policy text changes here,
  // the code that implements the new policy routes through the matching
  // impl kind (e.g. edit_permission_logic for hook logic changes).
  // axis: not "which path is this file under" but "what is this edit
  // doing in the current session moment" (intent). The same Markdown
  // file may go through different tools across sessions depending on
  // whether it is a progress note, an observation, a proposal, a
  // decision, an explanation, or a policy change.
  "edit_progress",
  "edit_observation",
  "edit_proposal",
  "edit_decision",
  "edit_explanation",
  "edit_policy_change",
  // 14 SQLite-derived impl tools + edit_cosmetic + 6 workflow tools = 21.
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_TITLES = Object.freeze(
  Object.fromEntries(
    TOOL_NAMES.map((name) => [
      name,
      `${name}: ${name.replace(/^edit_/, "").replace(/_/g, " ")} declaration`,
    ]),
  ),
) as Readonly<Record<ToolName, string>>;

// Workflow kinds — v0.6.0 introduced 5 (replacing edit_docs_only);
// v0.7.x added edit_policy_change as the 6th after recognizing that
// policy bytes are prose, not impl. Workflow kinds carry no `target`
// field (the prod/test axis does not apply to documentation / workflow
// artifacts) and require no `test_files` (workflow content is not
// tested in the impl-tool sense). They MAY accept `additional_files`,
// but acceptance is decided cell-wise by (kind, provenance) per
// docs/SPEC.md §3 (see common.ts evaluateAdditionalFiles).
export const WORKFLOW_TOOLS: readonly ToolName[] = [
  "edit_progress",
  "edit_observation",
  "edit_proposal",
  "edit_decision",
  "edit_explanation",
  "edit_policy_change",
];

export const TOOLS_REQUIRING_TEST_FILES: readonly ToolName[] = TOOL_NAMES.filter(
  (name) =>
    name !== "edit_cosmetic" &&
    !WORKFLOW_TOOLS.includes(name),
);

// Tools that carry a required `target: "prod" | "test"` field. The 14
// SQLite-derived impl tools plus edit_cosmetic — every tool that can edit
// either production or test code. The 6 workflow kinds are exempt
// (documentation / workflow / policy content has its own surface and
// the prod/test split does not apply).
export const TOOLS_REQUIRING_TARGET: readonly ToolName[] = TOOL_NAMES.filter(
  (name) => !WORKFLOW_TOOLS.includes(name),
);

// Shared provenance block appended to every tool description. v0.6.0 adds
// `provenance` as a required declaration field on all 21 tools, per
// docs/SPEC.md §3. The five values plus the prose-obligation guidance are
// identical across tools; kind-specific reject/warn rules (cosmetic,
// edit_decision, edit_explanation, edit_observation) live in the
// individual tool descriptions as a "Provenance combinations:" line.
//
// Prose obligation: per RFC §3.4, uncertainty is expressed in the prose
// itself (the bytes that future readers — AI and human — actually see),
// not in side-channel structural markers. The server does not inject,
// parse, or verify any structural marker; the only enforcement on
// provenance is the schema-level enum, the citation-syntax lint for
// accepted_artifact, and the kind × provenance reject/warn rules.
const PROVENANCE_FOOTER = `Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- \`user_confirmed\` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- \`accepted_artifact\` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (\`§...\`, \`ADR-...\`, \`issues/...\`, \`RFC-...\`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- \`direct_observation\` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- \`inference\` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- \`speculation\` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.`;

// Shared execution state block appended to every tool description after
// PROVENANCE_FOOTER. v0.7.0 adds `execution_state` as a required
// declaration field on all 21 tools, per docs/SPEC.md §3.4 and the
// execution-state-declaration design doc §4.4 / §4.7 / §4.1.1.
// The three-value lifecycle (normal → repeating_failure → recovery → normal)
// is identical across tools; the edit_observation description additionally
// carries the escape paragraph (§4.1.1) that names this tool as the first
// move when repeating_failure is recognized.
const EXECUTION_STATE_FOOTER = `Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- \`normal\` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- \`repeating_failure\` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- \`recovery\` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.`;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  edit_cosmetic: `Surface-level edit with no semantic effect and no information change:
whitespace, formatter output, or comment edits that do not change the
information content of the comment.

Cosmetic edits are exempt from spec-derivation discipline —
whitespace, formatter output, and information-invariant comment
edits do not pin behavior.

Use this tool when, and ONLY when, the patch is one of the following:
- Whitespace adjustment (indentation, blank lines, trailing whitespace,
  line breaks)
- Comment edits that change NO information content (typo fix,
  line-break reflow within a comment block, formatter-driven comment
  reformatting). Comments that add or change information go through the
  workflow kind that matches the comment's intent — \`edit_explanation\`
  for reader-facing clarification, \`edit_observation\` for
  observed-fact notes (\`// XXX ...\`, stale-comment deletions),
  \`edit_proposal\` for open questions (\`// TODO ...\`,
  \`// FIXME ...\`).
- Output of a configured formatter run (gofmt, prettier, black, rustfmt,
  etc.) — the bytes produced by running the project's formatter, with
  no manual edits layered on top

This tool MUST NOT be used for:
- Variable, function, type, parameter, or file renames — there is no
  generic "rename" tool by design. If the rename crosses an exported
  boundary, use edit_api_contract. If the rename is internal only, stop
  and ask the user (the typed surface does not yet have a tool for that
  shape; observe how often this comes up before adding one)
- Function or module extraction, inlining, or restructuring — stop and
  ask
- Dead code removal — stop and ask, then use the impl tool matching the
  code's original kind (the removal may have observable consequences
  that the original kind's tests already cover)
- Reordering of declarations whose order carries meaning (CSS
  specificity, dependency injection priority, init order, decorator
  stack order)
- Import / export / visibility modifier changes — these are
  edit_api_contract (if exported) or stop-and-ask
- Any change that touches comparison, boolean, guard, return shape,
  error handling, serialization, permission, cache, concurrency,
  retry/timeout, side effects, or persistence — use the kind-specific
  impl tool

Required tests: NONE. Existing tests must continue to pass. test_files
may be empty.

Target (required):
Declare \`target: "prod"\` for cosmetic edits to production files, or
\`target: "test"\` for cosmetic edits to test files. Cosmetic changes
do not require behavioral tests in either case; \`test_files\` may be
empty.

Fallback obligation:
If, after applying this tool, you discover that your patch did anything
beyond whitespace / comment / formatter output (a rename slipped in, a
guard clause moved, an import was reorganized in a way that affects
linting or shadowing), you owe the user a follow-up explanation in your
next message: name what slipped in, and say why the narrow definition
did not catch it before you applied. This is a personal debt that posts
to the user, not a detection bypass — acknowledging the slip is what
keeps the typed surface honest.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (cosmetic-specific):
This tool accepts only \`user_confirmed\`, \`accepted_artifact\`, and
\`direct_observation\`. Declaring \`inference\` or \`speculation\` here
is rejected. cosmetic has zero semantic effect, so epistemic uncertainty
is a structural signal that the kind selection is wrong: the patch
likely adds or changes information (in which case use the matching
workflow kind) or changes behavior (in which case use the kind-specific
impl tool). Re-classify before retrying.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_boundary_condition: `Modify a comparison, threshold, limit, or boundary in production code.

The boundary value being changed is defined by the spec / accepted
artifact / user statement, not by what the implementation currently
happens to compute.

Use this tool when:
- Changing comparison operators (<, <=, >, >=, ==, !=)
- Changing numeric limits or thresholds (max, min, cap, floor, ceiling)
- Changing range bounds (loop bounds, array sizes, page sizes)
- Changing pagination, rate limit, timeout duration, retry count
- Changing buffer or window sizes

Per-target obligations (what \`target: "prod"\` commits to, what
\`target: "test"\` must contain) are delivered in the declaration
result. If you cannot enumerate all three boundary values
(just-below, at, just-above) for this change at declaration time,
the boundary semantics are unclear; stop and ask the user to clarify
which value should be inclusive and which should be exclusive before
declaring.

When \`target: "prod"\`, \`test_files\` must list at least one file
where the boundary tests will be added. Existing test files are
acceptable.

Target (required):
Declare \`target: "prod"\` for the production-side edit and
\`target: "test"\` for the test-side edit. The two declarations may
land in either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_boolean_condition: `Modify a boolean expression, conditional logic, or guard clause in
production code.

The boolean rule being changed is defined by the spec / accepted
artifact / user statement (the business rule, policy, or invariant),
not by what the implementation currently happens to evaluate.

Use this tool when:
- Changing boolean operators (&&, ||, !)
- Adding or removing conditions in an if / else / switch
- Adding or removing guard clauses or early returns
- Changing the structure of conditional branching
- Changing null / nil / undefined checks

Per-target obligations (path coverage, independent influence of each
atomic condition, and a test that distinguishes the new logic from
the old) are delivered in the declaration result.

If the boolean change is purely a transformation that preserves truth
values (e.g., De Morgan's law applied), it still goes through this tool —
the rewritten bytes affect future readers and modifiers, so the kind-
specific risk surface still applies. edit_cosmetic is reserved for
whitespace / comments / formatter output only and does NOT cover boolean
restructuring.

Target (required):
Declare \`target: "prod"\` for the production-side edit and
\`target: "test"\` for the test-side edit. The two declarations may
land in either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_state_transition: `Modify a state machine, workflow, or status transition in production code.

The state machine being changed (which transitions are legal, which
are forbidden, what invariant holds across each edge) is defined by
the state diagram / transition table / accepted artifact, not by
what the current code happens to allow.

Use this tool when:
- Adding, removing, or modifying allowed transitions between states
- Changing what triggers a state transition
- Adding or removing valid states
- Changing the side effects that occur on transition

Per-target obligations (allowed-transition coverage, forbidden-
transition rejection with no partial state change, invalid-input
no-op) are delivered in the declaration result.

If your change adds new states, you must also test transitions from
existing states into the new states, and from the new states to existing
states (where allowed).

Target (required):
Declare \`target: "prod"\` for the production-side edit (state
machine) and \`target: "test"\` for its transition tests. The two
declarations may land in either order — red-first (\`target: "test"\`
first, then \`target: "prod"\`) or green-first (\`target: "prod"\`
first, then \`target: "test"\`) — and both may land in the same
commit. When \`target: "test"\`, \`target_file\` IS the test file
and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_db_schema: `Modify database schema: tables, columns, indexes, constraints, migrations.

The schema invariants being changed (uniqueness, foreign-key closure,
nullability, index reachability) are defined by the data model / ERD /
accepted ADR, not by what the current CREATE TABLE statement happens
to produce.

Use this tool when:
- Adding, removing, or modifying columns, tables, indexes
- Changing constraints (NOT NULL, UNIQUE, FOREIGN KEY, CHECK)
- Creating or modifying migration files (DDL)
- Changing collation, charset, or storage parameters

Per-target obligations (migration applies cleanly, existing data
compatibility, rollback OR forward-only justification, index /
constraint behavior) are delivered in the declaration result.

If your change modifies existing data (UPDATE statements, data
backfills), you MUST also use edit_data_migration alongside this tool.

Target (required):
Declare \`target: "prod"\` for the production-side edit (migration /
DDL) and \`target: "test"\` for the migration tests. The two
declarations may land in either order — red-first (\`target: "test"\`
first, then \`target: "prod"\`) or green-first (\`target: "prod"\`
first, then \`target: "test"\`) — and both may land in the same
commit. When \`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_data_migration: `Modify production data through migration scripts, backfills, or
data-transformation code.

The before/after invariants being established are defined by the
migration spec / accepted artifact, not by what the current data
happens to look like in production.

Use this tool when:
- Backfilling data into new columns
- Transforming or normalizing existing data
- Correcting bad data through scripted updates
- Splitting or merging records

Per-target obligations (idempotency, partial-failure recovery, fixture
transformation, edge cases) are delivered in the declaration result.
**The idempotency test is the single most important one — write it
first.** That ordering is load-bearing.

Target (required):
Declare \`target: "prod"\` for the production-side edit (migration /
backfill script) and \`target: "test"\` for the migration tests. The
two declarations may land in either order — red-first
(\`target: "test"\` first, then \`target: "prod"\`) or green-first
(\`target: "prod"\` first, then \`target: "test"\`) — and both may
land in the same commit. When \`target: "test"\`, \`target_file\`
IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_api_contract: `Modify the request or response shape of an API: endpoints, fields, status
codes, schemas.

The contract being changed is defined by the spec / accepted
artifact (OpenAPI, IDL, RFC, ADR), not by what the current handler
implementation happens to return.

Use this tool when:
- Adding, removing, or renaming fields in API request or response
- Changing field types or formats
- Changing status codes returned for given conditions
- Adding or removing endpoints
- Modifying OpenAPI / GraphQL / gRPC schema files

Per-target obligations (what \`target: "prod"\` commits to —
backward compatibility, missing/extra field handling, status-code
coverage — and what the matching \`target: "test"\` file must
contain) are delivered in the declaration result.

If the change is a breaking change, the rationale field must say so
explicitly, e.g., "Breaking change: removing the deprecated \`legacyId\`
field. Migration plan: ..."

Target (required):
Declare \`target: "prod"\` for the production-side edit (handlers,
schemas, OpenAPI / GraphQL / gRPC definitions) and \`target: "test"\`
for the contract tests. The two declarations may land in either order
— red-first (\`target: "test"\` first, then \`target: "prod"\`) or
green-first (\`target: "prod"\` first, then \`target: "test"\`) — and
both may land in the same commit. When \`target: "test"\`,
\`target_file\` IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_serialization: `Modify a serializer, parser, codec, or data format handler.

The format contract being changed (byte-level layout, supported
versions, what counts as malformed) is defined by the format spec /
RFC / data dictionary, not by what the current encoder happens to
emit.

Use this tool when:
- Changing JSON / YAML / XML / Protobuf / MessagePack handling
- Modifying custom binary or text formats
- Changing how data is encoded for storage or transport
- Modifying compatibility layers between format versions

Per-target obligations (round-trip equivalence, read-old-format,
write-new-format, malformed-input rejection) are delivered in the
declaration result.

If the format change is intentionally non-backward-compatible, the
rationale must say so and describe the migration path for existing data.

Target (required):
Declare \`target: "prod"\` for the production-side edit (serializer /
parser / codec) and \`target: "test"\` for its round-trip / old-format
/ invalid-input tests. The two declarations may land in either order
— red-first (\`target: "test"\` first, then \`target: "prod"\`) or
green-first (\`target: "prod"\` first, then \`target: "test"\`) — and
both may land in the same commit. When \`target: "test"\`,
\`target_file\` IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_error_handling: `Modify how errors, exceptions, or failure paths are handled.

The failure surface being changed (which errors propagate, in what
form, with what observable signal) is defined by the contract /
accepted artifact, not by whatever the current code happens to throw.

Use this tool when:
- Adding, removing, or modifying try / catch blocks
- Changing what exceptions are thrown or how they propagate
- Modifying fallback or retry logic on failure
- Changing rollback behavior on partial success
- Changing what is logged or reported on error

Per-target obligations (failure-path execution, observable error,
post-failure state, error type / code) are delivered in the
declaration result.

Swallowing exceptions is forbidden unless the rationale explicitly states
why and what the recovery path is.

Target (required):
Declare \`target: "prod"\` for the production-side edit (error-handling
code) and \`target: "test"\` for the tests that exercise failure paths
and observable-error contracts. The two declarations may land in
either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_retry_timeout: `Modify retry, timeout, or backoff behavior.

The retry budget being changed (retry count, backoff schedule,
timeout, giveup signal) is defined by the SLA / accepted artifact,
not by whatever value is currently configured in production.

Use this tool when:
- Changing retry counts, retry intervals, or backoff strategies
- Modifying timeout durations
- Adding or removing retry logic
- Changing idempotency keys or duplicate-detection logic

Per-target obligations (timeout exhaustion, retry exhaustion, no
duplicate side effects under retry, success-on-retry) are delivered
in the declaration result.

Target (required):
Declare \`target: "prod"\` for the production-side edit (retry /
timeout / backoff logic) and \`target: "test"\` for its exhaustion /
duplicate-side-effect / success-on-retry tests. The two declarations
may land in either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_concurrency: `Modify concurrency primitives: locks, transactions, mutexes, parallelism,
race conditions.

The concurrency invariant being changed (atomicity boundary, lock
order, happens-before relation) is defined by the spec / accepted
artifact / concurrency model, not by what the current code happens
to interleave.

Use this tool when:
- Adding, removing, or modifying locks (mutex, RWLock, semaphore)
- Changing transaction boundaries or isolation levels
- Modifying parallel execution (async, threads, goroutines)
- Changing lock ordering or scope
- Adding or removing critical sections

Per-target obligations (consistent-final-state under concurrent
execution, race-prevention coverage, atomic-scope assertions) are
delivered in the declaration result.

If you cannot reproduce the race or contention this change addresses,
the change is speculative. Prefer to demonstrate the bug with a failing
test before applying the fix.

Target (required):
Declare \`target: "prod"\` for the production-side edit (concurrency
primitives) and \`target: "test"\` for the concurrency tests. The
two declarations may land in either order — red-first
(\`target: "test"\` first, then \`target: "prod"\`) or green-first
(\`target: "prod"\` first, then \`target: "test"\`) — and both may
land in the same commit. When \`target: "test"\`, \`target_file\`
IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_external_side_effect: `Modify code that produces external side effects: emails, events, queue
messages, webhooks, billing operations, audit logs.

The side-effect contract being changed (when it fires, against whom,
with what payload, at-least-once / at-most-once / exactly-once
posture) is defined by the integration spec / accepted artifact, not
by the production frequency the current code happens to produce.

Use this tool when:
- Adding, removing, or modifying calls that affect external systems
- Changing what events are emitted or to whom
- Modifying billing or payment-affecting logic
- Changing notification logic
- Adding or removing audit or compliance logging

Per-target obligations (fires-on-success, no-fire-on-failure,
idempotency under retry, correct recipient / payload) are delivered
in the declaration result.

For test environments, side effects MUST be mocked or routed to a test
sink. Verify that the test does not actually charge a card or send a
real email. **If your test makes a real external call, your test is
wrong.** This prohibition is load-bearing.

Target (required):
Declare \`target: "prod"\` for the production-side edit (side-effect-
producing code) and \`target: "test"\` for its tests. The two
declarations may land in either order — red-first (\`target: "test"\`
first, then \`target: "prod"\`) or green-first (\`target: "prod"\`
first, then \`target: "test"\`) — and both may land in the same
commit. When \`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_cache_invalidation: `Modify cache keys, TTLs, invalidation logic, or staleness handling.

The freshness contract being changed (staleness budget, invalidation
events, TTL) is defined by the spec / accepted artifact, not by what
the current cache code happens to return.

Use this tool when:
- Changing cache key generation
- Modifying TTL or expiration logic
- Adding or removing invalidation triggers
- Changing what is cached or where

Per-target obligations (stale-data prevention, invalidation-trigger
coverage, TTL boundary, key collision) are delivered in the
declaration result.

Target (required):
Declare \`target: "prod"\` for the production-side edit (cache key /
TTL / invalidation logic) and \`target: "test"\` for its tests. The
two declarations may land in either order — red-first
(\`target: "test"\` first, then \`target: "prod"\`) or green-first
(\`target: "prod"\` first, then \`target: "test"\`) — and both may
land in the same commit. When \`target: "test"\`, \`target_file\`
IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_permission_logic: `Modify authorization, access control, role checks, ownership checks,
tenancy, or feature flag gating.

The authorization matrix being changed (which subjects may take which
actions on which resources) is defined by the policy / RBAC table /
ADR, not by what the current authz code happens to allow.

Use this tool when:
- Changing role / permission / owner / tenant / feature flag checks
- Modifying access control predicates
- Changing the subject-action-resource matrix
- Modifying authentication state checks
- Changing API key, token, or session validation

Per-target obligations (allow matrix coverage, deny matrix coverage,
negative-side-effect-on-deny, edge cases: suspended user / expired
token / missing role / deleted resource) are delivered in the
declaration result.

If you cannot enumerate the allow matrix and the deny matrix for this
change, the change is too risky to apply without further specification.
Stop and ask for the matrix to be confirmed before proceeding.

Target (required):
Declare \`target: "prod"\` for the production-side edit (permission /
authz code) and \`target: "test"\` for the allow / deny matrix tests
and negative-side-effect tests. The two declarations may land in
either order — red-first (\`target: "test"\` first, then
\`target: "prod"\`) or green-first (\`target: "prod"\` first, then
\`target: "test"\`) — and both may land in the same commit. When
\`target: "test"\`, \`target_file\` IS the test file and
\`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_dependency_config: `Modify package dependencies, runtime configuration, or feature
configuration files.

The dependency / config contract being changed (supported versions,
runtime defaults, environment expectations) is defined by the
supported-versions table / MSRV / build-matrix CI config / accepted
artifact, not by what is on the developer's machine right now.

Use this tool when:
- Adding, removing, or upgrading package dependencies
- Modifying runtime config (env vars, config files)
- Changing feature flag default values
- Modifying build or deploy configuration that affects runtime behavior

Per-target obligations (build / install reproducibility, behavior
under new config, default-value backward compatibility) are
delivered in the declaration result.

For security-related dependency upgrades, the rationale must say so
explicitly.

Boundary with edit_policy_change (Cargo.toml / pyproject.toml / package.json
overlap). Manifests with mixed personalities — package metadata + build
profile + per-target optimization flags — sometimes straddle the line.
Use edit_dependency_config when the change is about WHICH packages are
present at WHICH versions (the dep graph or runtime config). Use
edit_policy_change when the change is about HOW the build / release
runs (release profile flags, codegen options, CI behavior, lint rules).
A Cargo.toml \`[dependencies]\` entry update is dependency_config; a
\`[profile.release]\` flag flip (e.g. \`opt-level\`, \`lto\`,
\`wasm-opt = false\`) is policy_change. When a single PR touches both
sections, split into two declarations.

Fallback obligation:
Before applying this tool, summarize the change in user-facing
terms: which package, what version delta, runtime vs dev, expected
impact on the build or development loop. Surprise dependency
updates are how contributors lose a day to a broken local
environment; the user has standing to intercept before it lands.

Target (required):
Declare \`target: "prod"\` for the production-side edit (manifest /
config) and \`target: "test"\` for tests that exercise the new
configuration. The two declarations may land in either order —
red-first (\`target: "test"\` first, then \`target: "prod"\`) or
green-first (\`target: "prod"\` first, then \`target: "test"\`) — and
both may land in the same commit. When \`target: "test"\`,
\`target_file\` IS the test file and \`test_files\` must be empty.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_policy_change: `Modify the policy itself — the bytes that DEFINE how this project
expects code and configuration to be written: hooks' policy text,
Claude permissions, CI configuration affecting meta-edit, this
server's tool descriptions, the SPEC sections that the server
enforces, or the AI-instruction documents (CLAUDE.md, AGENTS.md,
\`.cursor/rules\`, etc.) that future sessions read first.

This tool addresses the *declaration* of a policy change — the prose
/ configuration text that future sessions will read as authoritative.
The code that *implements* the new policy (e.g. hook logic for a new
deny rule, schema additions for a new field, CI scripts that
materialize the new gate) routes through the matching impl kind —
typically \`edit_permission_logic\` for hook behavior,
\`edit_api_contract\` for argument schemas, \`edit_dependency_config\`
for build-tooling pieces — because the spec / policy comes first and
the implementation follows.

The policy line being moved is defined by the policy text / ADR /
compliance requirement, not by what the current configuration
happens to allow.

Use this tool when, and ONLY when, the patch is one of the following:
- Modifying \`.claude/\` configuration (the policy text itself)
- Modifying \`.github/workflows/\` files that affect meta-edit
- Modifying AI-instruction files (CLAUDE.md, AGENTS.md,
  \`.cursor/rules\`, etc.)
- Modifying tool descriptions of \`edit_*\` tools themselves
- Modifying SPEC.md / ADR / RFC sections that define behavior the
  server enforces
- Modifying build / release profile flags in package manifests
  (\`[profile.release]\` in Cargo.toml, \`[tool.poetry.build]\` in
  pyproject.toml, \`scripts\` / \`engines\` mutations in package.json
  that change how the project builds or releases) — see the boundary
  note in edit_dependency_config

This tool MUST NOT be used for:
- Code that *implements* a policy (hook handler logic, schema
  validators, CI scripts) — those go through the matching impl kind.
  The policy *text* changes here; the policy *implementation*
  changes elsewhere
- Recording that a policy change was decided in this session — that
  is \`edit_decision\`, written before the policy bytes change
- Editing executable production code or test code — use the
  kind-specific impl tool

Policy changes that LOOSEN restrictions (allowing previously-denied
operations, reducing test obligations, removing obligations from
\`edit_*\` tool descriptions, removing or weakening hook deny rules)
require an explicit justification in rationale that explains why the
loosening is safe. "Convenience" is not an acceptable rationale.

If your change loosens a restriction without a strong justification,
do not use this tool. Reconsider whether the restriction was correct
in the first place.

Fallback obligation:
Before applying this tool, ask the user a clarifying question about
the intended scope of the policy change, even when the change feels
obvious. A single confirmation message is the cost of the safer path.
Loosening restrictions, modifying hook behavior, and editing tool
descriptions all carry implications the user has the standing to
weigh; do not assume.

Required tests: NONE. Policy bytes are prose / configuration — not
executable; \`test_files\` must be empty. Tests for the *code that
implements* a policy are forward-declared by that impl kind's own
paired declaration (e.g. the paired \`edit_permission_logic\` /
\`target: "prod"\` call that adds the hook handler).

This tool does NOT carry a \`target\` field: policy / configuration
content does not belong to the prod/test axis. The prod/test target
flag is required only on the 15 impl tools (14 SQLite-derived +
\`edit_cosmetic\`).

\`additional_files\` cardinality:
This tool accepts \`additional_files\` for \`user_confirmed\` and
\`accepted_artifact\` (the common pattern: a single policy line is
mirrored across CLAUDE.md, SPEC.md, and \`descriptions.ts\` in one
declaration — CLAUDE.md §4's verbatim-mirror rule makes this a
natural batch) and warns for \`direct_observation\` (which usually
means you are recording what was already there, not asserting a new
policy line). The \`inference\` and \`speculation\` cells are
unreachable because the declaration itself is rejected at the (kind,
provenance) level — policy bytes cannot be moved on the basis of
inference or speculation.

Rationale: policy bytes are what future sessions read as "this is how
we work." Conflating policy with inference or speculation lets
unverified opinion become operating procedure for the next session.
The workflow is: decisions are made first (\`edit_decision\`); the
policy bytes are then changed here (\`edit_policy_change\`); code that
implements the new policy follows in its matching impl kind.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_policy_change-specific):
This tool rejects \`inference\` and \`speculation\` — policy bytes
must trace back to a confirmed source. The typical provenance is
\`user_confirmed\` (a policy change confirmed by the user in the
current session; quote or summarize the confirming statement in the
rationale) or \`accepted_artifact\` (codifying a previously-accepted
ADR / RFC / spec section into the policy artifact). \`direct_observation\`
is accepted when the edit is mechanical mirroring of an
already-existing policy line between artifacts (e.g. propagating a
CLAUDE.md change into \`descriptions.ts\` per the verbatim-mirror
rule), and lands with an audit_warnings note because "observing" a
policy usually means recording an existing one rather than asserting
a new one.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_progress: `Record what was actually done, tried, or observed in the current
session — a session work-log entry. The most common target is
\`IMPLEMENTATION-LOG.md\`, but the same intent applies wherever the
project keeps session work-log notes.

Use this tool when, and ONLY when, the entry is one of the following:
- "I implemented X" — recording a concrete change that was just made
- "I tried Y, and Z was the result" — recording an attempt and its
  outcome (whether the attempt worked or not)
- "what worked / known issues / open questions" sections about what
  happened in this session
- Phase-completion entries that summarize what shipped in the session
- Dogfood notes about the agent's own behavior in this session

This tool MUST NOT be used for:
- Recording decisions ("we will adopt X") — those are \`edit_decision\`,
  written only after the decision is confirmed
- Recording observations generalized beyond the session ("X breaks when
  Y") — those are \`edit_observation\` (the observation outlives the
  session that found it)
- Proposing changes or raising open questions about the future — those
  are \`edit_proposal\`
- Describing how the system works for a future reader — that is
  \`edit_explanation\`
- Editing executable production code, test code, or configuration —
  use the matching kind-specific impl tool
- Asserting authoritative outcomes about other sessions' work
  (\`I observed that the previous session's X is wrong\`) — observation
  about another session's artifact is \`edit_observation\` or
  \`edit_proposal\`

Required tests: NONE. Progress notes are not executable; \`test_files\`
must be empty.

This tool does NOT carry a \`target\` field: workflow / progress
content does not belong to the prod/test axis. The prod/test target
flag is required only on the 15 impl tools (14 SQLite-derived +
\`edit_cosmetic\`).

\`additional_files\` cardinality:
This tool rejects \`additional_files\` in every provenance cell.
Progress is a per-session, per-place record — a batched progress note
across multiple files is almost always two separate moments fused, and
the audit log stays cleaner when each moment is its own declaration.
Split the entry.

Rationale: a progress entry exists to record what happened in this
session moment, not to argue for or against a course of action.
Conflating progress with decisions or proposals erases the distinction
between "done" and "should be done" — the exact distinction this
refactor is meant to restore.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_progress-specific):
All five provenance values are accepted. The typical value is
\`direct_observation\` (the agent observed itself doing the work).
\`inference\` / \`speculation\` are accepted but the prose obligation
is strict: hedging language must surface in the body, not only in the
provenance field. A session work-log entry written with
\`speculation\` provenance whose prose reads as a confirmed outcome is
the exact "past-chat looks like a decision" failure this refactor is
meant to prevent.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_observation: `Record an observation, surprise, finding, or gotcha — content that
is meant to outlive the session that found it. The most common targets
are \`OBSERVED-FAILURES.md\`, code comments that flag known-bad
patterns (\`// XXX ...\`, \`// HACK ...\`), and bug-pattern notes
elsewhere in the project.

Use this tool when, and ONLY when, the entry is one of the following:
- "A breaks B when condition C holds" — recording a discovered failure
  pattern that will matter to future sessions
- "Adding code comment that an existing pattern is unsafe / surprising
  / load-bearing" (\`// XXX heredoc + redirect bypasses cat-substring
  scan\`)
- Stale-comment deletion that records "the previous comment was wrong"
- Dogfood records of agent behavior that generalizes beyond one
  session (\`AI consistently misclassifies X as Y when ...\`)

This tool MUST NOT be used for:
- Proposing a fix for the observation — observation and proposal are
  separate edits. If you want to record both ("X is broken, we should
  do Y about it"), write the observation here and a paired
  \`edit_proposal\` for the fix
- Writing an observation as a decision ("we will not use X because of
  this") — that is \`edit_decision\`
- Implementing a detector or check for the observed pattern — patch-
  content detection is out of scope per Article 7 / CLAUDE.md §3
- Editing executable code or tests — observation tools record
  observations; the kind-specific impl tool implements them
- Citing observations you did not actually make ("I observed that ..."
  with no concrete trace) — \`direct_observation\` provenance requires
  a visible observation source in the prose

Required tests: NONE. Observations are not executable; \`test_files\`
must be empty.

This tool does NOT carry a \`target\` field. The prod/test target flag
is required only on the 15 impl tools.

\`additional_files\` cardinality:
This tool rejects \`additional_files\` for \`user_confirmed\` and warns
for every other provenance value. Observations are usually per-place;
batching across files at observation time is usually two separate
findings fused. If the same observation truly applies across multiple
files (e.g., adding the same \`// XXX\` comment across a cluster of
modules that share an invariant), warn lets it land — but the rationale
MUST explicitly name the unifying theme. If the theme cannot be stated
in one sentence, split.

Rationale: observation is an act of generalization. A future session
encountering the observation file picks up the lesson without retracing
the discovery. Mixing observation with proposal / decision erodes the
file's value as a lesson archive.

escaping a repeating_failure spiral:
This is the tool to reach for first when you have noticed you are
repeating the same class of failure. Record the reproduction
conditions, the recent changes, and the competing hypotheses as
separate items, and verify your assumptions against primary sources
(official documentation, the actual source, execution logs) before
forming the next hypothesis. Declare this edit with
provenance: direct_observation — the reproduction conditions and
recent changes are directly observed, and the hypotheses are framed
as hedged prose — so the escape stays in this tool's typical
provenance cell and does not trip a kind/provenance warning.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_observation-specific):
The typical provenance is \`direct_observation\` (you observed the
gotcha while doing other work). \`inference\` is accepted but warns:
declaring "observation + inference" usually means you are running an
inference about an observation, which is closer to \`edit_proposal\`.
Re-read the entry; if the body reads as "this is what I think, given
what I saw", route it through \`edit_proposal\` instead.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_proposal: `Raise a proposal, question, or open issue — content meant to start
or continue a deliberation about what to do. The most common targets
are files under \`issues/\`, RFC drafts under \`docs/plan/\`, ADR
drafts, and code comments that open a question (\`// TODO ...\`,
\`// FIXME ...\`).

Use this tool when, and ONLY when, the entry is one of the following:
- "Should we adopt X?" — raising a question the user / project owner
  has not yet answered
- Drafting an issue, RFC, or ADR that proposes a change but is not yet
  approved
- Adding a code comment that opens an open question (\`// TODO: revisit
  after Y\`, \`// FIXME: this assumes Z\`)
- Recording a course of action you are weighing, where the choice is
  still open

This tool MUST NOT be used for:
- Recording a decision that has already been made — that is
  \`edit_decision\`. A proposal becomes a decision only after the user
  (or the relevant decision authority) confirms it
- Implementing the proposed change in the same edit — implementation
  belongs to the kind-specific impl tool, separately, and only after
  the proposal is accepted
- Writing a proposal as if it were already approved (\`We will adopt
  X\`) — proposals describe options under consideration, not
  commitments
- Fabricating user consent (\`As the user agreed ...\` without a
  verbatim user statement to point to) — \`user_confirmed\` provenance
  requires actual user confirmation, not a guess about what the user
  would have agreed to

Required tests: NONE. Proposals are not executable; \`test_files\`
must be empty.

This tool does NOT carry a \`target\` field. The prod/test target flag
is required only on the 15 impl tools.

\`additional_files\` cardinality:
This tool accepts \`additional_files\` for \`accepted_artifact\` and
\`speculation\` (the typical proposal-burst patterns: a feature-kickoff
exploratory burst of issue stubs, or an artifact-driven sweep of
follow-up issues from an audit document) and warns for the other three
provenance values. When \`additional_files\` is used, the rationale
MUST name the unifying theme. If the theme cannot be stated in one
sentence, split the declaration.

Rationale: proposals model the open question. Conflating proposal with
decision erodes the agent's ability to tell, on a re-read, what has
been accepted vs. what is still being weighed.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_proposal-specific):
The typical provenance is \`speculation\` (the proposal is exploratory
by nature). All five values are accepted. When provenance is
\`speculation\`, the prose obligation is especially strict — open with
strong hedging (\`**Unverified**:\`, \`**Hypothesis**:\`, \`TODO:
verify — ...\`) so future readers do not pick up the proposal as a
decision.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_decision: `Record a decision that has already been made. The most common
targets are accepted ADRs, CHANGELOG entries for releases that this
commit actually cuts, and IMPLEMENTATION-LOG entries that capture a
confirmed direction.

Use this tool when, and ONLY when, the entry is one of the following:
- "Decided to adopt X" — recording a direction after the user (or the
  relevant decision authority) has confirmed it
- Promoting an accepted proposal: the proposal lives under
  \`edit_proposal\`; the confirmation that the proposal is accepted
  lives under \`edit_decision\`
- CHANGELOG entries for a release that this commit produces
- Release commit batches that update CHANGELOG + version + plugin
  manifests in one place (use \`additional_files\` for the batch)

This tool MUST NOT be used for:
- Recording a proposal that has not yet been confirmed — that is
  \`edit_proposal\`. Decision presumes confirmation
- Writing inferences or hypotheses as decisions — declaring
  \`inference\` or \`speculation\` here is rejected (\`inference\` /
  \`speculation\` decisions are a contradiction in terms; re-route to
  \`edit_proposal\` until confirmation lands)
- Fabricating user consent — \`user_confirmed\` provenance requires
  actual user confirmation, with the confirming statement quoted or
  summarized in the rationale
- Editing executable code or tests — decisions are recorded; the
  kind-specific impl tool implements them
- Editing build / CI / meta-edit configuration that itself encodes a
  policy decision — that is \`edit_policy_change\`, which keeps the
  governance surface visible

Required tests: NONE. Decision records are not executable;
\`test_files\` must be empty.

This tool does NOT carry a \`target\` field. The prod/test target flag
is required only on the 15 impl tools.

\`additional_files\` cardinality:
This tool accepts \`additional_files\` for \`user_confirmed\` and
\`accepted_artifact\` (the typical release-commit and spec-driven
batch patterns) and warns for \`direct_observation\`. The
\`inference\` and \`speculation\` cells are unreachable because the
declaration itself is rejected at the (kind, provenance) level. Where
the batch is accepted, the rationale SHOULD still name the unifying
theme; where it is warned, the rationale MUST name the theme.

Rationale: decisions are the records future sessions read as
\`already settled.\` Conflating decision with inference or
speculation produces the exact "past-chat looks like a confirmed
decision" failure this refactor is meant to prevent.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_decision-specific):
This tool rejects \`inference\` and \`speculation\`. The typical
provenance is \`user_confirmed\` (decisions are made by the user /
decision authority). \`accepted_artifact\` is accepted when the
decision is the codification of a previously-accepted artifact (an
ADR that this entry promotes from draft to accepted). When
provenance is \`direct_observation\`, that usually means the
"decision" is closer to an observation — re-classify if the prose
reads as observation rather than as a commitment.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_explanation: `Explain or document known facts for a reader. The most common
targets are README files (and their translations), docs/, JSDoc /
docstrings, API documentation, and code comments whose purpose is to
explain how a thing works (\`/** function does X */\`).

Use this tool when, and ONLY when, the entry is one of the following:
- Reader-facing explanation of a shipped feature, function, or
  behavior
- Filling out a docs/ surface with material from an accepted spec /
  ADR / API contract
- Adding or updating a JSDoc / docstring that documents an existing
  API contract
- Synchronizing translations of an explanation across multiple
  README files (use \`additional_files\` for the batch)
- Reformulating an existing explanation to be clearer — but only
  when the information content remains the same; if the explanation
  is revised to say something different, the underlying fact must
  already be true and accepted

This tool MUST NOT be used for:
- Describing future or aspirational behavior (\`This will ...\` for a
  feature that has not shipped) — that is \`edit_proposal\` until the
  behavior actually ships, then \`edit_explanation\` afterwards
- Promoting an unverified hypothesis to an explanation — declaring
  \`speculation\` here is rejected. Explanation is a contract with
  future readers; speculative explanations mislead more than they
  clarify
- Documenting an API contract change as if it were always documented
  this way — the contract change is \`edit_api_contract\`; the
  reader-facing doc that catches up is \`edit_explanation\`
- Editing executable code or tests — explanation tools record what
  the code already does; the kind-specific impl tool changes
  behavior
- Updating a CHANGELOG entry for a release that this commit does not
  actually cut — CHANGELOG entries for cut releases are
  \`edit_decision\`; queued / unreleased entries do not belong in
  CHANGELOG yet
- Batching unrelated explanations across multiple files in one
  declaration — each independent doc surface gets its own
  \`edit_explanation\` call unless the files share a single
  originating theme (the typical accepted batch is multilingual
  README sync)

Required tests: NONE. Explanations are not executable; \`test_files\`
must be empty.

This tool does NOT carry a \`target\` field. The prod/test target flag
is required only on the 15 impl tools.

\`additional_files\` cardinality:
This tool accepts \`additional_files\` for \`user_confirmed\`,
\`accepted_artifact\`, and \`direct_observation\` (the typical
multilingual-sync and spec-sweep patterns) and warns for
\`inference\`. The \`speculation\` cell is unreachable because the
declaration itself is rejected at the (kind, provenance) level. Where
the batch is accepted, the rationale SHOULD name the unifying theme;
where it is warned, the rationale MUST name the theme.

Recommended verifications (not enforced):
- Internal links resolve
- Code blocks (if any) are syntactically valid in their stated
  language
- Terminology is consistent with the rest of the project documentation
- No accidental references to renamed APIs or removed features

Rationale: explanation is a contract with future readers (AI and
human). A reader-facing explanation that mixes confirmed facts with
unverified speculation poisons every later citation that depends on
it.

${PROVENANCE_FOOTER}

${EXECUTION_STATE_FOOTER}

Provenance combinations (edit_explanation-specific):
This tool rejects \`speculation\`. The typical provenance is
\`accepted_artifact\` (the explanation is derived from an accepted
spec, ADR, or API contract; quote the artifact in the rationale and,
where natural, in the prose). \`inference\` is accepted but warns:
explanations sourced from inference are usually better when re-sourced
from an accepted artifact, since the explanation outlives the inference
that produced it.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
};

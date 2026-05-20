// The seventeen tool descriptions, copied verbatim from docs/SPEC.md §4.
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
  "edit_policy_change",
  "edit_docs_only",
  // 15 SQLite-derived impl tools + edit_cosmetic + 1 workflow tool
  // (edit_docs_only) = 17. Down from 18 in v0.4.x: edit_test_only_change
  // was removed (test edits go through impl tools with target: "test"),
  // and edit_refactor_only was narrowed and renamed to edit_cosmetic.
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOLS_REQUIRING_TEST_FILES: readonly ToolName[] = TOOL_NAMES.filter(
  (name) =>
    name !== "edit_cosmetic" &&
    name !== "edit_docs_only",
);

// Tools that carry a required `target: "prod" | "test"` field. The 15
// SQLite-derived impl tools plus edit_cosmetic — every tool that can edit
// either production or test code. edit_docs_only is exempt (documentation
// is its own surface; the prod/test split does not apply).
export const TOOLS_REQUIRING_TARGET: readonly ToolName[] = TOOL_NAMES.filter(
  (name) => name !== "edit_docs_only",
);

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  edit_cosmetic: `Surface-level edit with no semantic effect: whitespace, comments, or
formatter output only.

Use this tool when, and ONLY when, the patch is one of the following:
- Whitespace adjustment (indentation, blank lines, trailing whitespace,
  line breaks)
- Comment edits (typo fix, rewording, adding clarifying comments,
  removing stale comments)
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

Rationale for the narrow scope:
edit_cosmetic intentionally has a narrow vocabulary — whitespace,
comments, formatter output — to avoid being a hiding place for behavior
changes rationalized as "just a refactor". If your change does not fit
this narrow definition, the typed surface does not have a tool for what
you want. Stop and ask the user. That friction is the design: the absence
of a generic refactor tool forces the question "what kind of change is
this, really?"

Fallback obligation:
If, after applying this tool, you discover that your patch did anything
beyond whitespace / comment / formatter output (a rename slipped in, a
guard clause moved, an import was reorganized in a way that affects
linting or shadowing), you owe the user a follow-up explanation in your
next message: name what slipped in, and say why the narrow definition
did not catch it before you applied. This is a personal debt that posts
to the user, not a detection bypass — acknowledging the slip is what
keeps the typed surface honest.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_boundary_condition: `Modify a comparison, threshold, limit, or boundary in production code.

Use this tool when:
- Changing comparison operators (<, <=, >, >=, ==, !=)
- Changing numeric limits or thresholds (max, min, cap, floor, ceiling)
- Changing range bounds (loop bounds, array sizes, page sizes)
- Changing pagination, rate limit, timeout duration, retry count
- Changing buffer or window sizes

Required tests (you MUST cover all three of these per boundary):
1. Value just below the boundary (boundary - 1, or just-outside)
2. Value exactly at the boundary
3. Value just above the boundary (boundary + 1, or just-inside)

These three cases are non-negotiable. Off-by-one errors are the most common
bug class in this category, and SQLite testing methodology treats boundary
tests as a hard requirement. If your change has multiple boundaries
(e.g., both a min and a max), all three cases must be tested for each
boundary.

If you cannot enumerate all three boundary values for this change, the
boundary semantics are unclear. Stop and ask the user to clarify which
value should be inclusive and which should be exclusive, before applying
the edit.

test_files must list at least one file where these three cases will be
added. Existing test files are acceptable.

Target (required):
Declare \`target: "prod"\` when editing the production boundary itself,
or \`target: "test"\` when editing the boundary tests (the file pointed
at by your earlier target: prod declaration's \`test_files\`). One
declaration covers one target — pair a target: prod call with a
target: test call to land both within the same commit. When target is
"test", \`target_file\` IS the test file and \`test_files\` must be
empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_boolean_condition: `Modify a boolean expression, conditional logic, or guard clause in
production code.

Use this tool when:
- Changing boolean operators (&&, ||, !)
- Adding or removing conditions in an if / else / switch
- Adding or removing guard clauses or early returns
- Changing the structure of conditional branching
- Changing null / nil / undefined checks

Required tests (you MUST cover):
1. Each path through the new conditional must have at least one test
   that takes that path
2. For each atomic condition that was changed (e.g., changing \`a && b\` to
   \`a && b && c\`), there must be a test where that atomic condition
   independently determines the outcome
3. Boolean inversion: at least one test where the change in logic produces
   a different observable result than the old logic would have

The third requirement is the test that proves your edit was meaningful.
If no test exists that distinguishes the new behavior from the old, the
edit is either a no-op or insufficiently tested. Either is a problem.

This is a lightweight version of MC/DC (Modified Condition / Decision
Coverage). Full MC/DC is not required, but the spirit of "each condition
independently affects outcome" is.

If the boolean change is purely a transformation that preserves truth
values (e.g., De Morgan's law applied), it still goes through this tool —
the rewritten bytes affect future readers and modifiers, so the kind-
specific risk surface still applies. edit_cosmetic is reserved for
whitespace / comments / formatter output only and does NOT cover boolean
restructuring.

Target (required):
Declare \`target: "prod"\` when editing the conditional logic in
production code, or \`target: "test"\` when editing the boolean tests
that exercise it. Pair the two declarations in the same commit. When
target is "test", \`target_file\` IS the test file and \`test_files\`
must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_state_transition: `Modify a state machine, workflow, or status transition in production code.

Use this tool when:
- Adding, removing, or modifying allowed transitions between states
- Changing what triggers a state transition
- Adding or removing valid states
- Changing the side effects that occur on transition

Required tests (you MUST cover):
1. Allowed transitions: each new or modified allowed transition must have
   a test that performs it and verifies the resulting state
2. Forbidden transitions: each transition that should NOT be allowed must
   have a test that attempts it and verifies it is rejected (and that no
   partial state change occurred)
3. Invalid input no-op: triggering a transition from an invalid state must
   not produce a partial state change

State transition bugs are particularly insidious because they often
manifest only under specific orderings of events. The forbidden-transition
tests are as important as the allowed-transition tests.

If your change adds new states, you must also test transitions from
existing states into the new states, and from the new states to existing
states (where allowed).

Target (required):
Declare \`target: "prod"\` when editing the state machine in production
code, or \`target: "test"\` when editing its transition tests. Pair the
two declarations in the same commit. When target is "test",
\`target_file\` IS the test file and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_db_schema: `Modify database schema: tables, columns, indexes, constraints, migrations.

Use this tool when:
- Adding, removing, or modifying columns, tables, indexes
- Changing constraints (NOT NULL, UNIQUE, FOREIGN KEY, CHECK)
- Creating or modifying migration files (DDL)
- Changing collation, charset, or storage parameters

Required tests (you MUST cover):
1. Migration application: the migration must apply cleanly to a schema in
   the previous state
2. Existing data compatibility: the migration must not corrupt or lose
   existing data. Provide test fixtures that exist before the migration
   and verify they are accessible after
3. Rollback OR forward-only justification: either provide a tested
   down-migration, or document explicitly in rationale why this migration
   is forward-only and how recovery would work
4. Index / constraint behavior: any new index must have a test
   demonstrating it is used; any new constraint must have a test showing
   both accepted and rejected inputs

Schema changes are infrastructural and rarely revertible in production.
The rollback question is not optional — answer it explicitly even if the
answer is "no rollback, here's why."

If your change modifies existing data (UPDATE statements, data backfills),
you MUST also use edit_data_migration alongside this tool.

Target (required):
Declare \`target: "prod"\` when editing the migration / DDL itself, or
\`target: "test"\` when editing the migration tests (apply / data /
rollback / constraint tests). Pair the two declarations in the same
commit. When target is "test", \`target_file\` IS the test file and
\`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_data_migration: `Modify production data through migration scripts, backfills, or
data-transformation code.

Use this tool when:
- Backfilling data into new columns
- Transforming or normalizing existing data
- Correcting bad data through scripted updates
- Splitting or merging records

Required tests (you MUST cover):
1. Idempotency: running the migration twice must produce the same result
   as running it once
2. Partial failure recovery: if the migration fails partway through, the
   remaining work must be safely re-runnable
3. Existing fixture transformation: provide concrete examples of
   pre-migration data and verify they are correctly transformed
4. Edge cases: NULL values, empty strings, maximum-length values,
   already-migrated rows

Data migrations are one-way operations on production data. Test them as
thoroughly as production code, ideally more so. The idempotency test is
the single most important one — write it first.

For long-running migrations, also consider testing chunked execution and
verifying that an interrupted-then-resumed migration completes correctly.

Target (required):
Declare \`target: "prod"\` when editing the migration / backfill script
itself, or \`target: "test"\` when editing the migration tests
(idempotency, partial failure, fixture transformation, edge cases). Pair
the two declarations in the same commit. When target is "test",
\`target_file\` IS the test file and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_api_contract: `Modify the request or response shape of an API: endpoints, fields, status
codes, schemas.

Use this tool when:
- Adding, removing, or renaming fields in API request or response
- Changing field types or formats
- Changing status codes returned for given conditions
- Adding or removing endpoints
- Modifying OpenAPI / GraphQL / gRPC schema files

Required tests (you MUST cover):
1. Backward compatibility: existing clients (including older versions)
   must continue to work, or the breaking change must be explicitly
   acknowledged in rationale
2. Missing field: request with the new field absent must behave correctly
   (default value, error, or fallback as documented)
3. Extra field: request with unknown extra fields must behave correctly
   (typically ignored, but verify)
4. Status code: each status code path that this change affects must have
   a test verifying the correct code is returned

API contract changes affect every consumer. The backward compatibility
test is the most important — name it explicitly and write it first.

If the change is a breaking change, the rationale field must say so
explicitly, e.g., "Breaking change: removing the deprecated \`legacyId\`
field. Migration plan: ..."

Target (required):
Declare \`target: "prod"\` when editing the API surface in production
code (handlers, schemas, OpenAPI / GraphQL / gRPC definitions), or
\`target: "test"\` when editing the contract tests (backward
compatibility, missing/extra field, status code). Pair the two
declarations in the same commit. When target is "test", \`target_file\`
IS the test file and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_serialization: `Modify a serializer, parser, codec, or data format handler.

Use this tool when:
- Changing JSON / YAML / XML / Protobuf / MessagePack handling
- Modifying custom binary or text formats
- Changing how data is encoded for storage or transport
- Modifying compatibility layers between format versions

Required tests (you MUST cover):
1. Round-trip: serialize then deserialize, verify equivalence
2. Read old format: the new code must be able to read data produced by
   the previous version
3. Write new format: produced output must be readable by the new parser,
   and ideally by tools that consume this format
4. Invalid input: malformed input must be rejected with a clear error,
   not silently corrupted

Format compatibility bugs are particularly painful because they tend to
be discovered only when production data is already in the new format and
cannot be read by anything. The "read old format" test is the safety net.

If the format change is intentionally non-backward-compatible, the
rationale must say so and describe the migration path for existing data.

Target (required):
Declare \`target: "prod"\` when editing the serializer / parser / codec
itself, or \`target: "test"\` when editing its round-trip / old-format /
invalid-input tests. Pair the two declarations in the same commit. When
target is "test", \`target_file\` IS the test file and \`test_files\`
must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_error_handling: `Modify how errors, exceptions, or failure paths are handled.

Use this tool when:
- Adding, removing, or modifying try / catch blocks
- Changing what exceptions are thrown or how they propagate
- Modifying fallback or retry logic on failure
- Changing rollback behavior on partial success
- Changing what is logged or reported on error

Required tests (you MUST cover):
1. Failure path executes: trigger the error condition and verify the new
   handling code runs
2. Observable error: the caller (or user, or log) must see an appropriate
   error indicator. Silent failures are forbidden
3. State after failure: any partial state changes must be either rolled
   back or explicitly documented as accepted partial state
4. Error type / code: if specific error types or codes are part of the
   contract, verify the correct one is produced

Silent failure — a catch block that doesn't re-throw, log, or otherwise
expose the error — is almost certainly a bug. Add at least one test that
verifies the error is observable.

Swallowing exceptions is forbidden unless the rationale explicitly states
why and what the recovery path is.

Target (required):
Declare \`target: "prod"\` when editing error-handling code in
production, or \`target: "test"\` when editing the tests that exercise
failure paths and observable-error contracts. Pair the two declarations
in the same commit. When target is "test", \`target_file\` IS the test
file and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_retry_timeout: `Modify retry, timeout, or backoff behavior.

Use this tool when:
- Changing retry counts, retry intervals, or backoff strategies
- Modifying timeout durations
- Adding or removing retry logic
- Changing idempotency keys or duplicate-detection logic

Required tests (you MUST cover):
1. Timeout exhaustion: when the timeout is exceeded, the operation fails
   with the expected error and does not hang
2. Retry exhaustion: when all retries are consumed, the operation fails
   with the expected error and reports the underlying cause
3. No duplicate side effects: retries must not produce duplicate external
   side effects (emails, charges, database writes), unless idempotency is
   documented as not required for this operation
4. Success on retry: if the underlying operation succeeds on a retry
   attempt, the overall call must report success

The duplicate-side-effect test is the one that catches the worst bugs.
If your code retries an HTTP POST that creates a record, verify that two
records are not created when the first attempt times out but actually
succeeded server-side.

Target (required):
Declare \`target: "prod"\` when editing the retry / timeout / backoff
logic in production code, or \`target: "test"\` when editing its
exhaustion / duplicate-side-effect / success-on-retry tests. Pair the
two declarations in the same commit. When target is "test",
\`target_file\` IS the test file and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_concurrency: `Modify concurrency primitives: locks, transactions, mutexes, parallelism,
race conditions.

Use this tool when:
- Adding, removing, or modifying locks (mutex, RWLock, semaphore)
- Changing transaction boundaries or isolation levels
- Modifying parallel execution (async, threads, goroutines)
- Changing lock ordering or scope
- Adding or removing critical sections

Required tests (you MUST cover):
1. Concurrent execution: multiple invocations in parallel must produce a
   consistent final state
2. Race prevention: a sequence that would race without the new primitives
   must produce a correct result with them
3. Transaction or lock scope: assertions about what is or is not atomic
   must be tested

Concurrency tests are notoriously hard to write reliably. If your test
framework supports controlled scheduling (e.g., loom in Rust, or property-
based testing with race scheduling), use it. Otherwise, loop the test
many times under stress and treat any failure as a bug.

If you cannot reproduce the race or contention this change addresses,
the change is speculative. Prefer to demonstrate the bug with a failing
test before applying the fix.

Target (required):
Declare \`target: "prod"\` when editing the concurrency primitives in
production code, or \`target: "test"\` when editing the concurrency
tests. Pair the two declarations in the same commit. When target is
"test", \`target_file\` IS the test file and \`test_files\` must be
empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_external_side_effect: `Modify code that produces external side effects: emails, events, queue
messages, webhooks, billing operations, audit logs.

Use this tool when:
- Adding, removing, or modifying calls that affect external systems
- Changing what events are emitted or to whom
- Modifying billing or payment-affecting logic
- Changing notification logic
- Adding or removing audit or compliance logging

Required tests (you MUST cover):
1. Side effect fires on success: when the conditions for the side effect
   are met, the side effect occurs (with correct payload)
2. Side effect does NOT fire on failure: when the operation fails, no
   spurious external effect is produced
3. Idempotency: if the operation is retried (network failure, duplicate
   request), the side effect occurs at most once
4. Correct recipient / payload: the side effect targets the right
   external system with the right data

The "no spurious side effect on failure" test is the most important one
for billing, email, and audit code. Send-money-but-fail-to-record is the
textbook AI-generated billing bug.

For test environments, side effects MUST be mocked or routed to a test
sink. Verify that the test does not actually charge a card or send a
real email. If your test makes a real external call, your test is wrong.

Target (required):
Declare \`target: "prod"\` when editing the side-effect-producing code
in production, or \`target: "test"\` when editing its tests (fires-on-
success, no-fire-on-failure, idempotency, correct recipient). Pair the
two declarations in the same commit. When target is "test",
\`target_file\` IS the test file and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_cache_invalidation: `Modify cache keys, TTLs, invalidation logic, or staleness handling.

Use this tool when:
- Changing cache key generation
- Modifying TTL or expiration logic
- Adding or removing invalidation triggers
- Changing what is cached or where

Required tests (you MUST cover):
1. Stale data prevention: after an invalidation event, the next read must
   return fresh data, not the cached stale value
2. Invalidation triggers: the events that should invalidate the cache
   must be tested explicitly
3. TTL boundary: behavior just before, at, and after expiration (this is
   also a boundary_condition pattern — be explicit)
4. Cache key collision: keys for different data must not collide

Cache bugs typically manifest as "wrong data shown to user" or "stale
data persisted to a downstream system". Both are silent until reported
by users, which is too late. Test invalidation explicitly.

Target (required):
Declare \`target: "prod"\` when editing cache key / TTL / invalidation
code in production, or \`target: "test"\` when editing its tests
(stale-data prevention, invalidation triggers, TTL boundary, key
collision). Pair the two declarations in the same commit. When target
is "test", \`target_file\` IS the test file and \`test_files\` must be
empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_permission_logic: `Modify authorization, access control, role checks, ownership checks,
tenancy, or feature flag gating.

Use this tool when:
- Changing role / permission / owner / tenant / feature flag checks
- Modifying access control predicates
- Changing the subject-action-resource matrix
- Modifying authentication state checks
- Changing API key, token, or session validation

Required tests (you MUST cover):
1. Allow matrix: enumerate the (subject, resource) pairs that should be
   allowed, and test each one
2. Deny matrix: enumerate the (subject, resource) pairs that should be
   denied, and test each one
3. Negative side-effect: when access is denied, no database write, no
   event emission, no external call, no state mutation must occur. Test
   this explicitly with a deny case
4. Edge cases: suspended user, expired token, missing role, deleted
   resource — each must have a test

Permission bugs are silent failures that compromise data integrity, user
trust, and regulatory compliance. They cannot be caught by ordinary smoke
tests, because the system continues to function — it just authorizes the
wrong people.

If you cannot enumerate the allow matrix and the deny matrix for this
change, the change is too risky to apply without further specification.
Stop and ask for the matrix to be confirmed before proceeding.

The negative side-effect test (test 3) is the one that catches the worst
bugs. A permission check that returns false but still writes to the
database is a permission bypass. Test it.

Target (required):
Declare \`target: "prod"\` when editing permission / authz code in
production, or \`target: "test"\` when editing the allow / deny matrix
tests and negative-side-effect tests. Pair the two declarations in the
same commit. When target is "test", \`target_file\` IS the test file
and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_dependency_config: `Modify package dependencies, runtime configuration, or feature
configuration files.

Use this tool when:
- Adding, removing, or upgrading package dependencies
- Modifying runtime config (env vars, config files)
- Changing feature flag default values
- Modifying build or deploy configuration that affects runtime behavior

Required tests (you MUST cover):
1. Build / install reproducibility: the new configuration must produce a
   working build from a clean state
2. Behavior under new config: at least one test exercises code paths
   affected by the configuration change
3. Default value: if a default is changed, both the old and new default
   behaviors must be tested (the new default for the new code, the old
   default for backward compatibility verification)

Dependency upgrades are a common source of subtle regressions. If a
dependency is upgraded, run the existing test suite and verify no
behavior change in covered paths. If you observe a behavior change,
document it explicitly — do not silently absorb it.

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
Declare \`target: "prod"\` when editing the manifest / config in
production, or \`target: "test"\` when editing tests that exercise the
new configuration (reproducibility, default value, new-config behavior).
Pair the two declarations in the same commit. When target is "test",
\`target_file\` IS the test file and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_policy_change: `Modify the meta-edit configuration itself: hooks, Claude permissions,
CI configuration, this server's behavior, or the tool descriptions of
edit_* tools.

Use this tool when:
- Modifying .claude/ configuration
- Modifying .github/workflows/ files that affect meta-edit
- Modifying AI-instruction files (CLAUDE.md, AGENTS.md, .cursor/rules, etc.)
- Modifying tool descriptions of edit_* tools themselves
- Modifying argument schemas or hook behavior
- Modifying build / release profile flags in package manifests
  (\`[profile.release]\` in Cargo.toml, \`[tool.poetry.build]\` in
  pyproject.toml, \`scripts\` / \`engines\` mutations in package.json
  that change how the project builds or releases) — see the boundary
  note in edit_dependency_config

Required tests (you MUST cover):
1. Configuration validity: the new configuration must parse and load
   without error
2. Existing edit log entries must remain readable under the new
   configuration
3. The new configuration must be applicable from a clean checkout (no
   hidden dependencies on local state)

Policy changes are at a higher trust boundary than ordinary code. This
tool exists to mark them clearly in the edit log so they can be reviewed
separately.

Policy changes that LOOSEN restrictions (allowing previously-denied
operations, reducing test obligations, removing obligations from edit_*
tool descriptions) require an explicit justification in rationale that
explains why the loosening is safe. "Convenience" is not an acceptable
rationale.

If your change loosens a restriction without a strong justification, do
not use this tool. Reconsider whether the restriction was correct in the
first place.

Fallback obligation:
Before applying this tool, ask the user a clarifying question
about the intended scope of the policy change, even when the
change feels obvious. A single confirmation message is the cost
of the safer path. Loosening restrictions, modifying hook
behavior, and editing tool descriptions all carry implications
the user has the standing to weigh; do not assume.

Target (required):
Declare \`target: "prod"\` when editing the policy / configuration /
description files themselves, or \`target: "test"\` when editing tests
that exercise the new policy (validity, readability of existing log
entries, clean-checkout applicability). Pair the two declarations in
the same commit. When target is "test", \`target_file\` IS the test
file and \`test_files\` must be empty.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,

  edit_docs_only: `Modify documentation, README, comments, or other narrative content
that does not affect runtime behavior.

Use this tool when:
- Editing Markdown files (README, docs/, *.md)
- Editing inline code comments
- Editing JSDoc / docstrings / Rustdoc that document existing API
- Editing changelogs, release notes, contribution guides
- Editing project meta-documentation (CHANGELOG, ROADMAP, post-mortems)
- Filling content into a freshly-created (currently empty) Markdown file:
  issues/*.md, ADRs, design docs, post-mortems, dogfood reports.
  Empty files are created freely without an MCP declaration (see SPEC §5);
  the content fill goes through this tool.

Required tests: NONE. test_files may be empty.

This tool does NOT carry a \`target\` field: documentation has its own
surface and the prod/test split does not apply. The prod/test target
flag is required only on the 16 impl tools.

Recommended verifications (not enforced):
- Internal links resolve
- Code blocks (if any) are syntactically valid in their stated language
- Terminology is consistent with the rest of the project documentation
- No accidental references to renamed APIs or removed features

This tool MUST NOT be used when:
- The patch modifies any executable production code
- The patch modifies test code (use the appropriate impl tool with
  \`target: "test"\`, choosing the kind that matches the production
  code the test exercises)
- The patch modifies build, CI, or meta-edit configuration
  (use edit_dependency_config or edit_policy_change)
- The "documentation" change actually changes API contracts
  documented in code (use edit_api_contract)
- The patch updates README / docs to claim functionality that has not
  yet shipped — describing future or aspirational behavior misleads
  every future reader (including AI agents). Land the implementation
  in the same change set or wait
- The patch updates a CHANGELOG entry for a release that this commit
  does not actually cut (CHANGELOG must reflect what merged, not what
  is queued)
- The patch contains a code example (fenced block, inline snippet)
  that does not compile or run as written; broken examples mislead
  readers more than no example
- The patch updates a Markdown test fixture loaded by tests at runtime
  (use the appropriate impl tool with \`target: "test"\` since the
  fixture's content is part of the test contract)
- The patch batches unrelated documentation changes across multiple
  files in one declaration; each independent doc surface gets its own
  edit_docs_only call so the rationale and audit trail stay tied to
  the actual reason

Rationale: documentation changes have a different risk profile from
code refactors. They cannot break runtime behavior, but they can
mislead future readers (including future AI agents). Treat
documentation as a contract with future readers.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.`,
};

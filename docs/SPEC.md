# meta-edit Specification

`meta-edit` is an MCP server that replaces the AI coding agent's raw file editing tools (`Edit` / `Write` / `MultiEdit`) with a family of nineteen kind-specific edit tools. Each tool's description encodes when to use it, when not to use it, and what tests must accompany the edit. The bet is that **a deliberately structured tool surface, with testing obligations encoded in tool descriptions, is enough to change AI editing behavior** — without diff classification, mutation testing, or any verification machinery.

This document is the complete specification of `meta-edit`.

---

## 1. The bet

Modern AI coding agents (Claude Code, Cursor, Cline, Aider, Codex) all use a generic edit interface: one or two tools that take a file path and a patch. The agent decides what to edit, writes the patch, applies it, and moves on. The kind of change being made — boundary condition, permission logic, refactor, schema migration — is invisible to the system. The agent's reasoning about *what kind of edit this is* happens silently in its hidden state, if at all.

`meta-edit` is built on a different bet:

> If you split the generic edit tool into nineteen kind-specific tools, and put the testing obligations for each kind into the tool description, the AI will:
>
> 1. Be forced to decide which kind of edit it is making, *as a tool selection step*
> 2. Read the testing obligations every time, because tool descriptions are part of the prompt
> 3. Tend to follow those obligations, because instruction-following on tool descriptions is strong in current models
> 4. Self-correct when the description says "if you cannot do X, stop and ask"

There is no detection, no verification, no enforcement beyond preventing the AI from bypassing the typed tools entirely. The bet is that **tool design alone is enough**.

The MVP is built to find out whether this works. If AIs systematically misuse `edit_refactor_only` for behavioral changes, or skip writing tests despite the descriptions requiring them, v0.2 adds a lightweight diff classifier as a backstop. Until then, we keep it simple and observe.

---

## 2. Architecture

```
Claude Code
  │
  │ built-in Edit / Write / MultiEdit / NotebookEdit: deny via permissions
  │
  ▼
Hook layer (minimal, just two)
  ├─ PreToolUse: deny-raw-edit
  └─ PreToolUse: deny-bash-write-bypass
  │
  ▼
MCP server: meta-edit-mcp
  ├─ edit_refactor_only          edit_test_only_change
  ├─ edit_boundary_condition     edit_boolean_condition
  ├─ edit_state_transition       edit_db_schema
  ├─ edit_data_migration         edit_api_contract
  ├─ edit_serialization          edit_error_handling
  ├─ edit_retry_timeout          edit_concurrency
  ├─ edit_external_side_effect   edit_cache_invalidation
  ├─ edit_permission_logic       edit_dependency_config
  └─ edit_policy_change
  │
  ▼
State
  └─ .meta-edit/state/edits.jsonl    (append-only edit log, protected)
  │
  ▼
CLI
  ├─ meta-edit serve                  (start MCP stdio server)
  ├─ meta-edit log                    (display edits)
  └─ meta-edit summary                (aggregate by tool / risk / file)
```

That is the entire system.

---

## 3. The nineteen tools: common schema

All tools accept the same arguments and return the same result.

```typescript
type EditToolRequest = {
  target_file: string;                        // primary file the edit is about
  rationale: string;                          // 1-3 sentences, non-empty
  risk_level: "low" | "medium" | "high" | "critical";
  test_files: string[];                       // paths of test files relevant to
                                              // this edit. May be files modified
                                              // in this request, files the agent
                                              // commits to updating in
                                              // immediately following
                                              // edit_test_only_change calls, or
                                              // existing tests that already
                                              // cover the change.
                                              // May be empty for
                                              // edit_refactor_only and
                                              // edit_docs_only.
                                              // Must be empty for
                                              // edit_test_only_change.
  changes: Array<{                            // one or more content-pair
    file: string;                             // changes; modify-only
    old_content: string;                      // exact current disk content
                                              // (server rejects on mismatch)
    new_content: string;                      // new content to write
  }>;
};

type EditToolResult = {
  applied: boolean;
  edit_id: string;                            // e.g. "edit_20260427_0001"
  warnings: string[];
  audit_error?: string;                       // Present whenever an audit-log
                                              // write fails (validation-
                                              // rejection or post-apply).
                                              // The caller MUST check
                                              // `applied` for apply status;
                                              // `audit_error` indicates only
                                              // that the audit trail is
                                              // incomplete for this edit_id.
                                              // Distinguishes audit-log
                                              // failures from validation
                                              // warnings.
};
```

`test_files` is recorded as the agent's declaration. The server does not verify that the listed files exist, contain meaningful tests, or are eventually updated. This is consistent with the broader stance that the MVP relies on tool descriptions and self-declaration rather than verification.

### Argument validation

The MCP server enforces:

- `target_file` must be a path within the repository root (after `realpath` resolution; symlinks resolving outside the repository root are rejected)
- `target_file` must not match `.meta-edit/state/**` or other protected paths
- `rationale` must be non-empty after trim
- `test_files` must be non-empty for tools other than `edit_refactor_only`, `edit_test_only_change`, and `edit_docs_only`
- `test_files` must be empty for `edit_test_only_change` (the `target_file` is itself the declared test file)
- `changes` must be a non-empty array (`.min(1)` zod refinement; defensive re-check at validation time)
- Each `change.file` is validated under the same path-safety rules as `target_file` (inside repo after `realpath`, not in protected paths)
- The total payload bytes — the sum of `Buffer.byteLength(change.old_content, "utf8") + Buffer.byteLength(change.new_content, "utf8")` across every change — must not exceed `MAX_CHANGE_BYTES` (1 MiB)
- Each `change.old_content` and `change.new_content` must not contain a NUL byte
- `change.file` must reference an existing file on disk at apply time, **except for `edit_create_file`**. For all other tools, the content-pair shape is **modify-only**: there is no representation for file deletion or rename, and missing files fail the call. For `edit_create_file`, the file MUST NOT exist on disk — `old_content` MUST be the empty string and the server opens the path with `O_CREAT | O_EXCL | O_NOFOLLOW`, refusing to overwrite or follow a symlink at the leaf.
- `change.old_content` must equal the current disk content of `change.file` byte-for-byte at apply time (precondition). A mismatch fails the entire call without writing anything.
- Apply is two-phase: precondition check (no writes) → per-change sibling temp-write → rename. If any precondition fails OR any temp-write fails, NO target file is modified. Rename failures after some renames committed are reported as warnings (best-effort multi-file atomicity on POSIX).
- Patch scope rules apply (see below)

Validation failures result in `applied: false` and a clear error message in `warnings`. They do not crash the server.

### Patch scope

The `changes` array may touch more than one file, but the set of touched files is restricted.

For all tools other than `edit_test_only_change`:

- A `change.file` may equal `target_file`
- A `change.file` may equal any file listed in `test_files`
- No `change.file` may reference any other path
- Two `change.file` entries that resolve to the same canonical path are rejected (use separate `edit_*` calls so changes are not silently dropped)

For `edit_test_only_change`:

- A `change.file` may equal `target_file` only; no other file may appear
- `test_files` must be empty (the agent is declaring that `target_file` is itself the test edit)
- The server does not pattern-match `target_file` against any test-file pattern. Choosing this tool is itself the agent's declaration that this is a test-only edit; tool selection is the obligation, not server-side classification

A request that violates these rules is rejected with `applied: false`.

This rule lets the agent submit a production change and a colocated test addition in a single tool call when convenient (using a non-test-only tool), without forcing it. Splitting into a production edit followed by one or more `edit_test_only_change` calls is also valid; in that case, `test_files` on the production edit lists the planned test-file paths, and each test-file change is its own `edit_test_only_change` call.

### Path safety

All paths — both `target_file` and any `change.file` — are resolved with `realpath` after symlink resolution. A path is valid only if its resolved absolute path is inside the resolved repository root. Symlinks that resolve outside the repository root are rejected.

The MVP does not provide cryptographic tamper resistance or OS-level append-only guarantees for protected paths; protection is enforced through the server's path checks and the bash hook on a best-effort basis.

### Multi-kind changes

A change that spans multiple edit kinds should be split into multiple tool calls where possible. If splitting is unsafe or impractical, choose the highest-risk applicable tool and mention the secondary aspects in `rationale`.

Specific tools take precedence over generic tools when both could apply:

- `edit_permission_logic` over `edit_boolean_condition` or `edit_boundary_condition`
- `edit_retry_timeout` over generic `edit_boundary_condition`
- `edit_external_side_effect` over generic `edit_error_handling` for failure-side-effect interactions
- `edit_data_migration` over generic `edit_db_schema` when existing data is being modified
- `edit_policy_change` over any ordinary code tool when the change touches `meta-edit` configuration, hooks, or tool descriptions

### What the server does, in order

1. Validate arguments (rationale, test_files cardinality, payload bound, NUL-byte rejection)
2. Resolve and check all paths (`target_file`, `test_files`, every `change.file`)
3. Verify changes scope (target_file ∪ test_files; modify-only tool's stricter rule)
4. Apply phase 1 (preflight): re-realpath each target, read disk, compare to `old_content`. Stop and reject without writing if any check fails.
5. Apply phase 2 (sibling temp writes): write each `new_content` to a randomly-named sibling file in the same directory as the target.
6. Apply phase 3 (rename commits): rename each temp into place atomically.
7. Append an entry to `.meta-edit/state/edits.jsonl`
8. Return result

The server does not analyze the new content. It does not check whether the chosen tool is appropriate for the change. It does not verify the test files exist or contain meaningful tests. None of that. The whole point is that tool descriptions, not server logic, do the work.

---

## 4. The nineteen tool descriptions

These descriptions are the product. Everything else is plumbing.

The descriptions are inspired by SQLite's testing strategy (https://sqlite.org/testing.html), particularly its emphasis on boundary values, MC/DC-style condition coverage, anomaly testing, fuzzing, and explicit per-change checklists. `meta-edit` translates that style of testing discipline into application-level edit categories. The categories themselves (permission logic, API contract, etc.) are not from SQLite — they reflect typical concerns of application development.

Each description follows a fixed structure:

```
[1-line summary]

Use this tool when:
- [concrete trigger conditions]

Required tests (you MUST cover):
1. [test obligation, with rationale]
2. [...]

[escalation: when to stop and ask]

This tool MUST NOT be used when:
- [anti-use cases, where applicable]
```

Descriptions are written in English. They are tuned to length 200–500 words each, long enough to encode the obligation but short enough to read in full at every tool call.

---

### `edit_refactor_only`

```
Refactor production code without changing observable behavior.

Use this tool when:
- Renaming variables, functions, or types
- Extracting helpers without changing call sites' observable behavior
- Reorganizing file or module structure
- Reformatting beyond what the formatter does
- Simplifying expressions while preserving evaluation results

Required tests: NONE (existing tests must continue to pass).
test_files may be empty.

This tool MUST NOT be used when the patch contains any of the following.
If your patch contains any of these, choose a more specific edit_* tool:

- Comparison operator changes (<, <=, >, >=, ==, !=)
- Boolean operator changes (&&, ||, !)
- Guard clauses or early returns being added or removed
- Return value structure changes (new fields, removed fields, reordered tuple)
- Throw / catch / error type changes
- Database read or write operations changes
- Event / job / webhook / email / billing call additions or removals
- Serializer, parser, or schema changes
- Permission / role / owner / tenant / feature flag reference changes
- Timeout / retry / backoff changes
- Cache key / TTL / invalidation changes
- Concurrency primitives (lock, transaction, mutex) changes

If you are unsure whether your change qualifies as refactor-only, choose a
more specific tool. False precision is safer than false generality. Misusing
this tool is the largest source of regression bugs in AI-generated code.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_test_only_change`

```
Add or modify test code only. No production code changes are allowed.

Use this tool when:
- Adding new test cases for existing behavior
- Strengthening assertions in existing tests
- Refactoring test fixtures or helpers
- Removing flaky or duplicated tests

Required: patch must only modify a single file — the `target_file` you
declare as a test file. test_files must be empty. The server does not
pattern-match the target path against any naming convention; choosing
this tool is itself your declaration that the change is test-only. The
obligation is tool selection, not server-side classification.

Recommended assertion practice:
- Each test must contain at least one explicit assert / expect
- Snapshot-only tests are discouraged unless you have a documented reason
  for snapshot semantics
- Tests that only check "no exception was thrown" should also check the
  actual return value or side effect

This tool is the standard way to fulfill testing obligations created by
other edit_* tools. After making a non-trivial change with another edit_*
tool, your next action is typically one or more edit_test_only_change calls
covering the obligations stated in the prior tool's description.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_boundary_condition`

```
Modify a comparison, threshold, limit, or boundary in production code.

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_boolean_condition`

```
Modify a boolean expression, conditional logic, or guard clause in
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
2. For each atomic condition that was changed (e.g., changing `a && b` to
   `a && b && c`), there must be a test where that atomic condition
   independently determines the outcome
3. Boolean inversion: at least one test where the change in logic produces
   a different observable result than the old logic would have

The third requirement is the test that proves your edit was meaningful.
If no test exists that distinguishes the new behavior from the old, the
edit is either a no-op or insufficiently tested. Either is a problem.

This is a lightweight version of MC/DC (Modified Condition / Decision
Coverage). Full MC/DC is not required, but the spirit of "each condition
independently affects outcome" is.

If the boolean change is purely a refactor (e.g., De Morgan's law applied
without changing truth values), use edit_refactor_only instead.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_state_transition`

```
Modify a state machine, workflow, or status transition in production code.

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_db_schema`

```
Modify database schema: tables, columns, indexes, constraints, migrations.

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_data_migration`

```
Modify production data through migration scripts, backfills, or
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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_api_contract`

```
Modify the request or response shape of an API: endpoints, fields, status
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
explicitly, e.g., "Breaking change: removing the deprecated `legacyId`
field. Migration plan: ..."

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_serialization`

```
Modify a serializer, parser, codec, or data format handler.

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_error_handling`

```
Modify how errors, exceptions, or failure paths are handled.

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_retry_timeout`

```
Modify retry, timeout, or backoff behavior.

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_concurrency`

```
Modify concurrency primitives: locks, transactions, mutexes, parallelism,
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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_external_side_effect`

```
Modify code that produces external side effects: emails, events, queue
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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_cache_invalidation`

```
Modify cache keys, TTLs, invalidation logic, or staleness handling.

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_permission_logic`

```
Modify authorization, access control, role checks, ownership checks,
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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_dependency_config`

```
Modify package dependencies, runtime configuration, or feature
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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_policy_change`

```
Modify the meta-edit configuration itself: hooks, Claude permissions,
CI configuration, this server's behavior, or the tool descriptions of
edit_* tools.

Use this tool when:
- Modifying .claude/ configuration
- Modifying .github/workflows/ files that affect meta-edit
- Modifying AI-instruction files (CLAUDE.md, AGENTS.md, .cursor/rules, etc.)
- Modifying tool descriptions of edit_* tools themselves
- Modifying argument schemas or hook behavior

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

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_docs_only`

```
Modify documentation, README, comments, or other narrative content
that does not affect runtime behavior.

Use this tool when:
- Editing Markdown files (README, docs/, *.md)
- Editing inline code comments
- Editing JSDoc / docstrings / Rustdoc that document existing API
- Editing changelogs, release notes, contribution guides
- Editing project meta-documentation (CHANGELOG, ROADMAP, post-mortems)

Required tests: NONE. test_files may be empty.

Recommended verifications (not enforced):
- Internal links resolve
- Code blocks (if any) are syntactically valid in their stated language
- Terminology is consistent with the rest of the project documentation
- No accidental references to renamed APIs or removed features

This tool MUST NOT be used when:
- The patch modifies any executable production code
- The patch modifies test code (use edit_test_only_change)
- The patch modifies build, CI, or meta-edit configuration
  (use edit_dependency_config or edit_policy_change)
- The "documentation" change actually changes API contracts
  documented in code (use edit_api_contract)

Rationale: documentation changes have a different risk profile from
code refactors. They cannot break runtime behavior, but they can
mislead future readers (including future AI agents). Treat
documentation as a contract with future readers.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### `edit_create_file`

```
Create a new file at a path that does not yet exist on disk.
The server opens the target with O_CREAT | O_EXCL | O_NOFOLLOW and refuses
to overwrite an existing file or follow a symlink at the leaf.

Use this tool when:
- Adding a new source module, helper, or class file
- Adding a new test file when fulfilling another tool's test obligations
- Adding new configuration files, fixtures, or example assets
- Scaffolding code for which no in-place modify path applies

Required tests (you MUST cover):
1. The newly-created file must be exercised by at least one test that
   imports, loads, or otherwise consumes it. Files that are not exercised
   by any test are dead on arrival.
2. If the new file is itself a test file, it must contain at least one
   explicit assertion. The mere existence of a test file is not a test.

test_files must be non-empty (you must declare which test covers the new
code). For each entry in `changes`, `old_content` MUST be the empty
string — the file does not yet exist. `new_content` is the full content
to write.

This tool MUST NOT be used when:
- The target path already exists; modifying an existing file is the job
  of one of the modify-only edit_* tools
- The new path lands inside a protected directory (.meta-edit/state/**,
  .meta-edit/tmp/**)
- The change is a rename or move (delete-and-add); the modify/create
  shape cannot represent rename atomically and the audit log would not
  reflect the original file's deletion
- The file is a binary payload; the string-based content shape will
  corrupt non-UTF-8 data

Rationale: the other modify-only edit_* tools cannot represent file
creation. Without an explicit creation tool, agents resort to bash
redirects, undermining the typed-tool surface meta-edit exists to defend.
Creation has a different precondition profile (no current state to check)
and a strong post-condition (the file did not exist; now it does), and
the audit log records it explicitly so reviewers see new-file additions
distinct from in-place edits.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

## 5. Hooks

Two hooks. No more.

### 5.1 `deny-raw-edit`

Triggered on `PreToolUse` for `Edit`, `Write`, `MultiEdit`, `NotebookEdit`. Always denies.

`NotebookEdit` is included because Jupyter (`.ipynb`) cells contain arbitrary executable code (Python, shell `!cmd`, JavaScript) — edits to them warrant the same kind-specific discipline as edits to `.py` or `.ts` source files. Tool-name comparison is case-insensitive so a host shim that delivers alternate casings (`"edit"`, `"WRITE"`, `"multiedit"`, `"notebookedit"`) cannot bypass the gate.

Response payload:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Raw Edit/Write/MultiEdit/NotebookEdit is disabled. Use one of the edit_* tools (e.g., edit_boundary_condition, edit_refactor_only). See tool descriptions for guidance on which to use."
  }
}
```

### 5.2 `deny-bash-write-bypass`

Triggered on `PreToolUse` for `Bash`. Inspects the command line and denies if it matches a write-bypass pattern, unless it matches an allowlist pattern.

This hook operates on a **best-effort basis**. It uses substring matching on the command line, which is straightforward to bypass (heredocs in alternative languages, base64-encoded commands, indirect invocations through shell aliases or wrappers, etc.). The MVP does not attempt to defeat a determined bypass; it raises the cost of the obvious bypasses to the point where using an `edit_*` tool is the path of least resistance. Stronger guarantees would require shell command parsing or a filesystem sandbox, both of which are out of scope.

Deny families:

1. **Verb-based deny patterns** (substring or verb match on the command, after basic normalization):

   ```
   sed -i
   sed --in-place
   perl -pi
   perl -i
   python -c    (when the snippet contains write_text, write, open( ... 'w', etc.)
   node -e      (when the snippet contains writeFile, writeFileSync)
   cat >
   cat >>
   tee <in-repo target>
   tee -a <in-repo target>
   mv ... <files in repo>
   cp ... <files in repo>
   dd of=<in-repo target>
   git apply
   patch
   rsync
   ```

2. **Structural redirect-target warn** (dogfood-001 + dogfood-005, loosened to warn in v0.1.5). Any `>` / `>>` / `>|` write redirect whose target is not on the safe-sink allowlist is **warned-and-allowed** — the call proceeds, but the hook returns `permissionDecision: "allow"` together with a `permissionDecisionReason` and mirrors the same text on stderr, so the AI is nudged toward an `edit_*` tool while a human reviewer sees the warning in the transcript. This catches new write verbs (`printf > foo.ts`, `echo > foo.ts`, future utilities) structurally, without requiring the per-verb table above to enumerate every one. The safe-sink allowlist is:

   ```
   exact: /dev/null  /dev/stdout  /dev/stderr  /dev/zero
   prefix: /tmp/  /var/tmp/  /run/  /sys/
   ```

   Relative paths and absolute paths outside the safe-sink list are treated as bypass-risk and warned. Use one of the nineteen `edit_*` tools for in-repo writes; capture command output to `/tmp/` or `/dev/null` if you need a sink.

   **`deny` always wins over `warn`** when both fire on the same command. Verb-deny patterns (`cat >`, `sed -i`, `tee`, `mv`, `dd of=`, the heredoc-with-redirect form, the inline-interpreter writes, etc.) and protected-path checks run *before* the structural redirect check, so well-known bypasses still produce `deny`. Across segments, the top-level evaluator surfaces `deny` if any segment denies; otherwise it surfaces the first `warn`; otherwise `allow`.

   v0.1.4 and prior denied this case outright. The loosening (deny → warn) was driven by a structural false-positive surface: legitimate redirects to outside-repo absolute paths (`~/.cache/...`, `$RUNNER_TEMP`, `/home/user/scratch/...`) had no safe-sink entry and were uniformly denied. The verb-denylist still catches the well-known bypasses, and `.meta-edit/state/**` / `.meta-edit/tmp/**` writes are still denied earlier in the pipeline. If observation shows new write verbs (`printf`, `echo`, `jq --rawfile`, …) being routed around the typed tools through this surface at scale, the warn will be tightened back to deny — see `OBSERVED-FAILURES.md` for the restore trigger.

   The DENY_SUBSTRINGS verb scan and the protected-path scan apply `stripQuotedContent` first, so a documentation string containing the literal trigger phrase inside a quoted argument (`printf 'do not use sed -i' > /tmp/notes.md`) is not denied. Shell-hosting wrappers (`bash -c "..."`, `sh -c "..."`, `eval "..."`) re-extract their literal argument and scan it raw so embedded bypasses inside the wrapper's quoted code remain caught.

Allowlist patterns (override deny):

```
prettier --write
eslint --fix
gofmt -w
cargo fmt
ruff --fix
ruff format
black
prisma generate
openapi-generator
swagger-codegen
```

The allowlist exists because formatters and code generators are part of normal development workflows, and forbidding them outright would make `meta-edit` unusable in real projects. These tools are conventionally semantic-preserving (formatters) or driven by separate input files (codegens), so they are unlikely to be used as deliberate edit-tool bypass. If observation shows AIs routing edits through formatters or codegens to avoid `edit_*` tools, the allowlist will be tightened in a future version.

Allowlist applies only when the command's effect is bounded to formatting or codegen, never to arbitrary file rewrites.

Writes to `.meta-edit/state/**` and `.meta-edit/tmp/**` are denied even if the command otherwise matches the allowlist. The hook decides "would write" along two axes:

1. **Verb is not in the read-only carve-out.** The hook maintains a small set of common read-only inspection utilities (`tail`, `head`, `cat`, `grep` / `egrep` / `fgrep`, `wc`, `cut`, `tr`, `od`, `hexdump`, `stat`, `ls`, `du`, `df`, `jq`, `diff`, `cmp`). If the command's leading verb (after wrapper / env-assignment / absolute-path normalization) is **not** in that set, any reference to a protected path is denied.
2. **`>` / `>>` redirect target is protected.** Even when the leading verb is read-only, if the command has a write redirect whose target token references a protected path (substring match, after backslash strip and path-doubling collapse, ignoring `>&` fd-duplications and quoted regions), the deny still fires.

This carve-out exists so debugging workflows like `tail -2 .meta-edit/state/edits.jsonl` or `jq . .meta-edit/state/edits.jsonl` work without disabling the hook. Any verb that has a non-redirect write side-effect — including in-place mutation, an output flag, an output positional, a shell-escape mode, or a subprocess-spawning option — is deliberately omitted from the read-only set so the protected-path deny still fires when targeting protected directories. Examples: `find -delete`, `sort -o OUT`, `uniq IN OUT`, `xxd -r`, `yq -i`, `less -O OUT`, `more !command`, `rg --pre=CMD`, `file -C`, `awk 'print > "..."'`, `dd of=...`.

When in doubt, the hook denies and asks the AI to use an `edit_*` tool.

---

## 6. Edit log

`.meta-edit/state/edits.jsonl` — append-only JSON Lines, one record per edit.

```json
{"edit_id":"edit_20260427_0001","timestamp":"2026-04-27T10:15:00+09:00","tool_name":"edit_boundary_condition","target_file":"src/billing/charge.ts","rationale":"Allow exact-balance charges by changing < to <=","risk_level":"high","test_files":["tests/billing/charge.test.ts"],"patch_size_bytes":432,"applied":true,"warnings":[]}
```

Fields:

- `edit_id`: monotonically increasing within a day, format `edit_YYYYMMDD_NNNN`
- `timestamp`: ISO 8601 with timezone
- `tool_name`: one of the nineteen tool names
- `target_file`: repository-relative path
- `rationale`: as supplied by the AI (any language)
- `risk_level`: as supplied by the AI (recorded for audit, not enforcement)
- `test_files`: as supplied by the AI
- `patch_size_bytes`: byte length of the synthesized unified diff (`Diff.createTwoFilesPatch` joined across every `change` in the request, encoded as UTF-8). The field name is preserved for log shape compatibility; the value is computed from the request inputs (no incoming `patch` string exists in v0.1.2+).
- `applied`: whether the patch applied successfully
- `warnings`: any warnings or validation errors associated with this edit (empty array on success)

Per-change content is not stored. The synthesized diff is computed for `patch_size_bytes` and discarded; only its byte length lands in the log. If the repository is under version control, external VCS history can often be used to reconstruct individual edits, but `meta-edit` itself does not guarantee per-edit reconstruction — sequential edits to the same lines, rebases, or amends can make per-edit reconstruction lossy or impossible.

Failed validations also append a record with `applied: false` and the relevant error messages in `warnings` for forensic purposes.

### Protected paths

The MCP server refuses any `target_file`, or any path appearing inside a patch, that resolves into:

```
.meta-edit/state/**
.meta-edit/tmp/**
```

Path matching uses the `realpath`-resolved absolute path against the resolved repository root (see §3 Path safety). These directories are also denied via the bash hook. They are not version-controlled. The recommended `.gitignore` is:

```
.meta-edit/state/
.meta-edit/tmp/
```

This protection raises the cost for the AI to rewrite its own edit log. It does not provide cryptographic tamper resistance or OS-level append-only guarantees; protection is best-effort, consistent with the bash hook.

---

## 7. CLI

Three commands.

### `meta-edit serve`

Start the MCP server in stdio mode. This is what Claude Code (or any other MCP client) connects to.

### `meta-edit log`

Print the contents of `edits.jsonl`, optionally filtered.

```
meta-edit log [--since DATE] [--tool TOOL_NAME] [--limit N]
```

Output is human-readable plain text. JSONL output is available with `--json`.

### `meta-edit summary`

Aggregate statistics from `edits.jsonl`.

```
meta-edit summary [--since DATE]
```

Example output:

```
meta-edit summary (last 7 days)

Total edits: 47
  Applied successfully: 45
  Validation failures: 2

By tool:
  edit_test_only_change       18  (38%)
  edit_refactor_only          12  (26%)
  edit_boundary_condition      4  ( 9%)
  edit_boolean_condition       4  ( 9%)
  edit_error_handling          3  ( 6%)
  edit_api_contract            2  ( 4%)
  edit_permission_logic        2  ( 4%)
  edit_dependency_config       1  ( 2%)
  edit_external_side_effect    1  ( 2%)
  edit_policy_change           0  ( 0%)

By risk_level:
  low      28
  medium   13
  high      5
  critical  1

Files most edited:
  src/billing/charge.ts        7
  src/auth/permissions.ts      5
  ...
```

The summary aggregates from the edit log only. Bash bypass attempts and raw-edit denials are surfaced via Claude Code's own hook telemetry, not by this command.

The summary makes no judgment. It is a fact sheet for humans to interpret. `edit_policy_change` is shown explicitly so it stands out, since loosening of restrictions deserves separate attention.

### Exit codes

```
0  success
1  argument or I/O error
2  internal error
```

There is no PASS/WARN/BLOCK return. Judgment is delegated to humans, for now.

---

## 8. Threat model and mitigations

What we defend against, in MVP scope:

- **AI uses raw Edit / Write / MultiEdit / NotebookEdit**: blocked by Claude Code permissions and `deny-raw-edit` hook (defense in depth)
- **AI uses common Bash write patterns to bypass typed tools**: blocked on a best-effort basis by `deny-bash-write-bypass` for the verb-denylist (`cat >`, `sed -i`, `tee`, `mv`, `dd of=`, heredoc-with-redirect, inline interpreter writes, decode-and-execute, …). The structural "redirect to a target outside the safe-sink allowlist" case is **warned, not denied** since v0.1.5 (see §5.2): the call proceeds with a `permissionDecisionReason` nudging the AI toward an `edit_*` tool. The hook uses substring matching and can be bypassed by determined commands (heredocs in alternative languages, encoded payloads, etc.); the goal is to make the obvious bypasses harder than using an `edit_*` tool, not to provide a sandbox
- **AI rewrites the edit log through `meta-edit` tools or common shell write patterns**: blocked on a best-effort basis by protected-path checks and the bash hook. The MVP does not provide cryptographic tamper resistance or OS-level append-only guarantees
- **AI provides empty `rationale` or empty `test_files` to slip past requirements**: blocked by argument validation

What we explicitly do NOT defend against, in MVP scope:

- **AI deliberately chooses the wrong edit_* tool** (e.g., uses `edit_refactor_only` for a boundary change)
- **AI provides plausible but false `rationale` text**
- **AI lists irrelevant files in `test_files`** (the server does not verify they exist or contain meaningful tests, nor that they are actually updated)
- **AI declares low `risk_level` on a critical change** (the field is recorded but not enforced)
- **AI uses an exotic Bash construct to bypass the hook** (best-effort detection only)

Defending against these requires diff classification, test verification, mutation testing, command parsing, or filesystem sandboxing. None of these are in MVP scope. They are the obvious next layer if observation shows that descriptions and best-effort hooks are insufficient.

---

## 9. Configuration

`meta-edit` requires no configuration to run. Sensible defaults are baked into the server.

If configuration is needed in the future (e.g., adjusting allowlist for the bash hook), it will live at `.meta-edit/config.yml` and changes to it will require `edit_policy_change`. For now, the configuration surface is empty.

---

## 10. Implementation notes

### Recommended stack

- TypeScript for the MCP server and CLI
- `zod` for argument schemas
- A well-maintained unified-diff library (e.g., `jsdiff`) for patch application — do not write your own diff engine. Verify the chosen library handles file additions, deletions, and renames if you intend to allow those in patches; restrict patch operations to the subset the library handles correctly
- JSONL for the edit log — no database, no migration concerns
- GitHub Actions for the CI sample

### Repository layout

```
meta-edit/
  src/
    tools/
      common.ts              shared types, validation, patch application
      descriptions.ts        the nineteen descriptions, verbatim from §4
      registry.ts            MCP tool registration
    server.ts                MCP stdio server entry
    cli.ts                   CLI entry
    state/
      edit-log.ts            jsonl read/write
      protected-paths.ts     path matching
    hooks/
      deny-raw-edit.ts
      deny-bash-write-bypass.ts
  examples/
    .github/workflows/meta-edit-summary.yml
  package.json
  README.md
  CLAUDE.md
  SPEC.md                    this document
  LICENSE
```

### The most important file

`src/tools/descriptions.ts` is the most important file in the repository. It contains the nineteen descriptions from §4 of this document, verbatim. The spec and the file must stay in sync. When one is updated, the other must be updated immediately, in the same change.

```typescript
export const TOOL_DESCRIPTIONS = {
  edit_refactor_only: `Refactor production code without changing observable behavior.

Use this tool when:
- ...`,

  edit_test_only_change: `...`,

  // ... nineteen total
} as const;
```

Tool handlers share common logic via helpers, but each tool is registered separately with its own description. Do not collapse them into a single generic handler that takes a `kind` argument. The whole point of nineteen separate tools is that **tool selection is the reasoning step**.

---

## 11. Future direction

If descriptions alone don't change AI behavior enough — for instance, if `edit_refactor_only` is routinely used for behavioral changes, or tests are routinely skipped — v0.2 adds a lightweight diff classifier as a backstop.

The classifier would inspect the patch and flag obvious mismatches (e.g., `<=` changed to `<` in a patch declared as `edit_refactor_only`). Descriptions remain primary; classification flags mismatches as warnings in the edit log without blocking edits.

That is the only planned semantic-enforcement direction. Workspace protocols, VCS adapters, mutation testing, regression verification, plan/spec/reference structuring — all of these are explicitly out of scope for `meta-edit`. They are valuable, but they belong to other projects.

Smaller maintenance changes — refining tool descriptions based on observed usage, tightening the bash hook's allowlist if it becomes a bypass route, improving log details — are not "future directions" in the same sense; they are ordinary upkeep and will happen as needed.

The structural redirect-target check (§5.2) sits in the same upkeep bucket. It was tightened to `deny` in v0.1.3 (dogfood-001) and loosened to `warn` in v0.1.5 because the safe-sink allowlist had a structural false-positive surface on legitimate redirects to outside-repo absolute paths. The expected restore path, if observation shows new write verbs (`printf`, `echo`, `jq --rawfile`, …) being routed around typed tools through this surface, is to flip the structural redirect check back to `deny` — not to add a classifier. The verb-denylist and protected-path checks remain on `deny` regardless. The trigger and revert procedure live in `OBSERVED-FAILURES.md`.

`meta-edit` is exactly this: nineteen tools, two hooks, an edit log, a CLI summary. We'll know whether to add the classifier by running `meta-edit` and looking at the edit log.

---

## 12. References

- SQLite Testing Strategy. https://sqlite.org/testing.html

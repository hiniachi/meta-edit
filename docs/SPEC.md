# meta-edit Specification

`meta-edit` is an MCP server that replaces the AI coding agent's raw file editing tools (`Edit` / `Write` / `MultiEdit`) with a family of eighteen kind-specific edit tools. Each tool's description encodes when to use it, when not to use it, and what tests must accompany the edit. The bet is that **a deliberately structured tool surface, with testing obligations encoded in tool descriptions, is enough to change AI editing behavior** — without diff classification, mutation testing, or any verification machinery.

This document is the complete specification of `meta-edit`.

---

## Part I — Constitution

### Article 1 — Mission

`meta-edit` replaces the AI coding agent's raw file-editing tools with
a family of typed declaration tools. Each tool is registered separately
under a Model Context Protocol server with a description that encodes
when it must be used, when it must not be used, and what tests must
accompany the edit. **The descriptions are the product.** Everything
else is plumbing for getting the descriptions in front of the agent at
the moment of edit.

### Article 2 — The bet

A well-designed tool surface is more useful than a complex verification
surface. By forcing the agent to classify its intent before each
modification — as a tool-selection step, recorded in a tool call —
behavior is shaped at the moment the edit is being formed, not after
the fact.

The MVP is run to find out whether this works. If the experiment shows
that descriptions alone are insufficient, the next addition is a
lightweight diff classifier as a backstop. Adding detection prematurely
makes the question impossible to answer cleanly, so it is forbidden in
MVP scope (see Article 7).

Falsifiability is a known gap of this article: "do descriptions change
behavior" is sharper if accompanied by observable measurements. The
edit log already records every typed call; useful indicators that
should be derivable from it include declaration-without-Edit
follow-through rate, expired-token rate, and per-tool selection
distribution against a manually classified ground truth. Concrete
thresholds for "descriptions are insufficient → add a classifier" are
left for v0.2 observation, but the indicators above are the intended
signal channel.

### Article 3 — Threat model

The user's AI agent is assumed to be **lazy, fallible, and
non-adversarial.**

- **Lazy** — It skips declaration steps that feel like ceremony.
  It batches when batching feels natural. It routes around friction
  (shell redirects, alternative tools, encoded payloads) when the
  typed path is more expensive than a workaround.
- **Fallible** — It misclassifies edits. It lists wrong test files.
  It writes subtly incorrect content despite holding the right
  intent. Honest mistakes are the modal failure.
- **Non-adversarial** — It does not race the hook. It does not forge
  tokens. It does not exfiltrate. It does not deliberately evade.
  Prompt-injection-compromised agents are explicitly out of scope;
  defending against them requires sandboxing, not declaration
  discipline.

This is the operative threat model. **Misalignment with this model is
the historical source of implementation bloat in this project**:
defenses designed against adversarial scenarios (deep TOCTOU loops,
HMAC signing, sibling-temp atomicity, exhaustive symlink resolution)
accreted in `apply.ts` and the hooks even though the actual operator
was always lazy-and-fallible. This article exists so that the next
round of "we should harden X" review pressure is adjudicated against
the right adversary, not against an imagined attacker.

Two consequences follow:

1. **Ergonomics is a primary constraint, not a nice-to-have.** The
   typed surface MUST be at least as ergonomic as native Edit plus
   one declaration step. If using the typed tool feels harder than
   slipping a `cat > file` past the hook, the lazy agent will skip
   it, and the trial returns no signal.
2. **The bash-write-policy hook is the load-bearing defense line for
   accidental bypass routes**, not for adversarial forgery. Even when
   the server delegates writes to native Edit (Article 5), an honest
   `printf > .meta-edit/state/grants/...` typo still has to be
   blocked. Hardening against deliberate forgery is out of scope.

What is NOT defended against (constitutionally accepted): an agent
that deliberately mis-selects a tool, lists irrelevant files in
`test_files`, or writes plausible-but-false `rationale` text. Catching
these requires diff classification or test-content inspection, which
Article 7 forbids in MVP. Under the non-adversarial assumption, these
are honest classification mistakes, not deception, and the cure is
description-tuning (not detection).

### Article 4 — Surface: eighteen tools (17 + 1)

**Seventeen SQLite-derived tools.** Each is one element of a bug-class
classification grounded in SQLite's testing strategy
(https://sqlite.org/testing.html). The strategy's *per-change
checklist* discipline maps each bug class to a specific obligation
pattern (boundary triple, MC/DC, anomaly testing, etc.). The
categories themselves are application-level (permission logic, API
contract, …) — what is borrowed from SQLite is the discipline of
classifying every edit before it lands. `edit_refactor_only` is the
zero element of this classification: a change that introduces no new
bug class, so existing tests must remain sufficient.

```
edit_refactor_only            edit_test_only_change
edit_boundary_condition       edit_boolean_condition
edit_state_transition         edit_db_schema
edit_data_migration           edit_api_contract
edit_serialization            edit_error_handling
edit_retry_timeout            edit_concurrency
edit_external_side_effect     edit_cache_invalidation
edit_permission_logic         edit_dependency_config
edit_policy_change
```

**One workflow-required tool.** The development workflow imposes
actions that are not "code edits as cognitive units" but "environment
setup that the agent feels motivated to perform in batches" (sweeping
documentation updates). Forcing those into a one-call-per-file rhythm
creates friction that biases the agent toward shell-redirect bypass.
The remaining workflow tool is recognized constitutionally as
batch-friendly:

```
edit_docs_only
```

(v0.3.1 dropped `edit_create_file` and `edit_create_planning_artifact`:
empty file creation is now free at the deny-raw-edit hook level — see
§5.1 — so the create act stops being a special workflow and content
fills go through the appropriate type-specific tool against the
now-empty file.)

The full per-tool descriptions live in Part II §4 of SPEC.md and in
`src/tools/descriptions.ts` verbatim. They are unconstitutional only in
the sense that the spec does not constrain their wording — they are
free to evolve as observation accumulates, provided every change keeps
spec and code in sync in the same change.

**Description style (constitutional principle).** Each tool's
description should read as **a safe, convenient, comfortable tool
that helps the agent organize its thinking as it works** — not as a
gatekeeper's prohibition list. Per Article 3's friendly-but-friction-
driven actor, ergonomic framing is what keeps the typed path easier
than shell-redirect bypasses. Restriction-heavy framing creates
friction that pushes the agent off-path; positive framing turns the
declaration step into a momentary pause that organizes intent before
the edit lands.

**Easy-to-grab tools carry fallback obligations.** The tools whose
descriptions feel low-stakes (`edit_refactor_only`,
`edit_dependency_config`, `edit_policy_change`) are the ones the
agent will reach for under friction. Their descriptions therefore
include explicit obligations that fire if the choice was wrong:

- `edit_refactor_only`: if the patch turns out to contain logic
  changes (boundary, boolean, state, error-handling, etc.), the
  agent OWES the user a follow-up explanation in the next message —
  what slipped in, why the typed surface didn't catch it earlier.
- `edit_policy_change`: SPEC / configuration changes are
  user-impacting. The agent MUST ask the user a clarifying question
  about intended scope before applying, even when the change feels
  obvious. A single confirmation message is the cost of the safer
  path.
- `edit_dependency_config`: environment changes affect everyone
  running the project. The agent MUST summarize the change in
  user-facing terms before applying, so the user can intercept
  surprises.

These obligations are part of the tool descriptions in §4 (and
mirrored in `src/tools/descriptions.ts`). They are not detection
machinery — selecting the right tool remains the agent's
responsibility, but the description ensures that if the agent slips
into one of these tools incorrectly, the *next* message visibly
acknowledges the slip. Ergonomic rephrasing of the other 16 tools'
descriptions is downstream work; only the three obligations above
land in this restructure.

### Article 5 — Mechanism (binding principles)

Three principles, no implementation. The current best implementation
of these principles lives in Part III; better implementations can
replace it without amending the constitution.

1. **The MCP server does not write.** A typed_edit call is a
   declaration of intent. Validation is the server's only
   responsibility. Real writes are performed by the agent's native
   tools (Edit / Write / MultiEdit / NotebookEdit), which the agent is
   tuned for. This routes around the friction of forcing a foreign
   content-pair schema onto the agent's tool-calling pattern.

2. **Every write must be bound to a fresh declaration.** A binding
   mechanism MUST (a) prevent native Edit / Write / MultiEdit /
   NotebookEdit from landing bytes inside the repository unless a
   matching declaration exists, (b) verify the write targets the
   declaration's file(s), and (c) verify the disk state at write time
   matches the declaration's pre-condition. The binding has a short
   lifetime (single use, time-bounded) so that stale declarations do
   not accumulate authority.

3. **The bash-write-policy hook is the load-bearing defense for
   shell-route bypasses.** Whatever binding mechanism is in use,
   shell-route bypasses (`cat >`, `sed -i`, `tee`, heredocs,
   encoded-payload pipelines) are blocked independently. The bash hook
   is the line that prevents accidental binding-forgery from outside
   the typed surface.

   Other-MCP write paths (e.g. `ctx_execute` writing to disk
   without going through any meta-edit-aware hook — see issue 1108)
   are an acknowledged hook-scope gap. Closing that gap belongs to a
   future hook expansion (PostToolUse monitoring, MCP-write
   allowlist), not to the constitution. The friendly-AI threat model
   in Article 3 means the gap shows up as honest workflow misses, not
   as adversarial bypasses.

The current implementation choice is a single-use, TTL-bound token
backed by a per-token JSON file under `.meta-edit/state/grants/`
(Part III). It satisfies all three principles. The token is **not**
HMAC-signed: under Article 3's non-adversarial threat model, signing
adds no protective value (an honest agent does not forge tokens), and
under Article 7 it is forbidden as a deep adversarial defense. If a
future proposal — capability-based addressing, signed manifests,
content-addressed declarations, etc. — satisfies the same three
principles with better ergonomics or smaller surface, it can replace
the token mechanism without re-opening the constitution.

### Article 6 — Granularity rules

The granularity follows directly from the surface split in Article 4.

**Seventeen SQLite-derived tools — 1 declaration ≡ 1 target_file.**
Each call binds exactly one file. A change that spans multiple
production files is multiple typed_edit calls, each producing its own
binding. Per-file kind selection IS the unit of cognitive intervention
for code changes; collapsing multiple files into one declaration would
weaken the bet. Atomic multi-file rename (today's `apply.ts`
invariant) is **not** preserved; partial application is recoverable in
the friendly-AI threat model. This is a deliberate behavior change
from current `main`, accepted as the cost of moving real writes into
native Edit.

**One workflow-required tool — 1 declaration ≡ N target_files.**
`edit_docs_only` accepts a batch of files in one declaration. The
binding's TTL covers the whole batch; native Edit / Write calls
consume the batch's entries in any order until the declaration is
exhausted or expires. Per-file classification has no cognitive value
here (sweeping a docs rename across 30 markdown files
is one act, not 30; scaffolding `index.ts` + `impl.ts` + `impl.test.ts`
is one act, not three), and observation suggests that forcing them
1-by-1 is the friction surface most likely to push the agent toward
shell-redirect bypass.

**Test obligations.** SQLite-derived tools that modify production code
declare `test_files: [...]` as a **forward declaration** — paths the
agent commits to fulfilling test obligations on. Forward declarations
are recorded in the edit log but are NOT bound by the production
declaration; they do not authorize writes to the test files. Test
edits are made through `edit_test_only_change`, each producing its own
binding. Selecting `edit_test_only_change` is the agent's
re-affirmation that this edit is test-only; the cognitive intervention
fires twice, once for the production change and once for the test
addition.

If the production edit's `test_files` lists multiple paths, the agent
issues one `edit_test_only_change` declaration per test file. This is
the intended cost: each test file is its own cognitive unit ("this
change is test-only"), so multi-file fulfillment cannot be batched
under a single declaration.

**`edit_test_only_change` is a strict 1-file SQLite-derived tool**:
target_file is the test file itself, `test_files` MUST be empty, and
the call binds exactly one file.

**`edit_refactor_only` is a strict 1-file SQLite-derived tool** despite
having no test obligation: it carries the cognitive intervention "I
believe no new bug class is introduced", which is per-file by
definition.

### Article 7 — Out of scope (constitutional)

The following are NOT in MVP scope, and proposals to add them must
clear a constitutional-amendment bar (i.e., must explicitly argue why
the experimental signal of the bet is preserved):

- **Diff classification** — inspecting patch contents to verify the
  declared kind matches.
- **Test verification** — confirming `test_files` exist, contain
  meaningful assertions, or are eventually updated.
- **Mutation testing, regression verification, coverage gates.**
- **Server-side defense-in-depth** for filesystem hardening (TOCTOU
  loops beyond the single sha256 check, symlink-swap defenses,
  sibling-temp atomicity, parent-directory fsync). These belong to
  the native Edit tool and to OS file APIs.
- **Sidecar classifiers, auto-repair loops, agent-feedback loops.**
- **Heavy hooks** that re-implement what tool descriptions already say.
- **Typed-surface coverage of arbitrary write-capable MCP tools.** The
  invariant "writes inside this repo go through `edit_*`" is enforced
  by hooking the four named raw-edit primitives Anthropic ships:
  `Edit`, `Write`, `MultiEdit`, `NotebookEdit`. Any other MCP tool that
  can mutate the filesystem — `ctx_execute` running `fs.writeFileSync`,
  `apply_patch`-style external tools, future code-execution surfaces —
  is **explicitly outside MVP scope** (issue 1108). The four mitigation
  paths considered in 1108 (PostToolUse mtime watcher, MCP-tool
  whitelist, protocol extension, documentation only) all entail the
  diff-classification work this article forbids; the v0.2 escape hatch
  (lightweight classifier) is the only sanctioned route for revisiting
  this. Until then, the `CLAUDE.md` §9 honor-code prohibition on
  bypass-via-other-tool is the load-bearing mitigation.

The temptation will recur, especially after observed bypasses. The
correct response is almost always to refine a description, not to add
machinery. If observation eventually shows descriptions to be
insufficient, Article 2's escape hatch (a v0.2 lightweight diff
classifier) is the planned next step — and only that.

### Article 8 — References

- SQLite testing strategy: https://sqlite.org/testing.html
- Issue 1103 — typed `edit_*` as thin Edit wrapper via grant-token
  (`issues/2026-05-02-1103-typed-edit-as-thin-edit-wrapper-via-grant-token.md`)
- Issue 1108 — `deny-raw-edit` MCP tool scope gap
  (`issues/2026-05-02-1108-deny-raw-edit-mcp-tool-scope-gap.md`)

---

## Part II — Derived Specification


## 2. Architecture

```
Claude Code (host)
  │
  │  Edit / Write / MultiEdit / NotebookEdit
  ▼
PreToolUse hook: deny-raw-edit (token-aware, see §5)
  ├─ valid token + sha256 checks pass → allow + consume
  └─ otherwise → deny
  ▼
File system (write performed by native Edit/Write)

Independently:
PreToolUse hook: deny-bash-write-bypass — blocks shell-route writes (§5.2)

MCP server: meta-edit-mcp
  ├─ 17 SQLite-discipline-derived tools (single-file declarations)
  ├─ 3 workflow tools (batch declarations of N files)
  └─ Issues tokens; never writes files

State
  ├─ .meta-edit/state/grants/         in-flight tokens
  └─ .meta-edit/state/edits.jsonl     append-only audit log

CLI
  ├─ meta-edit serve / log / summary
```

That is the entire system.

---

## 3. The eighteen tools: common schema

A typed_edit MCP call is a **declaration of intent**. The server validates the request, reads disk to compute `before_sha256` itself, issues a single-use token bound to one or more `(file, before_sha256)` tuples, and returns. **It does not write.** Native `Edit` / `Write` / `MultiEdit` performs the write under hook validation (see §5).

```typescript
type EditToolRequest = {
  target_file: string;            // primary bound file. Always present.
  rationale: string;              // 1-3 sentences, non-empty after trim
  risk_level: "low" | "medium" | "high" | "critical";
  test_files: string[];           // forward declaration; not bound by token

  // ONLY accepted by the 1 workflow tool (edit_docs_only). The 17
  // SQLite-derived tools MUST omit this field; validation rejects its
  // presence elsewhere. (v0.3.1 dropped edit_create_file and
  // edit_create_planning_artifact; empty file creation is now a free
  // hook-level action — see §5.1.)
  additional_files?: Array<{
    file: string;
  }>;
};

type EditToolResult = {
  token: string;                  // e.g. "met_20260502_a3f9b2..."
  expires_at: string;             // ISO-8601, declaration_time + 5m
  edit_id: string;                // e.g. "edit_20260502_0001"
  warnings: string[];
  audit_error?: string;           // present whenever an audit-log write
                                  // fails. The caller MUST check the
                                  // edit_log directly for ground truth.
  next_action?: string;           // human-readable reminder, present iff
                                  // a token was issued. Tells the agent
                                  // that the deny-raw-edit hook will
                                  // resolve this declaration automatically
                                  // on the next native Edit / Write /
                                  // MultiEdit call against the bound
                                  // file(s); the agent passes no extra
                                  // parameters. Omitted on rejection.
};
```

### Argument validation

The MCP server enforces:

- `target_file` is inside the repo (after `realpath`) and not in protected paths (`.meta-edit/state/**`, `.meta-edit/tmp/**`).
- `rationale` is non-empty after trim.
- `test_files` cardinality follows the per-tool rule encoded in §4: non-empty for SQLite-derived production tools that impose test obligations; empty for `edit_refactor_only` / `edit_test_only_change` / `edit_docs_only`.
- `test_files` entries are **forward declarations**: each path names a test file the agent commits to populating via subsequent `edit_test_only_change` calls. Paths MAY name files that do not yet exist on disk — `test_files` is recorded in the audit log but is NOT bound by the issued token, and the server does not require the path to be a current file. (Issue 0105-test-files-burden / Article 6: the cognitive intervention is the commitment, not the file existence.)
- For modify-only tools, `target_file` MUST exist on disk; the server reads it and binds `before_sha256 := sha256(disk_content_utf8)`.
- v0.3.1: there is no longer a CREATE-flagged tool. Empty file creation is authorized at the deny-raw-edit hook level (Write with `content === ""` to a non-existent in-repo path; see §5.1). Content fills run in modify mode against the now-empty file via the appropriate type-specific tool, treating `before_sha256 := sha256("")`.
- `additional_files` is accepted only for the 3 workflow tools, with cardinality ≤ 32 (operational hygiene; not a constitutional value).
- Each `file` in `additional_files` is validated under the same path-safety rules as `target_file`.

Validation failures result in a rejected request with a non-empty `warnings` array and no token issued.

### Token issuance

A successful declaration produces a token bound to the set of
`(file, before_sha256)` tuples (1 entry for SQLite-derived; 1+N for workflow tools). The server computes each `before_sha256` from disk at declaration time; agents do not supply hashes. The token expires 10 minutes after issuance — operational hygiene only; the single-use binding is the actual integrity guarantee, so the TTL is purely garbage-collection (it keeps the grants/ dir from accumulating abandoned files). The 10-minute window absorbs realistic agent thinking time between the typed_edit call and the native Edit / Write call without weakening the model (v0.3.1: extended from 5 min after dogfood report of mid-edit expiry). Storage is `.meta-edit/state/grants/<token_id>.json`, a protected path.

The result also carries a `next_action` field whenever a token is issued — a one-line reminder that the agent's next native `Edit` / `Write` / `MultiEdit` call against the bound file(s) will be authorized automatically by the deny-raw-edit hook; the agent passes no extra parameters. Per Article 4, the agent should only have to declare intent; the server takes care of the bookkeeping (and of telling the agent what comes next). On rejection, `next_action` is omitted.

> **v0.2.2 fix.** Earlier (v0.2.0 / v0.2.1) revisions of this spec asked the agent to surface the token by passing it as `_meta_edit_token` on the native Edit / Write / MultiEdit call. Claude Code's native edit tools have strict input schemas that reject extra fields, so the framework strips `_meta_edit_token` before the hook ever sees it — making the end-to-end flow unusable. v0.2.2 moves the binding-presence check server-side: the hook scans `.meta-edit/state/grants/` on disk, finds the most-recently-issued unconsumed binding matching the call's canonical `file_path`, and consumes it. The agent never thinks about tokens.

> **v0.2.1 thinning.** Earlier (v0.2.0) revisions of this spec required the agent to supply `before_sha256` and `after_sha256` per binding. Both fields were dropped: under Article 3 (non-adversarial threat model) and Article 4 (descriptions read as a comfortable tool, not a hashing chore), the client-supplied digests added friction without proportional protective value. The server reads disk itself; the hook re-reads disk to detect staleness only.

The MCP server does not analyze the new content. It does not check whether the chosen tool is appropriate for the change. It does not verify the test files exist or contain meaningful tests. None of that. The whole point per Article 4 is that tool descriptions, not server logic, do the work.

### Multi-kind precedence

If a single change might fit multiple tools, prefer the more specific:

- `edit_permission_logic` over `edit_boolean_condition` / `edit_boundary_condition`
- `edit_retry_timeout` over generic `edit_boundary_condition`
- `edit_external_side_effect` over generic `edit_error_handling` for failure-side-effect interactions
- `edit_data_migration` over generic `edit_db_schema` when existing data is being modified
- `edit_policy_change` over any ordinary code tool when the change touches `meta-edit` configuration, hooks, or tool descriptions

A change that spans multiple kinds and cannot be safely split should choose the highest-risk applicable tool and mention secondary aspects in `rationale`.

---

## 4. The eighteen tool descriptions

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

Fallback obligation:
If, after applying this tool, you discover that your patch did
contain any of the change kinds listed above (comparison change,
boolean change, guard clause, error-handling change, etc.), you
owe the user a follow-up explanation in your next message: name
what slipped in, and say why the typed surface didn't catch it
before you applied. This is a personal debt that posts to the
user, not a detection bypass — acknowledging the slip is what
keeps the typed surface honest.

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
- Filling content into a freshly-created (currently empty) test file:
  empty files are created freely without an MCP declaration (see SPEC §5);
  the content fill goes through this tool

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

Boundary with edit_policy_change (Cargo.toml / pyproject.toml / package.json
overlap). Manifests with mixed personalities — package metadata + build
profile + per-target optimization flags — sometimes straddle the line.
Use edit_dependency_config when the change is about WHICH packages are
present at WHICH versions (the dep graph or runtime config). Use
edit_policy_change when the change is about HOW the build / release
runs (release profile flags, codegen options, CI behavior, lint rules).
A Cargo.toml `[dependencies]` entry update is dependency_config; a
`[profile.release]` flag flip (e.g. `opt-level`, `lto`,
`wasm-opt = false`) is policy_change. When a single PR touches both
sections, split into two declarations.

Fallback obligation:
Before applying this tool, summarize the change in user-facing
terms: which package, what version delta, runtime vs dev, expected
impact on the build or development loop. Surprise dependency
updates are how contributors lose a day to a broken local
environment; the user has standing to intercept before it lands.

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
- Modifying build / release profile flags in package manifests
  (`[profile.release]` in Cargo.toml, `[tool.poetry.build]` in
  pyproject.toml, `scripts` / `engines` mutations in package.json
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
- Filling content into a freshly-created (currently empty) Markdown file:
  issues/*.md, ADRs, design docs, post-mortems, dogfood reports.
  Empty files are created freely without an MCP declaration (see SPEC §5);
  the content fill goes through this tool.

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
  (use edit_test_only_change since the fixture's content is part of
  the test contract)
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
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

## 5. Hooks

Two PreToolUse hooks, both shipped under `hooks/` in this repo.

### 5.1. deny-raw-edit (server-side declaration lookup)

Fires on Claude Code's built-in `Edit`, `Write`, `MultiEdit`, and `NotebookEdit` tools. The hook reads no extra field from `tool_input`; it canonicalizes the call's `file_path` and looks up the most-recently-issued unconsumed binding in `.meta-edit/state/grants/` matching that file.

```
on_pre_tool_use(toolName, toolInput):
  if toolName not in {Edit, Write, MultiEdit, NotebookEdit}:
    return deny("not a raw edit tool")

  # NotebookEdit re-allowed in v0.3.0 (issue 0105-notebookedit). The
  # original simulate()-based objection was eliminated when v0.2.1
  # dropped after_sha256 / replay; the staleness check on
  # before_sha256 operates on byte content, well-defined for .ipynb
  # JSON regardless of cell semantics.
  path_field = "notebook_path" if toolName == "NotebookEdit" else "file_path"
  file_path = realpath(toolInput[path_field])
  if file_path is None:
    return deny("missing or non-canonical " + path_field)
  if file_path is outside repoRoot:
    return allow()  # 1102: out-of-repo writes are not governed

  match = grants.findActiveBindingForFile(file_path)
  if match is None:
    return deny("no active typed_edit declaration covers this file")

  # Pre-condition: declared starting state matches disk.
  disk_content = read(file_path) if exists(file_path) else b""
  if sha256(disk_content) != match.binding.before_sha256:
    return deny("disk has drifted from declaration (staleness)")

  grants.consume(match.grant.token_id, file_path)
  appendConsumed(edit_log, {
    edit_id: match.grant.edit_id,
    consuming_tool: toolName,
    ts: now(),
  })
  return allow()
```

`findActiveBindingForFile` scans every grant file in `.meta-edit/state/grants/`, skips expired entries, skips bindings already in `consumed_files`, and returns the most-recently-issued match (LIFO on `issued_at`). If multiple grants cover the same file, the agent's freshest intent wins.

The pre-condition check is **staleness detection**, not a TOCTOU defense: it catches declarations made against a prior disk state but does not eliminate the residual race between hook approval and the native write. The residual race is accepted under the threat model in Article 3.

> **v0.2.2 fix.** The v0.2.0 / v0.2.1 hook required the agent to surface the token by passing it as `_meta_edit_token` on the native Edit / Write / MultiEdit call. Claude Code's native edit tools have strict input schemas that reject extra fields, so the framework strips `_meta_edit_token` before the hook sees it — making the end-to-end flow unusable. v0.2.2 moves the binding-presence check entirely server-side: the agent makes a normal native call after `typed_edit`, and the hook resolves the active declaration on its own by file path. The constitutional principles (Article 5: declaration → presence-check → consume) are unchanged; only the implementation of the presence-check changed.

> **v0.2.1 thinning + v0.3.0 NotebookEdit re-allow.** A v0.2.0 draft of this hook also performed a `simulate(toolName, toolInput, disk_content)` replay and compared `sha256(proposed) == bound.after_sha256`. Per Article 3 (non-adversarial) and Article 4 (descriptions as comfortable tools), the post-condition check was friction without proportional value: it required client-supplied `after_sha256`, a per-tool replay engine in the hook, and a `NotebookEdit` UNSUPPORTED branch. All three were removed. v0.2.1 then policy-denied NotebookEdit at gate time as a placeholder until cell-semantics could be re-evaluated; v0.3.0 (issue 0105-notebookedit) lifts that deny because the staleness check on `before_sha256` operates on byte content (the `.ipynb` JSON file as a whole) and is well-defined regardless of cell semantics. NotebookEdit now routes through the same canonicalize → grant → consume → before_sha256 flow as Edit / Write / MultiEdit. The single load-bearing pre-condition remains the byte-level staleness check.

Read-only tools (Read, Grep, Glob, Bash without writes, ...) do not consume tokens; the agent may freely interleave them between declaration and consumption, bounded only by the token's TTL.

When the hook authorizes the native write (i.e. just before returning `allow`), it appends a `consumed` record to `.meta-edit/state/edits.jsonl` (see §6). The record captures hook authorization, not write completion — the actual write success is git's job to verify, and under Article 3's friendly-AI threat model, write failures after hook approval are rare and recoverable.

Other-MCP write paths (e.g. `ctx_execute` writing to disk without going through this hook — see issue 1108) are an acknowledged hook-scope gap. Closing that gap is a future hook expansion (PostToolUse monitoring, MCP-write allowlist), not part of this hook.

### 5.2. deny-bash-write-bypass

Fires on Claude Code's `Bash` tool. Denies write patterns that would route bytes into the repository without going through native Edit/Write:

- **Verb denylist**: `cat >`, `sed -i`, `tee`, `dd of=`, `mv`, `cp`, `patch`, `rsync`, `git apply`, ...
- **Heredoc-with-redirect**: `cat <<EOF > target`
- **Inline interpreter writes**: `python -c '...write'`, `node -e '...write'`, `perl -e ...`, `ruby -e ...`, `php -r ...`
- **Decode-and-execute pipelines**: `base64 -d | bash`, `eval "$(...)"`
- **Protected-path writes**: `printf > .meta-edit/state/...` (always denied regardless of redirect target)

The structural redirect-target check (a redirect to a path outside the safe-sink allowlist) is **warned, not denied** since v0.1.5. The call proceeds with a `permissionDecisionReason` nudging the agent toward an `edit_*` tool. The verb-denylist and protected-path checks remain `deny`.

Substring-matching is the bypass-resistance limit. Determined commands (alternative interpreters, encoded payloads, exotic constructs) can evade. Per Article 3's non-adversarial assumption, the goal is to make the typed surface easier than honest workaround paths, not to provide a sandbox.

---

## 6. Edit log

`.meta-edit/state/edits.jsonl` — JSON Lines, append-only, protected.

Each declaration produces two records:

1. **Issued** — written when the typed_edit handler returns success.

```json
{"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:00+09:00",
 "phase":"issued",
 "kind":"edit_boundary_condition",
 "target_file":"src/foo.ts",
 "rationale":"...",
 "risk_level":"medium",
 "test_files":["tests/foo.test.ts"],
 "binding":[{"file":"src/foo.ts","before_sha256":"..."}],
 "token":"met_20260502_a3f9b2..."}
```

2. **Consumed** — written when the deny-raw-edit hook authorizes a native write (PreToolUse, before the write executes). "Consumed" denotes hook authorization; write success is not part of the audit log (see §5).

```json
{"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:11+09:00",
 "phase":"consumed",
 "consuming_tool":"Edit"}
```

Records reaching only `issued` without a `consumed` sibling are evidence of a half-finished declaration (token expired, agent abandoned the edit). Audit consumers reconcile by `edit_id`.

Failed declarations (validation rejection at the MCP server) record one entry with `phase: "rejected"` and a non-empty `audit_error` field.

Rotation and retention are not specified; in MVP the file grows unbounded. Operators that anticipate long-running deployments should add their own rotation outside `meta-edit`.

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


## 9. Configuration

`meta-edit` requires no configuration to run. Sensible defaults are baked into the server.

If configuration is needed in the future (e.g., adjusting allowlist for the bash hook), it will live at `.meta-edit/config.yml` and changes to it will require `edit_policy_change`. For now, the configuration surface is empty.

---

## 10. Implementation notes

### Recommended stack

- TypeScript for the MCP server, hooks, and CLI
- `zod` for argument schemas
- JSONL for the edit log; no database
- Bun + Node 20 in CI

### Repository layout

```
meta-edit/
  src/
    tools/
      common.ts             shared types, validation, token issuance
      descriptions.ts       the eighteen descriptions, verbatim from §4
      registry.ts           MCP tool registration
    server.ts               MCP stdio server entry
    cli.ts                  CLI entry
    state/
      edit-log.ts           jsonl read/write
      grants.ts             token issuance / lookup / consumption
      protected-paths.ts    path matching
    hooks/
      deny-raw-edit.ts
      deny-bash-write-bypass.ts
  examples/
    .github/workflows/meta-edit-summary.yml
  package.json
  README.md  CLAUDE.md  SPEC.md
```

### Descriptions-verbatim rule

`src/tools/descriptions.ts` contains the eighteen descriptions from §4 of this document, verbatim. Spec and code MUST stay in sync; any change to either updates both in the same change.

Tool handlers share common logic via helpers, but each tool is registered separately under the MCP server with its own description. Per Article 4, tool selection is the cognitive intervention; the surface is not collapsed into a generic `kind`-parameterized handler.

---



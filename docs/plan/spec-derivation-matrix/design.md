# Design: Spec-derivation matrix + description slim + reminder relocation

- **Status:** Draft — pending project-owner sign-off + Codex adversarial review
- **Created:** 2026-05-24
- **Branch context:** `feature/spec-derivation-matrix`
- **Target version:** 0.8.0 (minor — additive matrix dimension, no schema breaking)
- **Change class:** `edit_policy_change` (touches SPEC §3, all 16 impl tool descriptions, validator, audit warning union, reminder, next_action composition)

---

## 1. Problem

Three distinct quality gaps were observed when discussing the
declaration success message and the tool descriptions that lead up
to it:

1. **`next_action` ordering puts housekeeping ahead of obligations.**
   The current composition (`src/tools/apply.ts:237-243`) leads with
   "the deny-raw-edit hook will resolve this declaration automatically
   ... covers N files and expires at ..." — procedural receipt — and
   only then appends the `meta-edit reminder:` block carrying the
   kind-cue, provenance-cue, target follow-up, and audit warnings.
   Primacy effect risks the load-bearing content being skipped.

2. **Tool descriptions carry per-target obligations the agent can
   only act on AFTER target is known.** The 16 impl tool descriptions
   each interleave (a) kind-selection signals ("Use this tool when
   ..."), (b) `Required tests (you MUST ...)` blocks specific to the
   prod side, (c) `Target (required):` blocks that assume a prod-first
   ordering ("the file pointed at by your earlier `target: prod`
   declaration's `test_files`"), and (d) genealogical / motivational
   prose ("SQLite testing methodology treats boundary tests as a hard
   requirement", "Off-by-one errors are the most common bug class",
   "particularly insidious"). The agent reads the description at tool
   *selection* time; at that moment target has not yet been chosen,
   the prod-first ordering is wrong for red-first TDD, and the
   motivational prose is not actionable.

3. **The (kind, provenance) matrix in §3.3 does not yet capture an
   important spec-derivation principle: tests should pin
   spec-defined behavior, not implementation-defined behavior.** A
   test that derives its expected values from "what the prod code
   currently does" is tautological — it confirms the implementation
   matches the implementation, and fails to catch drift away from the
   spec. The natural provenance for a `target: "test"` declaration is
   therefore `accepted_artifact` (cite the spec / ADR / contract); a
   `direct_observation` test reads as derived from the prod code under
   test, which is a smell; and `inference` / `speculation` for a test
   are structurally fragile (you do not test against an unverified
   hypothesis). The base §3.3.1 matrix treats all impl tools as
   `OK` across every provenance, so this smell currently has no audit
   surface.

## 2. Constitutional fit

This is a **declaration extension**, not detection / classification /
verification. The new matrix consults already-declared values
(`kind`, `target`, `provenance`) and lands warns / rejects from the
same machinery the existing §3.3 cells use. Article 7 boundaries are
intact:

- Not detection: the matrix reads declared fields, never parses the
  diff or test file content.
- Not classification: the agent still classifies the edit itself; the
  matrix only audits the *combination* of declared classifications.
- Not verification: the matrix does not check that the test files
  contain the obligated cases, only that the declared trio is a
  coherent spec-derived shape.

The (kind, provenance) matrix in §3.3.1 is the direct precedent:
self-declared introspective fields, decided cell-wise, no diff
inspection. §3.3.5 (this design) adds `target` as a third axis to
that lattice.

## 3. Decisions taken in this brainstorming session

| # | Question | Decision |
|---|---|---|
| D1 | Add `target` as a third axis to §3.3 lattice? | Yes. New §3.3.5 (test-obligation matrix) limited to the 16 impl tools. |
| D2 | `target: "test"` × `provenance: "inference"` severity? | **REJ (V1 strict).** You do not test against an inferred spec. |
| D3 | `target: "test"` × `provenance: "speculation"` severity? | **REJ.** You do not test against an unverified hypothesis. |
| D4 | `target: "test"` × `provenance: "direct_observation"` severity? | **warn.** External-API black-box regression tests are a legitimate exception; the audit surface is the right shape, not REJ. |
| D5 | `target: "test"` × `provenance: "user_confirmed" / "accepted_artifact"` severity? | **OK.** Canonical cases. `accepted_artifact` is the typical (`◎`). |
| D6 | Does `edit_cosmetic` participate? | **No.** Cosmetic edits do not pin behavior; whitespace / formatter / information-invariant comment changes have no spec-derivation discipline to enforce. Carve-out same shape as §3.3.3 (provenance exclusion). |
| D7 | Does `target: "prod"` participate? | **No (this branch).** Prod-side impl tools keep §3.3.1's "all OK for every provenance" softness. The prose obligation already lives in the description footer; tightening the prod axis is a separate decision. |
| D8 | Slim impl tool descriptions in the same branch? | **Yes.** The motivation for the matrix is the same UX concern that the description bloat amplifies. Slimming and matrix arrive together so the reminder side absorbs the obligations the description sheds. |
| D9 | Move per-target obligations into the reminder? | **Yes.** The MCP response is the natural place for target-conditioned actionable text; the description retains only kind-selection signals + argument help + a pointer to "obligations are delivered in the declaration result". |
| D10 | Reorder `next_action` so reminder leads and housekeeping trails? | **Yes, same branch.** Both touch `apply.ts:237-243`; doing them in separate branches doubles regression surface for no benefit. |
| D11 | Version target? | **0.8.0.** §3.3 dimension extension is a constitutional addition. AuditWarning code addition is forward-compat only in one direction: a v0.8.0+ server may emit `target_spec_derivation_warn`; pre-v0.8.0 readers using the older `AuditWarningEntrySchema` zod enum will reject log lines carrying the new code (the enum is strict, observed via the Phase B impact survey 2026-05-24). The SPEC §3.3.5 entry MUST state this reader-version break explicitly; downstream consumers must be aware that audit_warnings on a v0.8.0 log requires a v0.8.0+ reader. |
| D12 | Worktree separation? | Branch only (`feature/spec-derivation-matrix`). No concurrent work needed. |

## 4. The 3D matrix (§3.3.5)

### 4.1. Cell decisions

Limited to the 15 SQLite-derived impl tools (`edit_cosmetic` is
exempt per D6). `target: "prod"` cells are OK across the board
(§3.3.1 unchanged for prod). The new cells are `target: "test"`:

```
                              u_c    a_a    d_o    inf    spec
target: "test", 15 SQLite     OK     OK◎    warn   REJ    REJ
target: "test", edit_cosmetic exempt — see §3.3.3 carve-out (no test obligations)
target: "prod", 15 SQLite     (covered by §3.3.1: all OK)
```

- `OK` — land without warning
- `OK◎` — typical / encouraged cell; the description steers toward it
- `warn` — land with `target_spec_derivation_warn` in `audit_warnings`
- `REJ` — reject the declaration outright

### 4.2. Per-cell rationale

| target | provenance | verdict | rationale |
|---|---|---|---|
| test | user_confirmed | OK | User verbally confirmed the spec value. Rationale should quote the user (per §3.3 prose obligation). |
| test | accepted_artifact | OK◎ | Canonical TDD: test pins spec-doc behavior. Rationale must cite the artifact (existing §3.3.4 lint enforces this softly). |
| test | direct_observation | warn | Smell: most often means "I read the prod code and pinned what it does." Legitimate uses (third-party API regression tests) survive the warn — the rationale should make the external observation source visible. |
| test | inference | REJ | Inferred spec values are not a basis for tests. If the spec is unclear, stop and ask. |
| test | speculation | REJ | Unverified hypotheses are not a basis for tests. |

### 4.3. New AuditWarning code

- `target_spec_derivation_warn` — emitted on `target: "test"` ×
  `direct_observation` cells. Added to the union in
  `src/tools/common.ts:AuditWarning.code` and to the zod enum in
  `src/state/edit-log.ts:AuditWarningEntrySchema`. Backward compatible
  (additive); existing log readers tolerate unknown codes.

### 4.4. Composition with existing §3.3 / §3.4

Order of evaluation in `validateRequest`:

1. §3.3.1 base (kind, provenance) — may REJ (e.g., `edit_decision +
   inference`) or warn.
2. §3.3.3 `edit_cosmetic` carve-out — may REJ.
3. §3.3.4 citation lint — may add warn.
4. §3.4 (kind, execution_state) — may add warn.
5. §3.3.5 (kind, target, provenance) — may REJ or add warn (NEW).
6. §3.3.2 `additional_files` — may REJ or warn (workflow only).

§3.3.5 lands after §3.4 and before §3.3.2; placement matches the
existing "1d → 1e" slot in `validateRequest` (per the matrix-impact
survey, the new block goes at `common.ts:~505` right after the
execution_state block).

**Workflow-target guard (per Codex review F2, observed 2026-05-24).**
The §3.3.5 gate MUST NOT fire on a workflow-axis kind that
accidentally carries `target`. The MCP schema already excludes
`target` from the workflow-tool input schema (per `registry.ts`'s
`workflowToolInputSchema`), but the validator's own gate is
load-bearing as defense-in-depth: the §3.3.5 block runs only when
`TOOLS_REQUIRING_TARGET.includes(kind)` is true. `request.target !==
undefined` alone is insufficient — a future schema regression that
allowed `target` to slip through on a workflow kind would silently
extend the matrix's scope. The implementation plan (Phase C.4.2) pins
this explicitly.

Multiple warns aggregate into the `audit_warnings` array; multiple
REJ cells short-circuit at the first REJ.

## 5. Description slim policy

For all 16 impl tools (15 SQLite + `edit_cosmetic`), each
description shrinks along three axes:

### 5.1. Remove genealogical / motivational prose

Cut sentences that justify the obligation rather than direct
behavior. Examples to cut (representative, not exhaustive):

- `edit_boundary_condition`: "These three cases are non-negotiable.
  Off-by-one errors are the most common bug class in this category,
  and SQLite testing methodology treats boundary tests as a hard
  requirement."
- `edit_boolean_condition`: "This is a lightweight version of MC/DC
  (Modified Condition / Decision Coverage). Full MC/DC is not
  required, but the spirit of 'each condition independently affects
  outcome' is."
- `edit_state_transition`: "State transition bugs are particularly
  insidious because they often manifest only under specific orderings
  of events."
- `edit_data_migration`: "Data migrations are one-way operations on
  production data. Test them as thoroughly as production code,
  ideally more so." (note: the `idempotency test … write it first`
  fragment in the same paragraph is **load-bearing**, not motivational —
  see §5.1.1.)
- `edit_external_side_effect`: "Send-money-but-fail-to-record is the
  textbook AI-generated billing bug." (note: the `real external call …
  your test is wrong` clause from a separate paragraph is
  **load-bearing**, not motivational — see §5.1.1.)
- `edit_permission_logic`: "Permission bugs are silent failures that
  compromise data integrity, user trust, and regulatory compliance."

The load-bearing words are `MUST`, `non-negotiable`, `stop and ask`,
and the bullet enumeration. Justification belongs in SPEC.md preamble
or external references (`sqlite.org/testing.html`), not in the
per-tool description.

### 5.1.1. Load-bearing sentences to preserve (Codex review F3)

The first plan draft over-cut three sentences that are not motivational
but operational obligations. They must be retained — either in the
description (preferred when the obligation is at *kind-selection* time)
or relocated verbatim-equivalent into the reminder's
`kindObligationsLine` (preferred when the obligation is at *next-action*
time, after target is chosen).

| Tool | Sentence | Why load-bearing | Placement |
|---|---|---|---|
| `edit_data_migration` | "The idempotency test is the single most important one — write it first." | Imposes a TDD-style ordering obligation on a specific test before others. Removing it allows an agent to deprioritize idempotency without notice. | Reminder `kindObligationsLine` target=prod paragraph; the test-side paragraph references the same ordering. |
| `edit_external_side_effect` | "If your test makes a real external call, your test is wrong." | A prohibition (the test contract). Without it, target="test" declarations with real-network test files appear declaration-clean. | Description body (retained near the kind-selection signals) AND mirrored in the reminder target=test paragraph. |
| `edit_policy_change` | "Policy changes that LOOSEN restrictions … require an explicit justification in rationale that explains why the loosening is safe. 'Convenience' is not an acceptable rationale. If your change loosens a restriction without a strong justification, do not use this tool." | Gating condition on whether the tool is even the right choice. Removing it weakens the kind boundary. | Description body, retained (this is a kind-selection-time obligation, not a per-target one). |

The implementation plan's Phase D treats these as **preserve** rather
than **delete**; the per-tool diff sketch enumerates them as such.

### 5.2. Move per-target obligations into the reminder

The `Required tests (you MUST cover ...)` block in each impl tool's
description is removed from the description body. In its place, a
single pointer line:

> Per-target obligations (what `target: "prod"` commits to, what
> `target: "test"` must contain) are delivered in the declaration
> result. Stop and ask if you cannot enumerate them at declaration
> time.

The obligation text itself moves to `src/reminders/context.ts` via
`kindObligationsLine` (§6).

### 5.3. Order-independent target framing

The current `Target (required):` blocks all say:

> Declare `target: "prod"` when editing the production X, or
> `target: "test"` when editing the X tests (the file pointed at by
> your **earlier** `target: prod` declaration's `test_files`).

The bolded clause forces a prod-first ordering, which is wrong for
red-first TDD. Replace with:

> Declare `target: "prod"` for the production-side edit and
> `target: "test"` for the test-side edit. The two declarations may
> land in either order (test-first / prod-first). When
> `target: "test"`, `target_file` IS the test file and `test_files`
> must be empty.

**Propagation outside §4 (Codex review F4).** SPEC.md normative
paragraphs *outside* §4's per-tool blocks also describe pair ordering
(notably the `target` field rules in §3 — `docs/SPEC.md:74` JSON-schema
description in `registry.ts`, the §3 narrative around target on impl
tools, and possibly Article 4's prose). These sites must be updated
to the order-independent framing in the same branch; otherwise the §4
slim creates a contradiction with the higher-level narrative. The
implementation plan's Phase A enumerates these sites concretely.

### 5.4. Insert one spec-derivation framing line per impl tool

Inserted just after the 1-line summary, before "Use this tool when".
The line frames the *concept being edited* (boundary value, condition,
transition, schema constraint, ...) as **spec-defined**, not
implementation-defined. The slogan template:

> The <CONCEPT> being changed is defined by the spec / accepted
> artifact / user statement, not by what the implementation currently
> happens to <COMPUTE>.

Per-kind variants in §6 below. `edit_cosmetic` gets the inverse line:

> Cosmetic edits are exempt from spec-derivation discipline —
> whitespace, formatter output, and information-invariant comment
> edits do not pin behavior.

## 6. Reminder `kindObligationsLine` (per kind × target)

A new builder added to `src/reminders/context.ts`, inserted into
`buildReminderContext`'s `lines` array between `kindCueLine`
(`lines[2]`) and `provenanceLine` (`lines[3]`). Returns a paragraph
when `kind ∈ impl tools` AND `target` is declared; otherwise
`undefined`. `edit_cosmetic` returns `undefined` (no obligations).
Workflow kinds (no target) return `undefined`.

Each entry has a `prod` paragraph and a `test` paragraph. The `test`
paragraph carries the spec-derivation framing.

**What "spec-defined" means in this design (Codex review F5).** The
umbrella covers any of the following declared sources, in descending
order of formality:

1. An accepted artifact: a written spec, ADR, RFC, API contract,
   state diagram, ERD, policy document, SLA, RFC-track issue. The
   typical provenance is `accepted_artifact`; the rationale cites the
   artifact per §3.3.4 lint.
2. A user-confirmed statement in the current session — provenance
   `user_confirmed`, rationale quotes or paraphrases the statement.
3. An external observed contract — provenance `direct_observation`
   where the observation source is an *external* system (third-party
   API behavior under test as regression contract, vendor
   documentation). The rationale must make the externality visible.

What "spec-defined" explicitly does NOT mean: the current production
code's behavior, observed by reading the codebase you are about to
modify. That is the impl-mirror smell §3.3.5 audits.

### 6.1. Per-kind reminder text (SQLite-anchored)

Per user fiat D13 (2026-05-24), per-kind reminder wording is lifted
from the relevant section of <https://sqlite.org/testing.html> — the
methodological lineage of meta-edit's impl tools (CLAUDE.md §2).
Each subsection below names the SQLite anchor, two-to-four anchor
phrases from that section, the `target=test` reminder paragraph
(which carries the spec-derivation principle in the kind's native
vocabulary), and the shorter `target=prod` reminder.

**Three SQLite ideas every reminder leans on:**

- §5 *Regression Testing* — "not considered fixed until new test
  cases that would exhibit the bug have been added." Maps to
  meta-edit's `test_files` obligation as a permanent record of the
  decision.
- §7.3 / §7.4 *MC/DC and testcase markers* — "each condition
  independently affects the outcome." The generic anti-impl-mirror
  shape: a test must be derivable from the spec without reading the
  impl.
- §9 *Disabled Optimization Tests* — "should always generate exactly
  the same answer with optimizations enabled and with optimizations
  disabled." The canonical shape of an invariant test: run a scenario
  two ways, assert equality.

**Honest gap.** SQLite has no clean analog for three kinds —
`edit_state_transition`, `edit_external_side_effect`, and
`edit_cache_invalidation`. Each subsection below uses a substitute
anchor and says so explicitly. `edit_permission_logic` and
`edit_policy_change` also have no dedicated SQLite section but reuse
canonical anchors (§7.4 MC/DC + §4 fuzz; §4.3 boundary + §5
regression).

**Implementation rule (user fiat D15, 2026-05-24): strip SQLite
meta-citations from runtime text.** The drafts below retain
`(§4.3)`, `(§9-style)`, `(§5.1.1 retention)`, "the §3.4 compound
case", and similar SQLite-canonical citations for design-time
traceability — so a future reader can audit *why* each phrase was
chosen. The runtime reminder strings in `src/reminders/context.ts`
MUST NOT carry those citations. The reading agent has not read
sqlite.org/testing.html and should not be sent to it from a
declaration result; the cited *concept and vocabulary* survive, the
section markers are stripped. Concrete transform:

- Design draft: "push the system right to the edge of its defined
  limits (§4.3)."
- Runtime string: "push the system right to the edge of its defined
  limits."

The same rule applies to retention markers (e.g., "§5.1.1
retention" or "§3.4 compound case") — they exist only in this
design doc and in any commit message that references the rewrite;
they never appear in `KIND_TARGET_OBLIGATIONS` literals or in
emitted reminder text. Phase E's acceptance criteria pin this with
a grep check.

#### 6.1.1. `edit_boundary_condition`

**SQLite anchor:** §4.3 *Boundary Value Tests* +
§7.3 *Forcing coverage of boundary values*
(<https://sqlite.org/testing.html#bvt>).
**Anchor phrases:** "push SQLite right to the edge of its defined
limits"; "verify that both sides of each boundary have been tested";
"tests go beyond the defined limits and verify that SQLite correctly
returns errors"; "test when `a==b` and when `a==b+1`".

**target=test:** This test pins the *defined limits* of the boundary
— both sides of the threshold and the case just beyond it where the
spec says an error is the correct answer. The impl-mirror smell is a
single off-by-one fixed-point lifted from the production code; real
boundary tests push the system "right to the edge of its defined
limits" (§4.3). Cite an `accepted_artifact` that names the limit; if
the only provenance is `direct_observation` against prod, the
boundary the test pins is whatever the implementation happens to do,
not what was promised.

**target=prod:** You forward-declared boundary-value tests; this
production edit must keep the defined limits stable on both sides
(§4.3). Movement of the threshold itself is a different kind —
re-classify, do not absorb.

#### 6.1.2. `edit_boolean_condition`

**SQLite anchor:** §7.4 *Branch coverage versus MC/DC*
(<https://sqlite.org/testing.html#mcdc>) + §7.1 *Statement versus
branch coverage*.
**Anchor phrases:** "each condition in a decision takes on every
possible outcome"; "each condition independently affects the outcome
of the decision"; "100% MC/DC in addition to 100% branch coverage".

**target=test:** This test pins the *decision* — every atomic
condition independently flips the outcome (§7.4 MC/DC), not merely
drives the predicate to true once and false once. The impl-mirror
smell is one happy-path case and one failure case, which achieves
statement coverage (§7.1's weakest sense) but cannot show that each
sub-condition matters. Cite an `accepted_artifact` stating the rule
the predicate encodes; `direct_observation` provenance usually means
"I read `&&` and `||` and wrote a case per branch", which mirrors
the implementation.

**target=prod:** You committed to predicate-level (MC/DC-flavored)
tests; this production edit must keep each clause's independent
effect on the outcome observable. Collapsing two conditions or
short-circuiting one away breaks the matrix — re-derive it from the
spec, do not let the new code shape it.

#### 6.1.3. `edit_state_transition`

**SQLite anchor (substitute):** *No clean SQLite analog.* Nearest
disciplines: §8.5 *Journal Tests*
(<https://sqlite.org/testing.html#jt>) for invariant-across-a-sequence;
§3.3 *Crash Testing* for state-after-fault.
**Anchor phrases:** "monitors all … traffic … checking to make sure
that nothing is written … which has not first been written and
synced" (§8.5); "anomaly tests are tests designed to verify the
correct behavior … when something goes wrong" (§3).

**target=test:** This test pins the *legal transition graph* —
which states reach which, which transitions are forbidden, and what
invariant holds across each edge. SQLite has no FSM-test section;
the nearest analog is §8.5's journal-test discipline, which monitors
a sequence and asserts an invariant ("nothing is written into X
which has not first been written and synced to Y") across every
transition. The impl-mirror smell is a test that walks the exact
sequence the code happens to implement and only asserts the final
state. Cite an `accepted_artifact` drawing the state diagram; cover
at least one forbidden transition explicitly (the §3.3 analog).

**target=prod:** You forward-declared state-transition tests; this
production edit must preserve which transitions are legal, which
are forbidden, and the across-edge invariants. Adding or removing a
state, or changing reachability, is a spec-level change — surface it.

#### 6.1.4. `edit_db_schema`

**SQLite anchor (substitute):** *No dedicated section.* SQLite tests
schema via §5 *Regression Testing* + §10 *Checklists* + the
`PRAGMA integrity_check` invariant cited throughout §3.
**Anchor phrases:** "PRAGMA integrity_check … to make sure that …
has not introduced database corruption"; "approximately 200 items
that are individually verified for each release" (§10); "keep a
human in the loop" (§10).

**target=test:** This test pins the *schema invariants* —
uniqueness, foreign-key closure, nullability, index reachability —
the application-level equivalent of `integrity_check`. Inspecting
the produced schema shape is fine; sourcing the *expected* shape
from the current `CREATE TABLE` is the impl-mirror smell. Cite an
`accepted_artifact` (ERD, data dictionary, ADR) naming each
invariant; treat each as a §10 checklist item that a human signs off
on. `direct_observation` against the migration is a happy-path
round-trip, not an invariant test.

**target=prod:** You committed to schema-invariant tests; this
production edit must keep the invariants enforceable by the DB
itself (constraints, indexes, FKs). Moving a constraint from the DB
to application code is a separate decision — surface it, do not
weaken the schema and lean on tests to catch it.

#### 6.1.5. `edit_data_migration`

**SQLite anchor:** §3 *Anomaly Testing*
(<https://sqlite.org/testing.html#anomaly>), particularly §3.3
*Crash Testing* and §3.4 *Compound failure tests*.
**Anchor phrases:** "anomaly tests are tests designed to verify the
correct behavior … when something goes wrong"; "will not go corrupt
if the application or operating system crashes" (§3.3); "explore the
result of stacking multiple failures … while trying to recover from
a prior crash" (§3.4).

**target=test:** This test pins the *anomaly behavior* of the
migration — what holds if the process dies mid-way, what holds on
re-run, what holds under §3.4 compound failure. Inspecting produced
data is fine; the *expected* shape comes from the migration's
stated invariants, not from sampling current prod rows. The
impl-mirror smell is a "ran in a clean DB, counted rows, looks fine"
test, which is the happy path §3 explicitly says anomaly testing is
not for. Include at least one mid-migration interruption case in
the spirit of §3.3. The idempotency test runs first (§5.1.1).

**target=prod:** You forward-declared anomaly-style migration tests;
this production migration must remain safe under interruption and
re-run per §3. A new atomic step the old migration did not require
changes the anomaly surface — re-derive the test list, do not reuse
the old one.

#### 6.1.6. `edit_api_contract`

**SQLite anchor (weak):** Closest disciplines: §5 *Regression
Testing* ("not considered fixed until new test cases that would
exhibit the bug have been added") and TH3's "tests use only the
published … interfaces"; §2 *SLT* compares against an external
oracle (PostgreSQL, MySQL, …).
**Anchor phrases:** "use only the published … interfaces" (the
*published* surface is the contract); "external oracle" (the spec
text, not the impl).

**target=test:** This test pins the *published interface* — request
shape, response shape, status codes, error semantics — using only
what callers can observe (the TH3 discipline applied to your API).
The impl-mirror smell is a test asserting on internal serialization
order, internal field names not in the contract, or response timing
the spec does not promise: that pins the implementation, not the
contract. Cite an `accepted_artifact` (OpenAPI / IDL / RFC / contract
doc); `direct_observation` lets the test accidentally pin
implementation leaks.

**target=prod:** You committed to contract-level tests; this
production edit must keep the published interface stable. Adding a
field, narrowing input, or widening output is a contract change —
re-classify, do not absorb.

#### 6.1.7. `edit_serialization`

**SQLite anchor:** §4.2 *Malformed Database Files*
(<https://sqlite.org/testing.html#mdb_test>) for robustness;
§9 *Disabled Optimization Tests* (<https://sqlite.org/testing.html#dot>)
for equivalence; §8.6 for representation-independence.
**Anchor phrases:** "add corruption by changing one or more bytes
in the file by some means other than SQLite" (§4.2); "without
overflowing buffers, dereferencing NULL pointers, or performing
other unwholesome actions" (§4.2); "should always generate exactly
the same answer … the answer simply arrives quicker" (§9, applied
to serializer round-trip).

**target=test:** This test pins two things: *round-trip equivalence*
(serialize → deserialize → same value, the §9-shape invariant) and
*malformed-input robustness* (§4.2: parser must reject bytes "changed
… by some means other than" the canonical serializer "without …
unwholesome actions"). The impl-mirror smell is a test that
round-trips through the same library version's own encoder and
decoder — that proves a fixed point of the current implementation,
not format compatibility. Include at least one cross-version or
hand-crafted byte fixture (§4.2 spirit). `direct_observation` here
almost always pins byte-level encoder details.

**target=prod:** You forward-declared round-trip and malformed-input
tests; this production edit must keep the serialized form readable
by older consumers (or explicitly bump a version) and keep the parser
robust against bytes it did not produce. Regenerating fixtures from
the new encoder destroys the §9-style equivalence signal — re-derive
fixtures from the spec.

#### 6.1.8. `edit_error_handling`

**SQLite anchor:** §3.1 *Out-Of-Memory Testing*
(<https://sqlite.org/testing.html#oom_testing>) + §3.2 *I/O Error
Testing* (<https://sqlite.org/testing.html#ioerr_testing>).
**Anchor phrases:** "modified `malloc()` rigged to fail after a
certain number of allocations" (§3.1); "Virtual File System object …
specially rigged to simulate an I/O error after a set number of I/O
operations" (§3.2); "single-failure modes and … continuous-failure
modes" (§3.1); "PRAGMA integrity_check to confirm database integrity"
(§3.2).

**target=test:** This test pins behavior *under injected failure*,
not behavior on the happy path — the §3.1/§3.2 discipline of rigging
a dependency to fail "after a certain number of operations" and
asserting both that the error is reported correctly and no invariant
is violated. The impl-mirror smell is a test asserting `try/catch`
fires on a real (uninjected) error during setup: that mirrors the
catch block the code happens to have, not the spec's promise about
errors. Cite an `accepted_artifact` listing which failure modes the
contract acknowledges; run both single-failure and continuous-failure
modes (§3.1) where the surface allows.

**target=prod:** You committed to fault-injection tests; this
production edit must keep every error path observable from the
outside (correct code returned, no resource leaked, no invariant
violated) per §3.1/§3.2. A catch that drops the error silently is
the failure case those tests exist to detect.

#### 6.1.9. `edit_retry_timeout`

**SQLite anchor (partial):** §3.4 *Compound failure tests* +
§3.1's "single-failure modes and continuous-failure modes" framing.
**Anchor phrases:** "stacking multiple failures … while trying to
recover from a prior crash" (§3.4); "continuous-failure modes after
initial breakdown" (§3.1, the exhaustion case); "the failure point
incrementally advances until operations complete successfully" (§3.1,
the "Nth attempt succeeds" case).

**target=test:** This test pins the *exhaustion semantics* — how
many retries, what backoff, what the caller sees after the final
attempt — and the §3.4 compound case where the retry itself
encounters a new failure. The impl-mirror smell is asserting "after
retry succeeds, value matches": that proves the retry loop exits,
not that the policy is correct. Cover §3.1's two cases — "Nth
attempt succeeds" (recovery point advances) and "every attempt
fails" (continuous-failure mode) — plus the §3.4 compound case
"retry path itself hits a different failure". Cite an
`accepted_artifact` naming the retry budget; `direct_observation`
gives you whatever count happens to be configured in prod.

**target=prod:** You forward-declared retry/timeout exhaustion
tests; this production edit must keep the budget, backoff schedule,
and giveup signal compatible with what those tests assert. Silent
budget extension masks an underlying error and breaks the §3.4
compound-failure expectation — surface it.

#### 6.1.10. `edit_concurrency`

**SQLite anchor:** §8.4 *Mutex Asserts*
(<https://sqlite.org/testing.html#mutex_assert>) + §8.5 *Journal
Tests*; §8.1 *Function preconditions and postconditions*.
**Anchor phrases:** "verify mutexes are held and released at all
the right moments" (§8.4); "monitors all disk I/O traffic …
nothing is written … which has not first been written and synced"
(§8.5); "verify function preconditions and postconditions and loop
invariants" (§8.1).

**target=test:** This test pins the *across-interleaving invariant*
— what must always hold regardless of which thread interleaves where
— not a particular observed interleaving. §8.4's discipline is
exactly this: mutexes are asserted held "at all the right moments",
an invariant statement, not a trace. §8.5's journal-test shape
("nothing is written into X which has not first been written and
synced to Y") is the canonical invariant. The impl-mirror smell is
running two threads, hitting a race a few times by luck, and
asserting no exception fires — that pins the OS schedule, not the
invariant. Cite an `accepted_artifact` naming the invariant (lock
order, happens-before relation, atomicity boundary); prefer a §8.1
precondition/postcondition assertion to a probabilistic schedule.

**target=prod:** You committed to interleaving-invariant tests;
this production edit must keep the lock order / happens-before /
atomicity boundary intact. Widening or narrowing a critical section
is a §8.4-relevant change — re-derive the invariant list, do not
lean on existing tests to catch a regression they were not designed
for.

#### 6.1.11. `edit_external_side_effect`

**SQLite anchor (substitute):** *No clean SQLite analog* — SQLite is
side-effect-light by design. Nearest discipline: §6 *Automatic
Resource Leak Detection* combined with §3.3's snapshot framing.
**Anchor phrases:** "automatically track system resources and report
resource leaks on every test run" (§6, generalized to outbound
side-effect accounting); "never leak … even after an exception such
as an OOM error or disk I/O error" (§6, generalized to idempotency
under retry).

**target=test:** This test pins what is sent *to the outside world*
— count, ordering, idempotency under replay — analogous to §6's
"track resources and report leaks on every test run", except the
accounting is over outbound effects (emails, webhooks, payments, log
lines) rather than memory. The impl-mirror smell is asserting the
side-effect function was called once on the happy path, with no
retry-replay assertion, no partial-failure assertion, no ordering
assertion: that pins the call site, not the contract. Cite an
`accepted_artifact` describing the at-least-once / at-most-once /
exactly-once contract; `direct_observation` gives you the
production frequency, which is a fact about traffic, not about the
contract.

**target=prod:** You forward-declared side-effect accounting tests;
this production edit must keep the at-least-once / at-most-once /
exactly-once posture stated in the test, and keep emissions
idempotent under retry per the §6-style "survives an exception"
obligation. Adding a side effect to a previously side-effect-free
path is a re-classification. **"If your test makes a real external
call, your test is wrong" (§5.1.1 retention) — applies here.**

#### 6.1.12. `edit_cache_invalidation`

**SQLite anchor (substitute):** *No clean SQLite analog* — SQLite
does not discuss page-cache invalidation tests. Nearest discipline:
§9 *Disabled Optimization Tests*
(<https://sqlite.org/testing.html#dot>) — the canonical "the
optimization must not change the answer" invariant.
**Anchor phrases:** "should always generate exactly the same answer
with optimizations enabled and with optimizations disabled" (§9);
"the answer simply arrives quicker with the optimizations turned on"
(§9); "run the entire test suite twice … once with optimizations
left on and a second time with optimizations turned off, and verify
that the same output is obtained both times" (§9 — canonical
cache-invalidation test shape).

**target=test:** This test pins the *freshness invariant*: cached
answer must equal authoritative answer for every input — exactly
§9's "exactly the same answer with optimizations enabled and with
optimizations disabled". The impl-mirror smell is a write-through
read-back test (the easiest case, read-your-own-writes) that
entirely skips the cross-actor invalidation case where someone else
changed the underlying data. SQLite has no section for this kind
directly; §9's framing gives the right shape: run scenario with
cache on, run with cache busted, assert identical results. Cite an
`accepted_artifact` naming the staleness budget;
`direct_observation` gives you the TTL window, not the contract.

**target=prod:** You committed to freshness-invariant tests; this
production edit must keep the §9-style equivalence "cached answer
== authoritative answer" intact for every documented invalidation
trigger. A new write path that does not invalidate the cache
silently widens the staleness window — the canonical failure this
kind exists to catch.

#### 6.1.13. `edit_permission_logic`

**SQLite anchor (substitute):** *No clean SQLite analog* (the
document does not describe `sqlite3_set_authorizer` testing).
Nearest disciplines: §7.4 *MC/DC* (the authz matrix is a
decision-coverage problem); §4 *Fuzz Testing*
(<https://sqlite.org/testing.html#fuzztesting>) for the negative
space.
**Anchor phrases:** "each condition independently affects the
outcome" (§7.4 — every {role, resource, action} bit must
independently flip allow/deny); "fuzz testing seeks to establish
that SQLite responds correctly to invalid, out-of-range, or
malformed inputs" (§4 — the negative space must be tested
explicitly).

**target=test:** This test pins the *authorization matrix* — every
{principal, resource, action} cell exercised in both allow and deny
direction, an MC/DC-flavored obligation where each axis
independently flips the decision (§7.4). The impl-mirror smell is
a test that walks the if/else ladder in the authz function and
writes one case per leaf: that proves the code is consistent with
itself, not that the matrix matches the policy. Cite an
`accepted_artifact` (RBAC table, policy doc, ADR);
`direct_observation` is a strong smell because in prod you only see
allowed requests at scale — denied requests are the §4 negative
space, which must be tested explicitly.

**target=prod:** You forward-declared an authz matrix; this
production edit must keep every cell's allow/deny decision matching
the cited policy. Loosening a deny or tightening an allow is
`edit_policy_change`, not this kind — re-classify, do not let the
matrix drift.

#### 6.1.14. `edit_dependency_config`

**SQLite anchor:** §8.6 *Undefined Behavior Checks*
(<https://sqlite.org/testing.html#ub>) + §9 *Disabled Optimization
Tests* + §10 *Checklists*.
**Anchor phrases:** "32-bit and 64-bit systems and on big-endian
and little-endian systems, using a variety of CPU architectures"
(§8.6); "using options like `-funsigned-char` and `-fsigned-char`
to make sure that implementation differences do not matter" (§8.6);
"the entire test suite … once with optimizations left on and a
second time with optimizations turned off" (§9 — same answer
across build variants).

**target=test:** This test pins behavior *across the dependency /
build matrix* — the §8.6 / §9 discipline that the same answer must
come out regardless of optimization level, signed-char default,
endianness, or word size. The impl-mirror smell is a test that
succeeds on the developer's exact toolchain version and silently
depends on it: that pins the dev environment, not the supported
environment. Cite an `accepted_artifact` (supported-versions table,
MSRV / engines policy, build-matrix CI config); for a pinned
dependency version, include at least the boundary versions of the
supported range (§8.6 architecture/option sweep spirit).

**target=prod:** You committed to build-matrix tests; this
production edit must keep the §9-style equivalence "same answer
across all supported build variants" intact. Tightening a version
range is `edit_policy_change`; widening it requires fresh evidence
from each new supported point — do not extrapolate.

#### 6.1.15. `edit_policy_change`

**SQLite anchor (substitute):** *No clean SQLite analog.* Nearest
disciplines: §5 *Regression Testing* ("not considered fixed until
new test cases that would exhibit the bug have been added")
combined with §4.3 *Boundary Value Tests* (a policy change is a
boundary move).
**Anchor phrases:** "not considered fixed until new test cases that
would exhibit the bug have been added" (§5 — every policy change
earns a permanent test on both sides of the line); "push SQLite
right to the edge of its defined limits" (§4.3 — the policy line is
itself a boundary); "tests go beyond the defined limits and verify
that SQLite correctly returns errors" (§4.3 — the forbidden side
must produce the documented refusal).

**target=test:** This test pins *both sides of the policy line* —
the case just inside the new policy (must be allowed) and the case
just outside (must be refused with the documented signal). This is
the §4.3 boundary-value pattern applied to a rule rather than a
numeric limit, paired with the §5 obligation that every policy
clarification earns a permanent test. The impl-mirror smell is
exercising only the side of the line that changed (loosening: only
the newly-allowed case; tightening: only the newly-forbidden case):
that demonstrates the code did the thing, not that the line is in
the right place. Cite an `accepted_artifact` stating the new line.

**target=prod:** You forward-declared both-sides-of-the-line tests;
this production edit must keep the documented refusal on the
forbidden side and the documented acceptance on the allowed side,
per §5 "tests as permanent record of the decision". **Per §5.1.1
retention: the LOOSEN-restriction obligation stays in this tool's
description — a loosening without a strong rationale citation means
this is the wrong tool.** Quiet threshold drift without updating the
cited artifact is the canonical failure this kind exists to prevent.

### 6.2. Insertion mechanics

```
// src/reminders/context.ts (sketch)
function kindObligationsLine(input: ReminderInput): string | undefined {
  const { kind, target } = input;
  if (kind === undefined || target === undefined) return undefined;
  if (kind === "edit_cosmetic") return undefined;
  const entry = KIND_TARGET_OBLIGATIONS[kind];
  if (entry === undefined) return undefined;
  return target === "prod" ? entry.prod : entry.test;
}

const KIND_TARGET_OBLIGATIONS: Partial<Record<ToolName,
  { prod: string; test: string }>> = {
    edit_boundary_condition: { prod: "...", test: "..." },
    // ...
  };
```

Workflow kinds and `edit_cosmetic` short-circuit to `undefined`; the
existing `kindCueLine` continues to serve them as today.

## 7. `next_action` reorder

`src/tools/apply.ts:237-243` currently builds:

```
const nextAction =
  `On your next native Edit / Write / MultiEdit call against ${fileList}, ` +
  `the deny-raw-edit hook will resolve this declaration automatically (no ` +
  `extra parameters needed). The declaration covers ${nFiles} ${fileNoun} ` +
  `and expires at ${grant.expires_at}.` +
  batchNote +
  `\n\n${declarationReminder}`;
```

New shape:

```
const nextAction =
  `${declarationReminder}` +
  `\n\n(On your next native Edit / Write / MultiEdit against ${fileList}, ` +
  `the deny-raw-edit hook resolves this declaration automatically; ` +
  `expires ${grant.expires_at}.)` +
  batchNote;
```

The housekeeping prose is also tightened (single sentence, parenthesized,
no "no extra parameters needed" — that is now implicit and already
documented in the reminder phase line).

**Typed_edit kind for the reorder (per Codex review F7).** This is not
`edit_cosmetic` — the bytes carry load-bearing agent-behavior guidance,
not whitespace / formatter output / information-invariant comments. It
is also weaker as `edit_explanation` (which describes shipped reader-
facing behavior without prescribing a policy boundary). The correct
kind is `edit_policy_change` — the change alters how the server
communicates obligations to the agent on every successful declaration,
and the description language for `edit_policy_change`'s policy-shape
boundary matches this intent. The implementation plan's Phase F pins
the kind to `edit_policy_change` and the prior "alternative kind to
consider" hedge is removed.

## 8. Out of scope (this branch)

- Tightening `target: "prod"` provenance cells (D7). Future work, gated
  on observing whether prod-side test-tautology shows up as a real
  pattern in audit logs.
- Detecting impl-derived tests from diff content (Article 7 — explicitly
  out of MVP). The matrix audits the declared trio, not the test
  contents.
- Per-kind `edit_cosmetic` test-side obligations (D6). Cosmetic edits
  to test files do not pin behavior either.
- New typed tools (rename / extract / dead-code-removal). These remain
  stop-and-ask cases.

## 9. Decision log

| date | decision | who |
|---|---|---|
| 2026-05-24 | D1–D12 above | user + agent in conversation |
| 2026-05-24 | Codex adversarial review run (agent a3459db88fd368307); verdict: needs revision (4 HIGH, 3 MEDIUM, 2 LOW). Findings F2 (workflow-target guard), F3 (3 load-bearing sentences preserved), F4 (SPEC pair-ordering elsewhere), F5 (spec-defined definition + softer db/migration), F7 (Phase F kind = edit_policy_change), F10 (honest reader-version compat) addressed in this design.md by edits 2026-05-24 edit_20260524_0003 through 0010. F6 (phase reorder) and F8 (Phase D sub-batching) to be addressed in implementation-plan.md. | Codex review + agent revisions |
| 2026-05-24 | D13: per-kind reminder wording is SQLite-anchored — lifted from the relevant section of https://sqlite.org/testing.html for each impl kind, replacing the §6.1 generic-"spec-defined" placeholders. SQLite section mapping subagent (a948355981a933afc) producing per-kind anchor text. | user fiat |
| 2026-05-24 | D14: single bundled v0.8.0 PR carrying all seven phases (A→B→C→E→D→F→G). No Phase F split. | user fiat |
| 2026-05-24 | D15: SQLite section meta-citations (e.g. `(§4.3)`, `§5.1.1 retention`, `§3.4 compound case`) retained ONLY in this design.md for traceability; stripped from runtime reminder text in `src/reminders/context.ts`. Phase E acceptance gate is a grep against the runtime file. | user fiat |
| TBD | Project-owner sign-off on revised design (post-SQLite-anchor rewrite + D15 strip rule) | (pending) |

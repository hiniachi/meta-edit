# Design: `execution_state` declaration field

- **Status:** Draft — revised after Codex + Claude design review and after the
  implementation-plan review (2026-05-23); pending project-owner sign-off
- **Created:** 2026-05-22 — **Revised:** 2026-05-23
- **Branch context:** `codex-reminder-context`
- **Target version:** 0.7.0 (minor)
- **Change class:** `edit_policy_change` (touches SPEC, tool descriptions, request schema, grant/log metadata)

---

## 1. Problem

An AI coding agent that hits a failing test tends to fall into a
"fix → fail → fix → fail" spiral. Each iteration is another blind
implementation edit; the agent does not pause to separate the
reproduction conditions, the recent changes, and the competing
hypotheses. The spiral is self-sustaining precisely because the agent
does not notice it is in one.

meta-edit already shapes the *kind* of an edit (21 typed tools) and its
*epistemic source* (`provenance`). It does not yet give the agent a
place to declare the *state of its own work loop*. This design adds
that axis.

## 2. Constitutional fit

This is a **declaration**, not **detection**. The agent self-declares
its execution state exactly as it self-declares `provenance`; the
server stores and trusts the value and never infers it. Therefore:

- Not Article 7 detection / classification / verification.
- `provenance` (v0.6.0) is the direct precedent: a required,
  self-declared, server-unverified introspective enum on all 21 tools.
- Article 2's bet applies unchanged — forcing the agent to classify a
  thing at edit-formation time is the intervention.

**Known asymmetry with `provenance` (honest limitation).** `provenance`
asks a question the agent answers well at edit time ("where did this
come from?" — it just did the reasoning). `execution_state` asks a
question whose answer quality is *lowest exactly when it matters* — an
agent deep in a spiral is, by definition, not noticing the spiral. The
mechanism therefore fires most reliably for agents that need it least.
This limitation is accepted by design; §6 is honest about what the
edit log can and cannot prove about it, and the OBSERVED-FAILURES
entry (§5) queues the v0.2 fallback with a concrete promotion trigger.

## 3. Decisions taken in this brainstorming session

| #  | Question | Decision |
|----|----------|----------|
| Q1 | How to handle "the spiraling agent won't self-declare"? | Add a declared field, `provenance`-style. **Not** a server-side cadence detector, **not** description-only. |
| Q2 | State set | Three states: `normal` / `repeating_failure` / `recovery`. `uncertain` (overlaps `provenance: speculation\|inference`) and `review_blocked` (review-orchestration, outside meta-edit's axis) excluded. |
| Q3 | How does the server treat a `repeating_failure` edit? | `soft + audit warn`. Never rejects. `repeating_failure × impl tool` records an audit warning; `repeating_failure × edit_observation\|edit_proposal` is clean. Hard reject was rejected: it would punish honest declaration and incentivize under-declaration (Article 3 — the lazy agent routes around friction). |
| Q4 | Where does the escape procedure live? | Scope B — the reminder carries a short ordered cue, **and** `edit_observation`'s §4 description gains a fuller paragraph. (Scope A, not chosen, was the common `Execution state` block only, with the escape procedure living solely in the reminder; Scope B additionally adds an escape paragraph to `edit_observation`'s description.) |

## 4. Design

### 4.1 Schema — `EditToolRequest`

New required field on all 21 tools:

```typescript
execution_state: "normal" | "repeating_failure" | "recovery";
```

Strict, **no default** (same posture as `provenance`).

**The no-default tradeoff (accepted).** `normal` is the value on the
large majority of calls, so a required-no-default field is a small
ceremony tax on every edit. A default would remove the tax — but it
would also remove the forcing function: the lazy agent would never set
the field, and "force the question at edit-formation time" (Article 2's
bet) would evaporate. Typing `execution_state: "normal"` *is* the
micro-checkpoint ("am I actually normal right now?"). The tax is the
cost of the bet and is accepted.

**`execution_state` is declaration-level.** A workflow-axis declaration
may bind multiple files via `additional_files` (SPEC Article 6). The
single `execution_state` value applies uniformly to every file in the
batch — a batched escape `edit_observation` over eight files is one
`repeating_failure` declaration, not eight. The
`execution_state_repeating_failure` warning and `additional_files_warn`
never co-occur on one declaration: the former fires only on impl tools
(a fix attempt) and the latter only on workflow tools. A batched
workflow declaration in `repeating_failure` therefore simply records
`execution_state` for the whole batch and produces no
`execution_state_repeating_failure` warning.

### 4.1.1 `execution_state` lifecycle (resolves review H1 / H2)

The three states form one lifecycle. This is the normative text the
per-tool `Execution state (required):` description block (§4.7) is
derived from — without it, the description block cannot be written.

```
normal
  │  the agent self-judges that it is repeating the same class of
  │  failure (>= 2 unresolved fix attempts at one failure). No server
  │  counting — this is a self-judgement, like every other declaration.
  ▼
repeating_failure
  │  declared on the edit_observation (or edit_proposal) that records
  │  the failure — the clean escape. If instead declared on another
  │  impl fix attempt, that is the warn cell (§4.2).
  │  exit: the failure is recorded and a single hypothesis is isolated.
  ▼
recovery
  │  declared on the deliberate, hypothesis-driven diagnostic edits
  │  that follow. Steps are kept small and reversible.
  │  exit: the failure is resolved for the understood reason.
  ▼
normal
```

Per-state operational definition:

- **`normal`** — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- **`repeating_failure`** — "I have noticed I am repeating the same
  class of failure." Declare it the moment the loop is recognized. The
  intended move is to declare it on an `edit_observation` (or
  `edit_proposal`) that records the failure — that is the clean escape.
  Declaring it on another impl fix attempt is the `warn` cell: the
  reminder will redirect.
- **`recovery`** — "I have recorded the failure and isolated a single
  hypothesis; I am now making deliberate, hypothesis-driven diagnostic
  edits." Entry: after the escape observation, once exactly one
  hypothesis is in hand. Exit: when the failure is resolved for the
  understood reason — return to `normal`.

**Skip rules.** `recovery` may be skipped if the escape observation
immediately resolves the failure (declare the resolving edit `normal`).
`repeating_failure` is never skipped on the path into `recovery` — an
agent cannot be in `recovery` without having first recognized the loop.

### 4.2 `(kind × execution_state)` audit matrix — new SPEC §3.4

Same `OK` / `warn` / `REJ` vocabulary as §3.3. **No `REJ` cell** —
`soft` per Q3.

```
                                       normal   repeating_failure   recovery
15 SQLite-derived impl + edit_cosmetic    OK           warn             OK
edit_observation                          OK           OK               OK
edit_proposal                             OK           OK               OK
edit_progress                             OK           OK               OK
edit_decision                             OK           OK               OK
edit_explanation                          OK           OK               OK
```

The single `warn` group is the 16 impl tools × `repeating_failure` — an
impl tool is a *fix attempt*, and stacking another fix while the loop
is acknowledged is the thing to flag. A `warn` records a typed
`AuditWarning` (code `execution_state_repeating_failure`) into the edit
log's existing `audit_warnings` field and never blocks the declaration.

**The escape set is `{edit_observation, edit_proposal}`** — the two
recommended moves out of the loop (record the failure / raise a
hypothesis or open question). `repeating_failure × {escape set}` is
deliberately clean. The other three workflow kinds (`edit_progress`,
`edit_decision`, `edit_explanation`) are clean under `repeating_failure`
simply because they are not fix attempts — not because they are escape
moves.

`recovery` is a sanctioned state and is clean in every cell.

**Warn semantics are distinct from §3.3.** The §3.3 warnings
(`kind_provenance_warn`, `additional_files_warn`,
`citation_lint_missing`) all describe a *mismatch* — the declaration's
pieces do not cohere. `execution_state_repeating_failure` is different:
a correctly-formed declaration that is a *self-flagged loop signal*.
Both ride the same `audit_warnings` field, but consumers (e.g. a future
`meta-edit summary` warnings breakdown) MUST group by warning *code*,
not pool a single warn count across the two meanings.

### 4.3 Reminder content — `buildReminderContext`

The reminder branches on `execution_state` (and `kind`) and rides two
existing surfaces:

- `next_action` — declaration result, read **before** the native write.
  Carries the full corrective ordered procedure for
  `repeating_failure × impl` and the supportive text for the other
  cases.
- `additionalContext` — deny-raw-edit hook allow, delivered **after**
  the write is gated (v0.6.2 "next-reasoning-step context"). For
  `repeating_failure × impl` it carries a brief *post-hoc* variant —
  "this fix landed while repeating_failure was declared; if the escape
  procedure has not run yet, run it before the next edit instead of
  stacking another fix." For the escape and `recovery` cases it reuses
  the supportive text. For `normal` it adds nothing.

`normal` adds **no** execution_state-specific text on either surface
(noise avoidance). `repeating_failure` on `edit_progress` /
`edit_decision` / `edit_explanation` also adds no text — those kinds
are neither a fix attempt to correct nor the escape move to support.

Reminder text **ships in English** (CLAUDE.md "English only for MVP";
consistency with the v0.6.2 reminders). The Japanese wording used
during brainstorming was for discussion only.

`repeating_failure` is the one state whose `next_action` reminder is a
short *ordered procedure* rather than a one-line cue — justified
because it is the single state where a one-liner is most likely to be
ignored. **The corrective reminder is capped at the four ordered steps
shown below; it must not grow during description-sync.**

**`repeating_failure` × impl tool — corrective, ordered (`next_action`):**

> meta-edit reminder: I was about to keep implementing while repeating
> the same kind of failure. Before stacking another fix I should run the
> escape procedure — (1) record it with edit_observation: write
> reproduction conditions, recent changes, and competing hypotheses as
> separate items; (2) re-read the error message literally and check my
> assumptions against primary sources (official documentation, the
> actual source, execution logs); (3) narrow to a single hypothesis and
> verify it with a minimal reproduction; (4) only then decide the next
> move.

**`repeating_failure` × `edit_observation` / `edit_proposal` — supportive:**

> meta-edit reminder: I have acknowledged repeating_failure and I am
> recording it — this is the right move. Write reproduction conditions,
> recent changes, and competing hypotheses as three separate items.
> Ground each hypothesis by checking my assumptions against primary
> sources before forming it, and do not return to implementation fixes
> until a single hypothesis is isolated.

**`recovery` × any — supportive:**

> meta-edit reminder: I am in recovery — a deliberate diagnosis mode
> entered after recognizing a failure. Verify assumptions against
> primary sources (official documentation, etc.), confirm a single
> hypothesis, and make the next fix only then. Keep steps small and
> reversible. Return to normal once the failure is resolved.

"Primary sources" is deliberately generic (not "use Context7" or any
named tool): meta-edit ships to environments without any particular
docs tool, and a repeating failure can stem from a wrong assumption
about a library API, about one's own code, or about the environment —
the common cure is confronting the assumption with primary evidence, of
which official documentation is the most typical example.

### 4.4 `edit_observation` description addition (Scope B)

`edit_observation`'s §4 description gains one paragraph: it is the tool
to reach for first when escaping a `repeating_failure` spiral — record
reproduction conditions / recent changes / competing hypotheses as
separate items, and verify assumptions against primary sources before
forming the next hypothesis. This is read at tool-selection time, so
the guidance lands at the moment of choice. Copied verbatim to
`src/tools/descriptions.ts` per CLAUDE.md §4.

**Provenance steering for the escape.** The escape `edit_observation`
should be declared with `provenance: direct_observation`: the
reproduction conditions and recent changes *are* directly observed, and
the competing hypotheses are framed as hedged prose inside that
declaration. This keeps the escape in `edit_observation`'s `OK◎` cell
and avoids a `kind_provenance_warn` (which `edit_observation + inference`
would otherwise produce per SPEC §3.3.1) — so the escape advertised as
"deliberately clean" (§4.2) is clean on the provenance axis too, not
only on the execution_state axis. The `edit_observation` description
paragraph states this steering explicitly.

### 4.5 Grant metadata + edit log

- Grant files persist `execution_state` alongside `kind` / `target` /
  `provenance` (optional on read; older grants still validate **and
  consume**), so the deny-raw-edit hook's `write_allowed` reminder can
  branch on it (§4.3).
- `EditLogEntrySchema` gains `execution_state`. The schema stays
  non-strict; entries written before 0.7.0 lack the field and still
  validate. The `meta-edit summary` "By execution state" breakdown
  buckets such entries under a **distinct** label, `(pre-0.7.0)` — *not*
  `unspecified`, which SPEC §6 already reserves for the `provenance`
  backfill bucket. Reusing one label across two axes would put two
  unrelated `unspecified` rows in the summary with no way to tell the
  cohorts apart.
- `audit_warnings` may carry the `execution_state_repeating_failure`
  code (distinct semantics — see §4.2).

### 4.6 CLI parity (mirrors `provenance`, v0.6.0)

- `meta-edit log --execution-state <val>` — filter; single and
  comma-separated values, parity with `--provenance`.
- `meta-edit summary` — a "By execution state" breakdown, parity with
  the "By provenance:" breakdown; pre-0.7.0 entries bucket under
  `(pre-0.7.0)` (§4.5).
- `execution_state` joins the compact `EditToolResult.summary`
  first-field string (SPEC §3), parity with the existing
  `provenance=` token — e.g.
  `edit_boundary_condition declared: src/foo.ts target=prod
  provenance=direct_observation execution_state=normal bindings=1`.

### 4.7 SPEC / descriptions sync (CLAUDE.md §4)

- **Article 4** — a descriptive paragraph introducing the
  `execution_state` axis (parity with the `provenance` paragraph).
  Article 4 body text *is* edited — exactly as it was when `provenance`
  was introduced — but the change does **not** trigger the Article 7 /
  scope-expansion amendment bar: a self-declared field is within
  Articles 1–2 and is not on Article 7's forbidden list. The Article 4
  edit routes through `edit_policy_change` like every other change in
  this work.
- **§3** — type block + an argument-validation rule (presence required
  on every declaration).
- **§3.4** — the matrix in §4.2.
- **§3 token issuance** — grant metadata gains `execution_state`.
- **§4** — every one of the 21 tool descriptions gains an
  `Execution state (required):` block derived from §4.1.1, copied
  verbatim into `src/tools/descriptions.ts`; `edit_observation`
  additionally gains the §4.4 paragraph.
- **§6** — edit-log schema + the `audit_warnings` code + the
  `(pre-0.7.0)` summary bucket.

### 4.8 Version

0.6.3 → **0.7.0** (minor — new required field + surface schema change;
same grade as v0.6.0's `provenance` introduction).

## 5. Explicitly out of scope

- **No detection.** The server never infers `execution_state`; it does
  not count consecutive same-file edits. Pure declaration.
- **No `REJ`.** `execution_state` never blocks an edit.
- **`uncertain` and `review_blocked` are deferred.** `uncertain`
  overlaps `provenance: speculation|inference`; `review_blocked` is
  review-orchestration, outside meta-edit's axis. Either may be promoted
  later from an OBSERVED-FAILURES entry if dogfooding shows the need.
- **No opencode-specific work.** Reminders ride the v0.6.2 / v0.6.3
  surfaces (`next_action`; `additionalContext` → opencode
  `tool.execute.after` bridge) unchanged.
- **OBSERVED-FAILURES.md entry — the under-declaration cadence-counter,
  with a concrete promotion trigger.** A new entry records the
  under-declaration risk and queues the v0.2 fallback. Per
  `OBSERVED-FAILURES.md`'s own preamble, a v0.2 candidate is promoted on
  *observed misuse*, not theoretical absence — so the trigger is **not**
  a bare low `repeating_failure` count (which is ambiguous; see §6).
  The promotion triggers, in the established `OBSERVED-FAILURES.md`
  style, are:
  1. **Review signal** — code reviews on AI-produced PRs repeatedly
     find a fix → fail → fix loop in the session transcript where
     `repeating_failure` was never declared.
  2. **User-report signal** — the project owner reports observing an
     undeclared spiral during dogfooding.
  When either fires, the promotion is the cadence-counter backstop
  rejected in Q1: count consecutive same-file impl declarations from
  the edit log and prompt. That remains a v0.2 / classifier-class
  change, not MVP.

## 6. Falsifiability (Article 2) — and its honest limits

`execution_state` is a measurement channel, but a partial one. From the
edit log:

- **Primary signal — is `repeating_failure` ever declared at all?**
  This is the load-bearing metric, and it is **ambiguous on its own**:
  a near-zero count cannot distinguish "no spirals occurred" from
  "spirals occurred but were not declared." That ambiguity is exactly
  why the §5 under-declaration trigger relies on a review / transcript
  signal rather than on the count.
- **Secondary, conditional on the primary being non-zero** — the ratio
  of `repeating_failure × impl` (warn) to `repeating_failure ×
  {escape set}` (`edit_observation` *or* `edit_proposal`): does
  declaring the state actually redirect the next action? Metrics are
  **declaration-counted** — a batched escape observation is one
  declaration regardless of how many files it binds (§4.1).
- **Secondary, conditional** — whether a `repeating_failure`
  declaration is followed by `recovery` then `normal` (loop resolved)
  or by more `repeating_failure × impl` (loop continues).

The honest position: the edit log proves the *secondary* questions only
when the field is used at all, and it cannot by itself prove the field
is *under*-used. The §5 review / user-report trigger is the real
falsifier for the §2 honesty concern.

## 7. Known limitations / risks

- **Honesty / bootstrapping (see §2).** Accepted; §6 is explicit about
  what the edit log can and cannot show, and §5 gives the real
  promotion trigger.
- **`normal` ceremony tax (see §4.1).** Accepted as the cost of the
  forcing function.
- **Reminder length.** The `repeating_failure` corrective reminder is
  longer than the v0.6.2 one-line-cue norm; this is a deliberate,
  scoped exception, capped at the four ordered steps (§4.3).

## 8. Migration / breaking change

`execution_state` is required with no default, so any `edit_*`-aware
caller that omits it gets a schema rejection on the first 0.7.0
session. This is the same immediate-migration posture as v0.5.0 and
v0.6.0 (no warn-then-deny window); self-application is the dominant
caller, so the cost is acceptable.

## 9. Test plan

- `src/tools/common.test.ts` — schema requires `execution_state`; the
  §3.4 matrix (`repeating_failure × impl` → warn,
  `× edit_observation|edit_proposal` → clean, `recovery` / `normal` →
  clean everywhere, missing field → reject); `execution_state` is
  recorded on a **batched** workflow-axis declaration (`additional_files`
  present) for the whole batch, and a workflow declaration in
  `repeating_failure` produces **no** `execution_state_repeating_failure`
  warning (that warning is impl-only).
- `src/reminders/context.test.ts` — the three reminder modes on both
  surfaces (`next_action` corrective ordered procedure / supportive;
  `additionalContext` post-hoc variant for `repeating_failure × impl`);
  `normal` adds no execution_state text, and so does `repeating_failure`
  on `edit_progress` / `edit_decision` / `edit_explanation`; the
  corrective reminder contains the four ordered steps and the "primary
  sources" phrase.
- `src/state/grants.test.ts` — `execution_state` round-trips through
  grant issue / lookup; **a pre-0.7.0 grant lacking the field still
  validates and consumes** (asserted at the hook level — see below).
- `src/state/edit-log.test.ts` — the field persists; pre-0.7.0 entries
  without it still validate and bucket under `(pre-0.7.0)`.
- `src/hooks/raw-edit-policy.test.ts` — the `write_allowed` (allow-time)
  `additionalContext` reminder branches on `execution_state` for
  `repeating_failure × impl`; and a grant whose declaration omits
  `execution_state` still consumes successfully.
- `src/opencode/plugin.test.ts` — the `execution_state` reminder reaches
  the opencode `tool.execute.after` appended tool result.
- `src/cli/log-cmd.test.ts` / `src/cli/summary-cmd.test.ts` —
  `--execution-state` filter parsing + behavior; the summary breakdown
  including the `(pre-0.7.0)` bucket.
- `src/tools/registry.test.ts` — every description carries the
  `Execution state (required):` block; `edit_observation` carries the
  escape paragraph; both MCP input schemas require `execution_state`.
- `src/tools/descriptions.test.ts` — `edit_observation` carries the
  escape paragraph.

## 10. Decision log

- **2026-05-22** — Brainstorming session. Q1–Q4 decided as in §3.
  Design approved section-by-section by the project owner. Initial
  document written via `edit_proposal` (`edit_20260522_0023`).
- **2026-05-23** — Design reviewed by Codex (subagent
  `af2a19d5c20beb2d8`) and Claude (subagent `a70bda6127a3023e5`) at the
  project owner's request. Both: constitutionally sound, no CRITICAL.
  Consolidated findings — `recovery` underspecified (Codex H2 / Claude
  H1), falsifiability overclaim (Codex H1 / Claude M1), `additional_files`
  batch interaction (Claude H2 / Codex M2), escape-set vs metric
  mismatch (Codex M1 / Claude M2), grant→reminder wording + tests
  (Codex M3 / Claude M3+M4), bucket-label collision (Claude H3),
  warn-semantics conflation (Claude H4), §4.7 wording (Codex L1 /
  Claude M5), plus Claude L1–L4. The project owner confirmed the §4.1.1
  `recovery` lifecycle. The first revision addressed all of the above.
- **2026-05-23** — Implementation plan (`implementation-plan.md`)
  drafted and reviewed by Codex (subagent `a176707e94b0c6613`) and
  Claude (subagent `ab0ff7256999c3901`). The plan review surfaced one
  contradiction in *this* design (Claude L4): §4.1 and §9 claimed the
  `execution_state_repeating_failure` warning "composes with
  `additional_files_warn`", which is impossible — the former fires only
  on impl tools, the latter only on workflow tools, so the two never
  co-occur on one declaration. §4.1 and §9 are corrected here, and the
  §4.6 heading wording aligned to "By execution state". The plan was
  revised separately. Next step: `writing-plans` execution →
  implementation.

# Spec-derivation matrix + description slim + reminder relocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a (kind × target × provenance) test-obligation matrix to SPEC §3.3.5 + the validator, slim the 16 impl tool descriptions, relocate per-target obligations into the reminder as `kindObligationsLine`, and reorder `next_action` so the reminder leads and housekeeping trails.

**Source of truth:** `docs/plan/spec-derivation-matrix/design.md` (decisions D1–D12). This plan implements that design exactly.

**Target version:** 0.8.0 (minor — additive matrix dimension, additive AuditWarning code, no schema breaking).

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Bun (`bun test` / `bun run typecheck` / `bun run build`), zod, MCP SDK.

**Conventions** (anchored to codebase state 2026-05-24):

- Real fixture helpers: `modifyReq` / `workflowReq` / `modifyRequest` / `makeHandler()` / `issued` / `consumed` / `rejected` / `makeTmpRoot` / `cleanTmpRoot` / `writeFileIn` / `sha256Hex` / `HEX64_A` — see `docs/plan/execution-state-declaration/implementation-plan.md` Conventions section for the authoritative list.
- Handler invocation: two-arg `await handler(toolName, args)`.
- `src/tools/apply.test.ts` does **not** exist. `apply.ts` is tested by `src/tools/handler.test.ts`.
- Test runner: `bun test <path>` for a single file; `bun test` for the suite.
- `src/version.ts` derives `VERSION` from `package.json` — bump `package.json` only.

**Line numbers** below are from the codebase map dated 2026-05-24 (verified by the 3-agent impact survey on the same day). Anchor every edit to the **named symbol or quoted code**, and re-verify the line against `HEAD` before editing — line numbers drift.

**Self-application note:** This repo edits itself through its own typed tools (CLAUDE.md §6). Every implementation edit is a `typed_edit` declaration + native write. The kind for each file is named per-phase below. A prod edit and its test edit are two declarations of the same tool (`target: "prod"` then `target: "test"`); test-first ordering is allowed (red-first TDD).

---

## File Structure

**Modified (no new source files):**

| File | Responsibility for this change |
|------|--------------------------------|
| `docs/SPEC.md` | New §3.3.5 (kind × target × provenance) matrix; slim §4 verbatim mirror of `descriptions.ts` |
| `src/tools/common.ts` | `evaluateTargetSpecDerivation()`; new `AuditWarning.code = "target_spec_derivation_warn"`; `1e` block in `validateRequest` |
| `src/state/edit-log.ts` | Add `"target_spec_derivation_warn"` to `AuditWarningEntrySchema` enum |
| `src/tools/descriptions.ts` | Slim 16 impl tool descriptions: remove genealogical prose, remove `Required tests` body, order-independent `Target (required)` block, insert spec-derivation framing line |
| `src/reminders/context.ts` | New `kindObligationsLine` builder + `KIND_TARGET_OBLIGATIONS` table; insertion into `buildReminderContext`'s `lines` between `kindCueLine` and `provenanceLine` |
| `src/tools/apply.ts` | Reorder `next_action`: reminder first, housekeeping last (parenthesized single sentence) |
| `src/tools/common.test.ts` | Cell tests for `evaluateTargetSpecDerivation` (15 kinds × 5 provenances × 2 targets); integration test in `validateRequest` |
| `src/reminders/context.test.ts` | Per-kind × per-target obligation text presence; `target_spec_derivation_warn` rendering |
| `src/tools/handler.test.ts` | `next_action` shape assertions (resilient via `.toContain()`, but verify reorder did not regress existing assertions) |
| `IMPLEMENTATION-LOG.md` | Phase entry: "Phase N: spec-derivation matrix (v0.8.0)" |
| `CHANGELOG.md` | v0.8.0 entry |
| `package.json` | version bump 0.7.0 → 0.8.0 |

**Created:**

| File | Purpose |
|------|---------|
| `docs/plan/spec-derivation-matrix/design.md` | (already created) |
| `docs/plan/spec-derivation-matrix/implementation-plan.md` | (this file) |

---

## Phase ordering rationale

Phases are ordered so each completes RED→GREEN before the next starts, and so the validator is in place before the description / reminder text references it. **Order revised per Codex review F6 (observed 2026-05-24):** Phase E (reminder kindObligationsLine implementation) MUST land before Phase D (description slim), otherwise the slim descriptions point at obligations that have not yet been moved into the reminder. The transient hole would leave the descriptions in a broken state mid-branch.

A. **SPEC text first** — design.md decisions land in normative form. SPEC.md §4 is *not* slimmed in this phase (the description rewrite in Phase D is paired with §4 rewrite per CLAUDE.md §4 "verbatim"). This phase also propagates the order-independent target framing to higher-level SPEC paragraphs outside §4 (per design §5.3 / Codex F4).
B. **AuditWarning union extension** — code added to `common.ts` union and `edit-log.ts` enum. Tiny, mechanical, unblocks Phase C.
C. **Validator function + integration** — `evaluateTargetSpecDerivation` + `validateRequest` block. Cell tests + integration tests. RED→GREEN.
E. **Reminder relocation** — `kindObligationsLine` + table + tests. Largest text-volume phase. **Moved ahead of Phase D so the slim descriptions in D can reference the now-existing reminder paragraphs without a transient stale-pointer state.**
D. **Description slim** — `descriptions.ts` + SPEC.md §4 in lockstep, 16 tools. Mechanical but high-volume. Sub-batched 4 tools × 4 sessions (per Codex F8) to stay below context limits.
F. **`next_action` reorder** — `apply.ts` single string composition; `handler.test.ts` regression check.
G. **Bookkeeping** — IMPLEMENTATION-LOG, CHANGELOG, version bump.

Phases B and C *could* run in parallel sub-agents (independent files); the others are sequential. Phase E must land cleanly (full test suite green) before Phase D begins; mid-Phase-D the description body refers to reminder obligations whose existence is already true.

---

## Phase A: SPEC.md §3.3.5 authoring

**Goal:** Land the matrix in normative SPEC form. No code yet.

**Files:**

- `docs/SPEC.md` (add §3.3.5 after §3.3.4 ends; current §3.4 stays in place after the new section)

**Concrete steps:**

- [ ] A.1 Read `docs/SPEC.md:685-694` (the §3.3.4 citation-lint block) to identify the exact insertion point — directly after §3.3.4 closes, before §3.4 (`### 3.4. Kind × execution_state ...`) at line 695.
- [ ] A.2 Declare `edit_policy_change` with `target_file=docs/SPEC.md`, `target="prod"`, `provenance=user_confirmed`, `test_files=["src/tools/common.test.ts"]` (forward-declares the cell tests).
- [ ] A.3 Native Edit to insert §3.3.5 block. Section content draft:
  - Heading: `#### 3.3.5. Kind × target × provenance (test-obligation) matrix (v0.8.0)`
  - Preamble: spec-derivation principle paragraph (from design §1.3 + §4.1).
  - Cell table (`target="test"` row for 15 SQLite-derived impl tools; `target="prod"` defers to §3.3.1; `edit_cosmetic` exempt).
  - Legend: OK / OK◎ / warn / REJ.
  - Per-cell rationale paragraph (from design §4.2).
  - AuditWarning code definition: `target_spec_derivation_warn`.
  - Composition note: order in `validateRequest` (after §3.4, before §3.3.2).
- [ ] A.4 Add cross-reference from §3.3 intro line (`docs/SPEC.md:619-625`) listing §3.3.5 alongside §3.3.1–§3.3.4.
- [ ] A.5 Add cross-reference from §3.4 (`docs/SPEC.md:730-738` "Warn semantics are distinct from §3.3" — list the new code distinct from the existing ones).
- [ ] A.6 **(Codex F4)** Propagate the order-independent target framing to higher-level SPEC sites outside §4. The §4 per-tool blocks are rewritten in Phase D, but the same prod-first language exists elsewhere and must be updated in the same branch to avoid contradicting §4's per-tool framing. Enumerated sites to audit and update:
  - `docs/SPEC.md` §3 (the `target` field narrative around `docs/SPEC.md:559-580`) — any sentence implying the test declaration "follows" or "pairs with" an "earlier" prod declaration.
  - `src/tools/registry.ts:74` — the JSON-schema `description` for `target` (currently embeds "issue two declarations of the same tool: one with target=\"prod\" (test_files forward-declares the test files), then one with target=\"test\""). Rewrite to "issue two declarations of the same tool — one with target=\"prod\" and one with target=\"test\" — in either order (test-first / prod-first); both may land in the same commit."
  - `src/tools/common.ts` near the schema comment for `target` (if a parallel narrative exists; the impact survey did not flag one but spot-check).
  - Declare each propagation as `edit_policy_change target="prod"` (these change agent-facing contractual narrative) with `provenance=accepted_artifact` citing design §5.3 and Codex F4.
- [ ] A.7 `bun run build` to confirm no markdown linter breakage (if a linter is wired; otherwise visual diff).

**Acceptance criteria:**
- §3.3.5 reads as a standalone normative section (no forward references to unmerged code).
- §3.4's "Warn semantics are distinct from §3.3" paragraph mentions the new code by name.
- `grep -n "target_spec_derivation_warn" docs/SPEC.md` returns at least 2 lines (the cell verdict and the §3.4 mention).

---

## Phase B: AuditWarning union extension

**Goal:** Make the new code a typed value before any caller emits it.

**Files:**

- `src/tools/common.ts` (TypeScript union at `~322-330`)
- `src/state/edit-log.ts` (zod enum at `~55-64`)

**Concrete steps:**

- [ ] B.1 Declare `edit_api_contract` for `src/tools/common.ts` with `target="prod"`, `provenance=accepted_artifact` (cites §3.3.5), `test_files=["src/tools/common.test.ts"]`. Justification: the `AuditWarning.code` union is a structural contract consumed by `edit-log.ts`, `apply.ts`, and `reminders/context.ts`.
- [ ] B.2 Native Edit `common.ts:322-330` — add `| "target_spec_derivation_warn"` to the code union.
- [ ] B.3 Declare `edit_api_contract` for `src/state/edit-log.ts` with `target="prod"`, same provenance, same test_files. Justification: zod enum must mirror the TypeScript union; the JSONL contract is the durable boundary.
- [ ] B.4 Native Edit `edit-log.ts:55-64` — add `"target_spec_derivation_warn"` to the enum literal array.
- [ ] B.5 Run `bun run typecheck` — must pass before proceeding to Phase C.

**Acceptance criteria:**
- `bun run typecheck` clean.
- `grep -n "target_spec_derivation_warn" src/tools/common.ts src/state/edit-log.ts` returns exactly 2 lines (one per file).
- `bun test src/state/edit-log.test.ts` still green (no test relied on the closed set).

---

## Phase C: Validator function + integration

**Goal:** New matrix function + integration into `validateRequest`. RED→GREEN.

**Files:**

- `src/tools/common.ts` (define `evaluateTargetSpecDerivation`; integrate as `1e` block)
- `src/tools/common.test.ts` (cell tests + integration tests)

### C.1 RED: cell tests (test-first)

- [ ] C.1.1 Declare `edit_boolean_condition` with `target="test"`, `provenance=accepted_artifact` (cites design §4.1, §4.2), `target_file=src/tools/common.test.ts`, `test_files=[]`.
- [ ] C.1.2 Native Edit: add a new `describe("evaluateTargetSpecDerivation (SPEC §3.3.5)")` block at `common.test.ts:~777` (right after the `evaluateKindExecutionStateValidity` block per the impact survey).
- [ ] C.1.3 Test cases (15 impl kinds × 2 targets × 5 provenances = 150 cells; group by verdict for compactness):
  - `it.each([...impl kinds]) ("returns 'accept' for target=prod regardless of provenance", ...)` — 15 × 5 = 75 cells, all accept.
  - `it.each([...impl kinds, ...provenance pairs])` for target=test cells:
    - `accept`: kind × `{user_confirmed, accepted_artifact}` — 15 × 2 = 30 cells.
    - `warn`: kind × `direct_observation` — 15 cells.
    - `reject`: kind × `{inference, speculation}` — 15 × 2 = 30 cells.
  - `edit_cosmetic` exemption: every (target, provenance) returns `accept` — 2 × 5 = 10 cells. (Carve-out parallels §3.3.3.)
- [ ] C.1.4 `bun test src/tools/common.test.ts -t "evaluateTargetSpecDerivation"` — expect ALL to fail (function does not exist).

### C.2 GREEN: implement `evaluateTargetSpecDerivation`

- [ ] C.2.1 Declare `edit_boolean_condition` with `target="prod"`, `provenance=accepted_artifact` (cites §3.3.5), `test_files=["src/tools/common.test.ts"]`.
- [ ] C.2.2 Native Edit at `common.ts:~215` (right after `evaluateKindExecutionStateValidity` closes per impact survey):
  ```typescript
  /**
   * §3.3.5 — (kind, target, provenance) test-obligation matrix.
   * Called only when target is declared (impl tools only).
   *
   *                              u_c    a_a    d_o    inf    spec
   * target="test", 15 SQLite     OK     OK     warn   REJ    REJ
   * target="test", edit_cosmetic OK     OK     OK     OK     OK  (carve-out)
   * target="prod", any kind      OK across the board
   */
  export function evaluateTargetSpecDerivation(
    kind: ToolName,
    target: EditTarget,
    provenance: Provenance,
  ): MatrixVerdict {
    if (target === "prod") return "accept";
    if (kind === "edit_cosmetic") return "accept";
    if (provenance === "inference" || provenance === "speculation") {
      return "reject";
    }
    if (provenance === "direct_observation") return "warn";
    return "accept";
  }
  ```
- [ ] C.2.3 `bun test src/tools/common.test.ts -t "evaluateTargetSpecDerivation"` — expect ALL green.

### C.3 RED: validateRequest integration tests

- [ ] C.3.1 Declare `edit_boolean_condition` with `target="test"`, `provenance=accepted_artifact`, `target_file=src/tools/common.test.ts`, `test_files=[]`.
- [ ] C.3.2 Native Edit: add integration cases into the existing `describe("validateRequest — kind × provenance integration")` block (or a new sibling block — match local convention):
  - `target="test"` + `direct_observation` + any impl kind → `auditWarnings` contains `{ code: "target_spec_derivation_warn", message: ... }`, declaration succeeds.
  - `target="test"` + `inference` + any impl kind → `warnings` non-empty, `auditWarnings` may also carry the warn, declaration rejected.
  - `target="test"` + `speculation` + any impl kind → declaration rejected.
  - `target="prod"` + same provenances + any impl kind → no `target_spec_derivation_warn`.
  - `edit_cosmetic` + `target="test"` + `direct_observation` → no `target_spec_derivation_warn` (carve-out).
- [ ] C.3.3 `bun test src/tools/common.test.ts` — expect new integration cases to fail (matrix not wired into `validateRequest`).

### C.4 GREEN: wire matrix into validateRequest

- [ ] C.4.1 Declare `edit_boolean_condition` with `target="prod"`, `provenance=accepted_artifact`, `test_files=["src/tools/common.test.ts"]`.
- [ ] C.4.2 Native Edit `common.ts:~505` (right after the `1d` execution_state block per impact survey). **Per Codex review F2 (2026-05-24): the gate is `TOOLS_REQUIRING_TARGET.includes(toolName)`, NOT `request.target !== undefined`. The schema-layer split prevents workflow kinds from carrying target today; this guard is defense-in-depth so a future schema regression cannot silently widen §3.3.5's scope.**
  ```typescript
  // 1e. §3.3.5 — kind × target × provenance test-obligation matrix.
  // Defense-in-depth: gate on the impl-tools allow-list, not on
  // request.target presence — see SPEC §3.3.5 workflow-target guard note.
  if (
    TOOLS_REQUIRING_TARGET.includes(toolName) &&
    request.target !== undefined
  ) {
    const verdict = evaluateTargetSpecDerivation(
      toolName,
      request.target,
      request.provenance,
    );
    if (verdict === "reject") {
      warnings.push(
        `target_spec_derivation rejected: ${toolName} × target="${request.target}" × provenance="${request.provenance}" (see SPEC §3.3.5)`,
      );
    } else if (verdict === "warn") {
      auditWarnings.push({
        code: "target_spec_derivation_warn",
        message: `target="test" with provenance="${request.provenance}": the test pins implementation-observed behavior, not spec-defined behavior. Confirm the observation source is external (e.g. third-party API) or re-classify provenance.`,
      });
    }
  }
  ```
- [ ] C.4.3 `bun test src/tools/common.test.ts` — expect all green.

### C.5 Audit log persistence smoke test

- [ ] C.5.1 Declare `edit_boolean_condition` with `target="test"`, same provenance, `test_files=[]`, `target_file=src/state/edit-log.test.ts`.
- [ ] C.5.2 Native Edit: extend an existing round-trip test in `edit-log.test.ts` to include an entry with the new code; assert persist + reload round-trips identically.
- [ ] C.5.3 `bun test src/state/edit-log.test.ts` — green.

**Acceptance criteria:**
- `bun test src/tools/common.test.ts` green.
- `bun test src/state/edit-log.test.ts` green.
- `bun run typecheck` clean.
- The new warn code is observable in a round-tripped JSONL entry.

---

## Phase D: Description slim + SPEC §4 mirror

**Goal:** Slim the 16 impl tool descriptions per design §5; mirror in SPEC §4 verbatim (CLAUDE.md §4 invariant).

**Files:**

- `src/tools/descriptions.ts` (16 tools, lines per impl tool ~30-60)
- `docs/SPEC.md` §4 (lines per impl tool, parallel ranges)

**Approach:** One typed declaration per (tool, file) pair. For each impl tool: declare `edit_policy_change` with `target="prod"`, `provenance=accepted_artifact` (cites design §5 + the survey report), `target_file=descriptions.ts`, `test_files=["src/tools/descriptions.test.ts"]`. After landing the description change, declare a second `edit_policy_change` for SPEC.md §4 mirror.

**Sub-batching (Codex review F8, 2026-05-24).** 32 typed_edit declarations in one uninterrupted session is high context-risk. Phase D splits into **4 sub-batches of 4 tools each**, alphabetical. Each sub-batch is a discrete session bracketed by:

1. `git status` at start to confirm the previous sub-batch is committed clean.
2. For each tool in the batch: declare descriptions.ts edit → native Edit → declare SPEC.md §4 edit → native Edit.
3. Run `bun test src/tools/descriptions.test.ts` after each tool to catch malformed JS template literals early.
4. End-of-batch: `bun test` full suite + manual diff parity check (`diff <(extract descriptions.ts tool block) <(extract SPEC.md §4 tool block)`) for each tool in the batch.
5. Commit the sub-batch with message `docs(descriptions): slim batch <N>/<4> — tools <list>`.

**Load-bearing sentences to PRESERVE (design §5.1.1, Codex F3).** The per-tool diff sketch must enumerate these explicitly so the slim does not accidentally drop them:

- `edit_data_migration` description: keep "The idempotency test is the single most important one — write it first." (ordering obligation).
- `edit_external_side_effect` description: keep "If your test makes a real external call, your test is wrong." (test contract prohibition).
- `edit_policy_change` description: keep the entire "Policy changes that LOOSEN restrictions ... 'Convenience' is not an acceptable rationale. If your change loosens a restriction without a strong justification, do not use this tool." block (kind-selection gate).

**Batches:**

| Batch | Session goal | Tools (alphabetical) |
|---|---|---|
| D-1 | Slim batch 1/4 | edit_api_contract, edit_boolean_condition, edit_boundary_condition, edit_cache_invalidation |
| D-2 | Slim batch 2/4 | edit_concurrency, edit_cosmetic, edit_data_migration, edit_db_schema |
| D-3 | Slim batch 3/4 | edit_dependency_config, edit_error_handling, edit_external_side_effect, edit_permission_logic |
| D-4 | Slim batch 4/4 | edit_policy_change, edit_retry_timeout, edit_serialization, edit_state_transition |

**Per-tool notes:**
- `edit_cosmetic` (D-2): only (a) and (c) apply; (d) is the inverse "exempt from spec-derivation" line per design §5.4.
- `edit_data_migration` (D-2): preserve "idempotency test first" sentence; route the duplicate prose into the reminder target=prod paragraph.
- `edit_external_side_effect` (D-3): preserve "real external call is wrong" sentence (description body) AND mirror in reminder target=test paragraph.
- `edit_policy_change` (D-4): preserve the LOOSEN/Convenience block entirely.

**Per-tool concrete steps (template):**

- [ ] D.<n>.1 Declare `edit_policy_change` for `descriptions.ts` with `target_file=src/tools/descriptions.ts`, `target="prod"`, `provenance=accepted_artifact` citing `docs/plan/spec-derivation-matrix/design.md §5` and the specific subsection numbers, `test_files=["src/tools/descriptions.test.ts"]`.
- [ ] D.<n>.2 Native Edit `descriptions.ts:<range>`:
  - Remove the cited genealogical sentences (per design §5.1 and the description-audit survey).
  - Remove the `Required tests (you MUST cover ...)` block; replace with the single pointer line from design §5.2.
  - Rewrite the `Target (required):` block to be order-independent per design §5.3.
  - Insert one spec-derivation framing line just after the 1-line summary per design §5.4 (template + per-kind variant; for `edit_cosmetic`, the inverse "exempt" line).
- [ ] D.<n>.3 Declare `edit_policy_change` for `SPEC.md` with `target="prod"`, same provenance, same citation, `test_files=["src/tools/descriptions.test.ts"]`. Justification: SPEC §4 is the verbatim source of `descriptions.ts` per CLAUDE.md §4; the same edit must propagate.
- [ ] D.<n>.4 Native Edit `SPEC.md:<range>`: mirror the descriptions.ts changes verbatim.
- [ ] D.<n>.5 `bun test src/tools/descriptions.test.ts` — should remain green; the existing test only checks tool descriptions are non-empty strings and present for every kind (per impact survey).

**Cross-cutting acceptance after Phase D:**
- All 16 impl tool descriptions: no `Required tests` block in description body.
- All 16 impl tool descriptions: `Target (required):` block is order-independent (no "earlier" / "the file pointed at by your earlier ..." language).
- All 15 SQLite-derived impl tools: spec-derivation framing line present immediately after summary.
- `edit_cosmetic` has the exempt-from-spec-derivation line.
- `descriptions.ts` text exactly matches SPEC §4 text (manual diff or scripted check).
- `bun test` full suite green.

---

## Phase E: Reminder `kindObligationsLine`

**Goal:** Land the per-kind × per-target obligation paragraphs in `reminders/context.ts` so the description body can stay slim.

**Files:**

- `src/reminders/context.ts` (new function + table; inserted in `buildReminderContext`)
- `src/reminders/context.test.ts` (per-kind × per-target text presence)

### E.1 RED: reminder text tests

- [ ] E.1.1 Declare `edit_explanation` with `target_file=src/reminders/context.test.ts`, `provenance=accepted_artifact` (cites design §6.1), `test_files=[]`. (`edit_explanation` because the reminder text is reader-facing shipped behavior visible at runtime.)
  - Note: `edit_explanation` is a workflow kind and does not take a `target` flag.
- [ ] E.1.2 Native Edit: add a new `describe("kindObligationsLine (SPEC §3.3.5 obligations relocation)")` block:
  - For each of the 15 SQLite-derived impl kinds:
    - `it("prod obligations for <kind> mention <key phrase>", ...)` — assert `buildReminderContext({...target:"prod", kind})` includes a distinctive prod-side phrase (e.g., for `edit_boundary_condition`: `"three boundary cases"`).
    - `it("test obligations for <kind> mention spec-derivation", ...)` — assert the output includes `"spec-defined"` (or equivalent canonical phrase) and the kind-specific concept.
  - `it("edit_cosmetic returns no obligations", ...)` — assert no obligations paragraph for any (target, provenance) combo.
  - `it("workflow kinds return no obligations", ...)` — assert undefined for 5 workflow kinds.
  - `it("renders target_spec_derivation_warn from auditWarnings", ...)` — feed the input with `auditWarnings: [{code: "target_spec_derivation_warn", message: "..."}]` and assert the existing `auditWarningsLine` renders it (no code change there — just confirm).
- [ ] E.1.3 `bun test src/reminders/context.test.ts` — expect new cases to fail.

### E.2 GREEN: implement `kindObligationsLine` + table

- [ ] E.2.1 Declare `edit_explanation` with `target_file=src/reminders/context.ts`, `provenance=accepted_artifact` (cites design §6.1).
- [ ] E.2.2 Native Edit:
  - Add `KIND_TARGET_OBLIGATIONS: Partial<Record<ToolName, { prod: string; test: string }>>` constant with 15 entries (drafts from design §6.1; final wording reviewed in this phase).
  - Add `kindObligationsLine(input: ReminderInput): string | undefined` builder.
  - Insert into `buildReminderContext`'s `lines` array between `kindCueLine` (current `lines[2]`) and `provenanceLine` (current `lines[3]`).
- [ ] E.2.3 `bun test src/reminders/context.test.ts` — expect all green.

**Acceptance criteria:**
- `bun test src/reminders/context.test.ts` green.
- `buildReminderContext` output for a typical impl-tool declaration contains the obligations paragraph between the kind cue and the provenance cue.
- Workflow kinds + `edit_cosmetic` produce no obligations line (graceful absence).
- `bun run typecheck` clean.
- **(User fiat D15, 2026-05-24) No SQLite section meta-citation leaks into runtime text.** The design's §6.1 drafts retain `(§4.3)`, `(§9-style)`, `§5.1.1 retention`, `§3.4 compound case`, and similar markers for traceability; these must be stripped from the strings emitted at runtime. Grep gate:
  ```bash
  # Should return zero matches; any hit means a meta-citation leaked.
  grep -nE '§[0-9]+(\.[0-9]+)*( retention| compound| -style)?' \
    src/reminders/context.ts
  ```
  If the grep returns any line, audit the matched string and rewrite to strip the section marker while preserving the cited concept and vocabulary.

---

## Phase F: `next_action` reorder

**Goal:** Reminder leads, housekeeping trails per design §7.

**Files:**

- `src/tools/apply.ts` (lines 237-243 per impact survey)
- `src/tools/handler.test.ts` (resilient `.toContain()` assertions; verify no regression)

**Concrete steps:**

- [ ] F.1 Declare `edit_policy_change` with `target="prod"`, `provenance=user_confirmed` (the user agreed to this reorder explicitly in conversation), `target_file=src/tools/apply.ts`, `test_files=["src/tools/handler.test.ts"]`. Justification (per Codex review F7, 2026-05-24): the reorder changes how the server communicates obligations to the agent on every successful declaration — agent-behavior policy, not whitespace and not merely reader-facing description. `edit_cosmetic`'s description explicitly excludes "guard clause moved, an import was reorganized" — load-bearing prose reorder is the same class. `edit_explanation` would be weaker; `edit_policy_change` matches the change's intent.
- [ ] F.2 Native Edit `apply.ts:237-243` per design §7's New shape.
- [ ] F.3 `bun test src/tools/handler.test.ts` — verify existing `.toContain()` assertions still pass; if any assertion was order-sensitive, declare a `target="test"` follow-up with a kind matching the assertion's nature and update.
- [ ] F.4 Run a manual smoke test: invoke the meta-edit MCP server, declare any typed_edit, inspect the returned `next_action` — confirm reminder is at the top, housekeeping at the bottom.

**Acceptance criteria:**
- `bun test src/tools/handler.test.ts` green.
- `next_action` output starts with the `meta-edit reminder:` block.
- Housekeeping sentence is one parenthesized line at the end.

---

## Phase G: Bookkeeping

**Goal:** IMPL log entry, CHANGELOG, version bump. Standard meta-edit phase closure.

**Files:**

- `IMPLEMENTATION-LOG.md`
- `CHANGELOG.md`
- `package.json`

**Concrete steps:**

- [ ] G.1 Declare `edit_progress` for `target_file=IMPLEMENTATION-LOG.md`, `provenance=user_confirmed`, `test_files=[]`. Append a phase entry:
  ```
  ## Phase N: spec-derivation matrix (v0.8.0)
  - Completed: <date>
  - What works: §3.3.5 matrix, target_spec_derivation_warn code, slim descriptions, kindObligationsLine, next_action reorder.
  - Known issues: <none / list>.
  - Tests added: <count>.
  - Spec deviations: <none / list>.
  ```
- [ ] G.2 Declare `edit_explanation` for `target_file=CHANGELOG.md`, `provenance=user_confirmed`, `test_files=[]`. Add v0.8.0 section enumerating: new matrix, new audit warning code, slim descriptions, reminder relocation, next_action reorder. Note backward compatibility (additive).
- [ ] G.3 Declare `edit_dependency_config` for `target_file=package.json`, `target="prod"`, `provenance=user_confirmed`, `test_files=["src/version.test.ts"]` if such a test exists; else `[]`. Bump version `0.7.0` → `0.8.0`.
- [ ] G.4 `bun test` full suite — green.
- [ ] G.5 `bun run build` — clean.
- [ ] G.6 Commit. PR title: `feat(v0.8.0): spec-derivation matrix + description slim + next_action reorder`. PR body should link to `docs/plan/spec-derivation-matrix/design.md` and this file.

**Acceptance criteria:**
- Full suite green.
- IMPLEMENTATION-LOG has the phase entry.
- CHANGELOG has the v0.8.0 entry.
- `package.json.version === "0.8.0"`.
- Branch ready for review.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Description text slimming inadvertently changes a load-bearing obligation | Each tool's slim is paired across descriptions.ts and SPEC.md §4 in lockstep; reviewer compares old vs new side-by-side per tool. |
| Reminder paragraph wording mis-frames the obligation | Phase E.1 tests pin distinctive phrases per kind. Codex review of the design §6.1 table catches drift before implementation. |
| Matrix REJ cells block legitimate declarations | `target="test"` × `inference` rejection is intentional (design D2). If post-rollout an agent legitimately needs to test against an inferred spec, that is a SPEC-clarification request, not a matrix loosening. The OBSERVED-FAILURES.md is the right escalation path. |
| AuditWarning code addition breaks pre-v0.8.0 readers | **Honest framing (Codex F10, 2026-05-24):** the zod enum in `edit-log.ts:AuditWarningEntrySchema` is strict. A pre-v0.8.0 reader will reject log lines containing `target_spec_derivation_warn` at parse time — this is NOT "additive backward compatibility", it is a forward-compat-only minor bump. The SPEC §3.3.5 entry MUST document this reader-version break (Phase A.3 sub-step). Downstream consumers (CLI summary scripts, external dashboards) that pin to a specific zod schema version must upgrade in lockstep with the server bump. Older readers see unknown codes as zod parse errors, not as opaque strings, per the impact survey. |
| `next_action` reorder breaks downstream agent parsing | Existing `handler.test.ts` uses `.toContain()` — order-insensitive. Re-run smoke against Claude Code session before merge. |
| edit_cosmetic in Phase F is the wrong kind for the reorder | Listed as a deliberate review question. Decision pinned in Phase G's Codex review pass. |
| Phase D tool ordering accidentally lands an inconsistent intermediate state | Each impl tool's descriptions.ts and SPEC.md §4 edit lands as a pair in two consecutive declarations within the same commit (or two commits in sequence). The test suite (`descriptions.test.ts`) does not enforce text content beyond presence, so intermediate states compile and pass tests. |

---

## Out of scope (this branch)

Per design §8:

- `target="prod"` provenance tightening (defer).
- Diff-content detection of impl-derived tests (Article 7 — never in MVP).
- `edit_cosmetic` test-side obligations.
- New typed tools (rename / extract / dead-code).

---

## Open questions for sign-off

Codex adversarial review (2026-05-24, agent a3459db88fd368307) closed several items. Status table:

| Q | Status | Resolution |
|---|---|---|
| Reminder text wording in design §6.1 — is "spec-defined" the right canonical phrase across all 15 kinds? | **Partially resolved.** Codex F5 clarified the umbrella scope (design §6 now defines it); per-kind nuance for db_schema/data_migration softened. Final per-kind wording polish remains a user fiat call before Phase E. | User fiat at Phase E entry |
| Phase F's typed_edit kind for `apply.ts` reorder | **Resolved.** Codex F7 pins `edit_policy_change`. | Closed — see Phase F.1 |
| Single combined v0.8.0 PR vs. Phase F split into a follow-up | **Resolved.** User fiat 2026-05-24: single bundled v0.8.0 PR carrying all phases (A→B→C→E→D→F→G). Phase F lands in the same PR. | Closed |
| §3.4 "Warn semantics are distinct from §3.3" — explicit clause for the new code? | **Resolved.** Codex review treated A.5 cross-reference as sufficient; the new code's semantics group with the §3.3 mismatch family (not the §3.4 self-flagged loop signal). | Closed — see Phase A.5 |
| Reader-version compat framing | **Resolved.** Codex F10 forced honest framing; design D11 and risk register both updated. | Closed |
| Phase ordering | **Resolved.** Codex F6 forced E-before-D execution order. | Closed |
| Load-bearing sentences in §5.1 deletion list | **Resolved.** Codex F3 carved out 3 sentences to preserve; Phase D sub-batch notes enumerate them. | Closed |

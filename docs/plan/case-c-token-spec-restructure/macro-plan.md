# Case C — Constitutional SPEC restructure (v0.2 design)

Status: **DRAFT — awaiting user review before SPEC.md is touched.**
Origin: issue 1103 (typed `edit_*` as thin Edit wrapper via grant-token) →
brainstorm 2026-05-02 → user-decided "(β) constitutional SPEC at the
head of SPEC.md, derive Part II by trimming".

## 0. Mission of this plan

1. Settle the **constitution** (Part I) so any further specification
   change can be tested against "does this serve an article?"
2. Map current SPEC.md sections into kept / slimmed / absorbed / cut.
3. Define the **single-file token** mechanics precisely enough to
   review without yet writing TypeScript.
4. Hand off to a writing-plan that surgically rewrites SPEC.md and
   `src/tools/descriptions.ts` cross-refs.

The plan does NOT include implementation tasks (edit-log schema
migration, hook rewiring, etc.) — those land in a follow-up plan once
the spec is approved.

---

## Part I — Constitutional draft (8 articles)

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

### Article 4 — Surface: nineteen tools (17 + 2)

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

**Two workflow-required tools.** The development workflow imposes
actions that are not "code edits as cognitive units" but "environment
setup that the agent feels motivated to perform in batches"
(scaffolding new files, sweeping documentation updates). Forcing those
into a one-call-per-file rhythm creates friction that biases the agent
toward shell-redirect bypass. They are recognized constitutionally as
batch-friendly:

```
edit_docs_only                edit_create_file
```

The full per-tool descriptions live in Part II §4 of SPEC.md and in
`src/tools/descriptions.ts` verbatim. They are unconstitutional only in
the sense that the spec does not constrain their wording — they are
free to evolve as observation accumulates, provided every change keeps
spec and code in sync in the same change.

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

The current implementation choice is a single-use, TTL-bound,
HMAC-signed token (Part III). It satisfies all three principles. If a
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

**Two workflow-required tools — 1 declaration ≡ N target_files.**
`edit_docs_only` and `edit_create_file` accept a batch of files in one
declaration. The binding's TTL covers the whole batch; native Edit /
Write calls consume the batch's entries in any order until the
declaration is exhausted or expires. Per-file classification has no
cognitive value here (sweeping a docs rename across 30 markdown files
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

## Part II — Restructure mapping (current SPEC.md → constitutional)

Each current section is graded against Article 1–8 and assigned a
disposition.

| § | Current title | Lines | Disposition | Target |
|---|---------------|------:|-------------|--------|
| §1 | The bet | 19 | **absorb** into Article 2 | — |
| §2 | Architecture | 39 | **slim** | ~15 lines: diagram + token flow |
| §3 | Common schema | 124 | **slim heavily** | ~40 lines: token schema + validation invariants |
| §4 | Nineteen tool descriptions | 756 | **untouchable** (the product) | unchanged |
| §5 | Hooks | 109 | **slim + retarget** | ~70 lines: token-aware deny-raw-edit, deny-bash-write-bypass |
| §6 | Edit log | 45 | **slim** | ~30 lines: 2-state record (issued / consumed) |
| §7 | CLI | 75 | **keep** | unchanged |
| §8 | Threat model | 21 | **absorb** into Article 3 | — |
| §9 | Configuration | 8 | **keep** | unchanged |
| §10 | Implementation notes | 57 | **slim** | ~20 lines: stack, layout, descriptions-verbatim rule |
| §11 | Future direction | 16 | **absorb** into Articles 2, 7 | — |
| §12 | References | 2 | **absorb** into Article 8 | — |

Predicted SPEC.md size after restructure:

- Part I (Articles 1–8): ~140 lines
- Part II (§3, §5, §6, §7, §9, §10): ~190 lines
- Part II §4 (verbatim 19 descriptions): 756 lines
- **Total: ~1090 lines** (down from 1280; review-accretion cut ~75% on §3 / §10, structural absorption removes ~58 lines from §1/§2/§8/§11/§12)

The bigger win is qualitative: any further "we need to add a check
for X" pressure during reviews is now adjudicated by Article 7, not by
ad-hoc author judgement.

---

## Part III — Token mechanics (current best implementation)

This part specifies the binding mechanism Article 5 mandates in
principle. It is **derived from the constitution, not part of it.**
A future proposal that satisfies Article 5's three principles with
better ergonomics or smaller surface can replace this part without
amending the constitution.

### Request schema (replaces current §3 EditToolRequest)

```typescript
type EditToolRequest = {
  target_file: string;              // primary file. Always bound.
  rationale: string;                // 1–3 sentences, non-empty after trim
  risk_level: "low" | "medium" | "high" | "critical";
  test_files: string[];             // forward declaration only, not
                                    // bound by token. Cardinality
                                    // enforced per Article 6 + tool
                                    // description.

  before_sha256: string;            // hex(64), sha256 of disk content
                                    // at declaration time. For
                                    // edit_create_file's target_file,
                                    // sha256("").
  after_sha256: string;             // hex(64), sha256 of intended
                                    // post-edit content.

  // ONLY accepted by the 2 workflow tools (edit_docs_only,
  // edit_create_file). The 17 SQLite-derived tools MUST omit this
  // field (validation rejects its presence). See Article 6.
  additional_files?: Array<{
    file: string;
    before_sha256: string;          // sha256("") for create entries
    after_sha256: string;
  }>;
};

type EditToolResult = {
  token: string;                    // e.g. "met_20260502_a3f9b2…"
  expires_at: string;               // ISO-8601, declaration_time + 30s
  edit_id: string;                  // e.g. "edit_20260502_0001"
  warnings: string[];
  audit_error?: string;
};
```

Token binding set: SQLite-derived tools bind exactly one tuple
`(target_file, before_sha256, after_sha256)`. Workflow tools bind
that plus every entry in `additional_files`. The TTL applies to the
whole binding set; each tuple is consumed independently by a matching
native Edit / Write call carrying the token.

### Token validation (PreToolUse on Edit/Write/MultiEdit/NotebookEdit)

Pseudocode:

```
on_pre_tool_use(toolName, toolInput):
  token_id = toolInput["_meta_edit_token"]
  if not token_id:
    return deny("untyped raw edit")

  token = grants.lookup(token_id)
  if token is None or token.expired():
    return deny("token expired or unknown")

  file_path = realpath(toolInput["file_path"])
  bound = token.find_binding(file_path)
  if bound is None:
    return deny("file_path not bound by this token")

  # Pre-condition: declared starting state matches disk
  disk_content = read(file_path) if exists(file_path) else b""
  if sha256(disk_content) != bound.before_sha256:
    return deny("disk has drifted from declaration (staleness)")

  # Post-condition: simulated write produces declared content.
  # Catches honest mistakes where the agent's tool_input would
  # produce content differing from the declared after_sha256.
  proposed = simulate(toolName, toolInput, disk_content)
  if sha256(proposed) != bound.after_sha256:
    return deny("simulated write does not match declared after_sha256")

  grants.consume(token_id, file_path)
  return allow()

simulate(toolName, toolInput, current):
  case "Edit":       return current.replace(toolInput.old_string,
                                            toolInput.new_string, count=1)
  case "Write":      return toolInput.content
  case "MultiEdit":  result = current
                     for e in toolInput.edits:
                       result = result.replace(e.old_string,
                                               e.new_string, count=1)
                     return result
  case "NotebookEdit": return UNSUPPORTED   # see open decisions
```

The pre-condition check is **staleness detection**, not a TOCTOU
defense: it catches declarations made against a prior disk state, but
it does not eliminate the residual race between hook approval and the
native write completing. The residual race is accepted under
Article 3's friendly-AI threat model.

Read-only tool calls (Read, Grep, Glob, Bash without writes, etc.)
do NOT consume tokens. The hook fires only on
`Edit / Write / MultiEdit / NotebookEdit`. The agent may freely
interleave reads between declaration and consumption, bounded only by
the token's TTL.

After the Edit completes, a PostToolUse hook (or the MCP server
polling on grant consumption) appends to `.meta-edit/state/edits.jsonl`
with `applied: true` and the consuming tool's name.

### Edit log shape (replaces current §6)

Each declaration produces two log records:

1. **Issued.** Written when the typed_edit handler returns success.
   ```json
   {"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:00+09:00",
    "kind":"edit_boundary_condition","target_file":"src/foo.ts",
    "rationale":"…","test_files":["tests/foo.test.ts"],
    "before_sha256":"…","after_sha256":"…",
    "token":"met_…","applied":false}
   ```

2. **Consumed.** Written when the token is consumed by an Edit hook.
   ```json
   {"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:11+09:00",
    "consuming_tool":"Edit","applied":true}
   ```

Records that never reach a "consumed" entry (token expired, declaration
without follow-through) remain in the log as evidence of a half-finished
declaration. Audit consumers reconcile by `edit_id`.

### Open mechanics decisions

- **MultiEdit support** — Recommended yes. Specified above in the
  `simulate()` cases.
- **NotebookEdit support** — Out of scope for v0.2 first cut. Hook
  denies `NotebookEdit` unconditionally inside the repo. Revisit when
  notebook-heavy projects start dogfooding.
- **Token storage** — `.meta-edit/state/grants/<token_id>.json`,
  protected path. Concurrent declarations get separate token files; no
  global lock. No HMAC signing: forgery requires writing into
  `.meta-edit/state/`, which `deny-bash-write-bypass` already blocks.
  Adversarial-MCP forgery is out of scope per Article 3.
- **`additional_files` cardinality cap** — Server enforces a soft cap
  (suggested initial value: 32) on the size of the workflow tools'
  binding set. Larger batches must be split. The cap is operational
  hygiene (audit-log noise, declaration-time sha256 cost), not a
  constitutional value, and may be tuned by observation.

---

## Part IV — Migration strategy

**Decision (user 2026-05-02): spec-first, single PR.**

The constitution lands on `main` as a single PR (this work),
including the Article 5 binding mandate, even though `main`'s code
still uses the v0.1.x apply.ts content-pair implementation.
Implementation work follows in subsequent PRs guided by the spec.

### Why not split spec-slim from feature

The earlier draft proposed splitting (a) a doc-only slim PR landing on
`main` and (b) a feature PR on a `v0.2-token-binding` branch. Rejected
because:

- **AI-agent context drift.** Implementation PRs without the spec in
  hand tend to default to existing patterns and postpone the
  migration. Spec-first ensures the constitutional constraints are
  visible whenever the code is being touched.
- **The split's claimed benefit (avoiding spec-vs-code drift) is
  weaker than its cost.** The drift window is the time between
  constitution-on-main and code-catching-up. During this window,
  Article 5 is the target semantics; the legacy implementation is
  honest about being legacy. This is preferable to leaving the
  constitution off `main` while the code drifts further from it.

### Suggested PR sequence

1. **Constitutional restructure PR (this work)** — adds Part I
   articles, restructures Part II per the disposition map. Article 5
   states the binding mandate as target semantics; the spec briefly
   leads the implementation. Lands on `main`.
2. **Implementation PRs** migrate `apply.ts` → thin grant issuer,
   rewire `deny-raw-edit` to be token-aware, and update
   `src/tools/{common,registry}.ts` and `src/state/edit-log.ts`.
   Each PR's review surface is "does this realize Article 5/6's
   mandate?" rather than re-debating the design.
3. **v0.2.0 release** cuts when the implementation catches up to the
   constitution.

---

## Part V — Approval gate

Before this plan moves to implementation:

- [ ] User reviews **Part I (8 articles)** — articles are reorderable;
      content is the substantive review surface.
- [ ] User reviews **Part II mapping** — disagreements on a section's
      disposition (keep/slim/absorb/cut) get resolved here, not later.
- [ ] User reviews **Part III mechanics** — open decisions
      (MultiEdit yes; NotebookEdit deferred; storage no-HMAC;
      `additional_files` cardinality cap) get answered or deferred.
- [x] **Part IV migration sequence — RESOLVED 2026-05-02.** Spec-first,
      single PR (no doc/feature split).

Once Part I / Part II / Part III pass, hand off to
`superpowers:writing-plans` to produce a micro-plan that maps to
specific edits in `docs/SPEC.md` and (eventually) `src/tools/{common,registry}.ts`,
`src/hooks/raw-edit-policy.ts`, `src/state/edit-log.ts`.

### Codex review history (2026-05-02)

Codex review run after the corrections in commit `0079f6c`. Findings:

- **HIGH adopted**: `after_sha256` post-condition check added to hook
  pseudocode (catches honest mismatches between declaration and
  proposed write).
- **HIGH softened**: pre-condition sha256 check reframed as
  "staleness detection," not TOCTOU defense; residual race accepted
  per Article 3.
- **HIGH descoped**: HMAC signing dropped from open decisions —
  adversarial-MCP forgery is outside Article 3's threat model.
  Issue 1108 added to References as the acknowledged hook-scope gap
  to be closed by future hook expansion, not by this constitution.
- **HIGH resolved**: spec-vs-code drift accepted as cost of spec-first
  migration; Part IV updated.
- **MED adopted**: `additional_files` cardinality cap added (initial
  value 32). Falsifiability paragraph added to Article 2.
- **MED retained-as-designed**: 17/2 split and "1 declaration ≡ 1
  file" for SQLite-derived multi-file refactors are deliberate
  cognitive-intervention choices, not regressions.
- **LOW + editorial**: multi-test-file fulfillment clause added to
  Article 6; Article 8 self-reference removed; intervening-read
  semantics specified in Part III.

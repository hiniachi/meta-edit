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

### Article 3 — Threat model

The expected operator is a **friendly-but-friction-driven** agent.
Bypass attempts (raw Edit, shell redirects, encoded payloads) emerge
when the typed surface is inconvenient relative to the agent's native
workflow, not when the agent is adversarial.

Two consequences follow:

1. The typed surface MUST be at least as ergonomic as native Edit plus
   one declaration step. If using the typed tool feels harder than
   slipping a `cat > file` past the hook, the typed tool will be
   skipped, and the trial returns no signal.
2. The bash-write-policy hook is the load-bearing defense line, not
   the MCP server's internal hardening. Even when the server delegates
   actual writes to native Edit (Article 5), grant forgery still has
   to clear the bash hook.

What is NOT defended against (constitutionally accepted): an agent that
deliberately mis-selects a tool, lists irrelevant files in
`test_files`, or writes plausible-but-false `rationale` text. Catching
these requires diff classification or test-content inspection, which
Article 7 forbids in MVP.

### Article 4 — Surface: nineteen tools (16 + 3)

**Sixteen SQLite-derived tools.** Each captures one bug class for which
SQLite's testing strategy (https://sqlite.org/testing.html) imposes a
specific obligation pattern (boundary triple, MC/DC, anomaly testing,
etc.). The categories themselves are application-level (permission
logic, API contract, …) — what is borrowed from SQLite is the
*per-change checklist* discipline.

```
edit_boundary_condition       edit_boolean_condition
edit_state_transition         edit_db_schema
edit_data_migration           edit_api_contract
edit_serialization            edit_error_handling
edit_retry_timeout            edit_concurrency
edit_external_side_effect     edit_cache_invalidation
edit_permission_logic         edit_dependency_config
edit_policy_change            edit_test_only_change
```

**Three workflow-essential tools.** No automated test obligation
applies, but the development workflow demonstrably needs them.

```
edit_refactor_only            edit_docs_only
edit_create_file
```

The full per-tool descriptions live in Part II §4 of SPEC.md and in
`src/tools/descriptions.ts` verbatim. They are unconstitutional only in
the sense that the spec does not constrain their wording — they are
free to evolve as observation accumulates, provided every change keeps
spec and code in sync in the same change.

### Article 5 — Mechanism: declaration + token

A typed_edit MCP call is a **declaration of intent**. The MCP server
does not write. A validated declaration issues a single-use token bound
to one or more `(file, before_sha256, after_sha256)` tuples, with a
short TTL (30 seconds, hardcoded). Modify tools always bind exactly
one tuple per Article 6; `edit_create_file` may bind N tuples for the
same declaration. Each tuple is consumed by a matching native
Edit / Write / MultiEdit / NotebookEdit call carrying the token, gated
by the `deny-raw-edit` hook, which:

1. Looks up the token; if absent or expired, denies.
2. Verifies the call's `file_path` matches the token's bound file.
3. Reads the file's current sha256 from disk and compares to the
   token's `before_sha256`; on mismatch, denies (TOCTOU defense).
4. On match, allows the call and consumes the token (single-use).

Real writes go through the agent's native tools — the workflow it is
tuned for. The typed surface preserves the cognitive intervention force
of explicit kind selection without imposing a foreign content-pair
schema on the agent.

The bash-write-policy hook remains independently armed. It does not
participate in token validation; it ensures that no path other than
"declared via meta-edit + native Edit" can land bytes inside the
repository.

### Article 6 — Granularity rules

**Modify: 1 declaration ≡ 1 target_file.** A change that spans multiple
production files is multiple typed_edit calls, each with its own token.
This makes per-file kind selection the unit of cognitive intervention.
Atomic multi-file rename (today's `apply.ts` invariant) is **not**
preserved; partial application is recoverable in the friendly-AI
threat model. This is a deliberate behavior change from current
`main`, accepted as the cost of moving real writes into native Edit.

**`edit_test_only_change` is a strict modify tool**: target_file is the
test file itself, and `test_files` MUST be empty (the agent's
declaration that this edit is itself the test).

**Create: 1 declaration ≡ N files.** `edit_create_file` may scaffold
multiple new files in one declaration. Scaffolding has no per-file
classification value (a new module's `index.ts`, `impl.ts`, and
`impl.test.ts` are one cognitive act, not three). The token binds the
set of `(file, sha256(""), after_sha256)` tuples; consumption requires
each file to be created with a matching token-carrying Edit/Write call,
in any order.

**Test obligations.** The 16 SQLite-derived tools (modify production
code) declare `test_files: [...]` as a **forward declaration** — paths
the agent commits to fulfilling test obligations on. Forward
declarations are recorded in the edit log but **not** bound by the
production token. Test edits are made through `edit_test_only_change`,
each producing its own token. Selecting `edit_test_only_change` is the
agent's re-affirmation that this edit is test-only; the cognitive
intervention fires twice, once for the production change and once for
the test addition.

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
- Brainstorm origin: `docs/plan/case-c-token-spec-restructure/macro-plan.md`

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

## Part III — Single-file token mechanics (precise)

### Request schema (replaces current §3 EditToolRequest)

```typescript
type EditToolRequest = {
  target_file: string;              // single file (modify) or first
                                    // file (create); see scope rules
  rationale: string;                // 1–3 sentences, non-empty after trim
  risk_level: "low" | "medium" | "high" | "critical";
  test_files: string[];             // forward declaration only, not
                                    // bound by token. Cardinality
                                    // enforced per Article 6 + tool
                                    // description.

  before_sha256: string;            // hex(64), sha256 of disk content
                                    // at declaration time. Empty-file
                                    // sha256 for edit_create_file
                                    // entries.
  after_sha256: string;             // hex(64), sha256 of intended
                                    // post-edit content.

  // edit_create_file ONLY:
  additional_creates?: Array<{      // for the "1 declaration ≡ N files"
    file: string;                   // create granularity rule. Each
    after_sha256: string;           // entry adds (file, sha256(""),
  }>;                               // after_sha256) to the token's
                                    // bound set. Other tools MUST omit
                                    // or set to []. Validation rejects
                                    // its presence on non-create tools.
};

type EditToolResult = {
  token: string;                    // e.g. "met_20260502_a3f9b2…"
  expires_at: string;               // ISO-8601, default declaration_time + 30s
  edit_id: string;                  // e.g. "edit_20260502_0001"
  warnings: string[];
  audit_error?: string;
};
```

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

  current_sha = sha256(read(file_path)) if exists(file_path) else SHA256_EMPTY
  if current_sha != bound.before_sha256:
    return deny("disk content changed since declaration (TOCTOU)")

  grants.consume(token_id, file_path)
  return allow()
```

After the Edit completes, a PostToolUse hook (or the MCP server polling
on grant consumption) appends to `.meta-edit/state/edits.jsonl` with
`applied: true` and the consuming tool's name.

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

- **MultiEdit support** — Recommended yes. The hook reads disk before,
  applies the multi-edit's internal sequence in-memory, computes the
  resulting sha256, compares to `after_sha256`. If matches, the actual
  MultiEdit is allowed.
- **NotebookEdit support** — Out of scope for v0.2 first cut. Hook
  denies `NotebookEdit` unconditionally inside the repo. Revisit when
  notebook-heavy projects start dogfooding.
- **Token storage** — `.meta-edit/state/grants/<token_id>.json`,
  protected path. Concurrent declarations get separate token files; no
  global lock.
- **Token signing** — HMAC-SHA256 with a server-startup-generated key
  at `.meta-edit/state/grant.key` (mode 0600). Hook verifies signature
  before lookup. Stops a different MCP/process from forging tokens by
  writing into `.meta-edit/state/grants/`.

---

## Part IV — Migration strategy

Per issue 1103 §採用判断ポイント, the recommendation is **(i) v0.2
branch with current `main` continuing on apply.ts**. Rationale:

- Hypothesis-validation comparability: side-by-side observation of
  "heavy apply.ts main" vs "thin token v0.2".
- Risk isolation: token-binding has new failure modes (TOCTOU window,
  signature key handling) worth shaking out off the release line.
- SPEC slim is implementation-mostly-orthogonal: the constitutional
  restructure can land on `main` even without the Case C migration,
  just by trimming review-accretion. We may want to **split the spec
  slim from the token-binding feature**.

### Suggested PR sequence

1. **`spec-constitutional-restructure` PR** (this work) — adds Part I
   articles, slims review-accretion in Part II, no behavior change.
   Lands on `main`. Pure documentation.
2. **`v0.2-token-binding` branch** — implements Article 5/6, switches
   `apply.ts` to a thin grant issuer, rewires `deny-raw-edit` to be
   token-aware. Tested in branch, observed in self-application.
3. **`v0.2.0` release** — cuts a tag once Case C shows acceptable
   ergonomics and bypass rates in dogfood.

Either step (1) alone is a complete unit of value (the spec becomes
re-readable for newcomers). Step (2) requires step (1)'s constitution
in place to be reviewable against the bet.

---

## Part V — Approval gate

Before this plan moves to implementation:

- [ ] User reviews **Part I (8 articles)** — articles are reorderable;
      content is the substantive review surface.
- [ ] User reviews **Part II mapping** — disagreements on a section's
      disposition (keep/slim/absorb/cut) get resolved here, not later.
- [ ] User reviews **Part III mechanics** — open decisions
      (MultiEdit, NotebookEdit, signing) get answered or deferred.
- [ ] User confirms **Part IV migration sequence** — specifically the
      "split slim from token-binding" recommendation.

Once all four pass, hand off to `superpowers:writing-plans` to produce
a micro-plan that maps to specific edits in `docs/SPEC.md` and
(eventually) `src/tools/{common,registry}.ts`, `src/hooks/raw-edit-policy.ts`,
`src/state/edit-log.ts`.

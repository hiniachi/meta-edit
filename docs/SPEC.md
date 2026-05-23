# meta-edit Specification

`meta-edit` is an MCP server that replaces the AI coding agent's raw file editing tools (`Edit` / `Write` / `MultiEdit`) with a family of twenty-one kind-specific edit tools. Each tool's description encodes when to use it, when not to use it, and what tests must accompany the edit. The 16 impl tools (15 SQLite-derived + `edit_cosmetic`) additionally carry a required `target: "prod" | "test"` flag — prod/test pairs land as two declarations of the same tool, keeping test edits visible inside their kind's audit surface. The 5 workflow-axis kinds (`edit_progress` / `edit_observation` / `edit_proposal` / `edit_decision` / `edit_explanation`) replace v0.5.x's single `edit_docs_only` and classify documentation / planning edits by the intent of the current session moment. Every declaration also carries a required `provenance` field naming the epistemic source of the edit (user_confirmed / accepted_artifact / direct_observation / inference / speculation), so a future session reading the file picks up uncertainty directly from the prose rather than treating past-chat artifacts as confirmed decisions. The bet is that **a deliberately structured tool surface, with testing obligations encoded in tool descriptions, is enough to change AI editing behavior** — without diff classification, mutation testing, or any verification machinery.

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

### Article 4 — Surface: twenty-one tools (15 SQLite + edit_cosmetic + 5 workflow)

**Fifteen SQLite-derived tools.** Each is one element of a bug-class
classification grounded in SQLite's testing strategy
(https://sqlite.org/testing.html). The strategy's *per-change
checklist* discipline maps each bug class to a specific obligation
pattern (boundary triple, MC/DC, anomaly testing, etc.). The
categories themselves are application-level (permission logic, API
contract, …) — what is borrowed from SQLite is the discipline of
classifying every edit before it lands.

```
edit_boundary_condition       edit_boolean_condition
edit_state_transition         edit_db_schema
edit_data_migration           edit_api_contract
edit_serialization            edit_error_handling
edit_retry_timeout            edit_concurrency
edit_external_side_effect     edit_cache_invalidation
edit_permission_logic         edit_dependency_config
edit_policy_change
```

**One cosmetic tool.** `edit_cosmetic` is the narrow-vocabulary surface
for changes with no semantic effect — whitespace, comments, formatter
output ONLY. It is intentionally narrower than a generic "refactor"
slot: renames, function extracts, dead-code removal, guard-clause
rewrites, and any logic-preserving transformation that changes program
bytes beyond layout are all OUTSIDE its scope. The absence of a generic
refactor catch-all is deliberate: when no kind-specific tool fits, the
agent stops and asks rather than rationalizing the change as "just a
refactor". (See §4 for the verbatim description and the rationale.)

```
edit_cosmetic
```

**Five workflow-axis tools.** Documentation and planning edits divide
naturally along an *intent axis*, not a path axis: the same Markdown
file may pass through different tools across sessions depending on
whether the current moment is recording work done, observing a
gotcha, raising a proposal, recording a confirmed decision, or
explaining shipped behavior to a reader. The five workflow tools
classify those moments:

```
edit_progress      edit_observation      edit_proposal
edit_decision      edit_explanation
```

`edit_progress` records what was done in this session (typical target:
`IMPLEMENTATION-LOG.md`). `edit_observation` records facts that
outlive the session (typical target: `OBSERVED-FAILURES.md`, in-code
`// XXX ...`). `edit_proposal` raises proposals, RFC drafts, ADR
drafts, and open questions (typical target: `issues/`,
`docs/plan/**`). `edit_decision` records confirmed decisions (cut
CHANGELOG, accepted ADR). `edit_explanation` explains shipped
behavior for a reader (typical target: README, JSDoc, docs/). Acceptance
of multi-file batching via `additional_files` is cell-wise by
(workflow kind × provenance) per §3.3.2.

(v0.3.1 dropped `edit_create_file` and `edit_create_planning_artifact`:
empty file creation is now free at the deny-raw-edit hook level — see
§5.1 — so the create act stops being a special workflow and content
fills go through the appropriate type-specific tool against the
now-empty file. v0.5.0 dropped `edit_test_only_change` and renamed /
narrowed `edit_refactor_only` to `edit_cosmetic`: test edits flow
through the kind-specific impl tool with `target: "test"`, paired
with the original `target: "prod"` declaration so the prod/test pair
lands inside the same kind's audit surface rather than disappearing
into a generic test bucket. v0.6.0 split the v0.5.x `edit_docs_only`
along the intent axis described above, so documentation edits are
classified by what the session is doing rather than by which path the
file sits under. Per Q5 in
`docs/plan/docs-kind-subdivision-and-provenance/open-questions.md`,
the v0.6.0 write path rejects calls naming `edit_docs_only`; the
read path still surfaces legacy v0.5.x entries in a dedicated
"legacy: edit_docs_only" bucket in `meta-edit summary` so audit
continuity is preserved.)

**prod/test target flag.** The 16 impl tools (15 SQLite-derived +
`edit_cosmetic`) each require a `target: "prod" | "test"` field on
every declaration. One declaration covers exactly one target. Pairing
implementation with its tests is two declarations of the same tool
(target: "prod" then target: "test"); both may land in the same commit.
When `target: "test"`, `target_file` IS the test file and `test_files`
must be empty. The 5 workflow-axis tools do NOT carry `target` —
documentation / workflow content has its own surface and the prod/test
split does not apply.

**Provenance flag.** Every declaration — all 21 tools — carries a
required `provenance` field naming the epistemic source of the edit:
one of `user_confirmed` / `accepted_artifact` / `direct_observation` /
`inference` / `speculation`. The five values represent five distinct
epistemic strata that past-chat artifacts otherwise conflate. The
schema is strict (required, no default); the (kind, provenance) cell
matrices in §3.3 then encode whether a particular declaration is
accepted, accepted-with-warning, or rejected. Crucially, the prose of
the edit is expected to carry the uncertainty itself — a future
session reading the file picks up the hedging language directly, with
no structural-marker machinery in the loop.

**Execution state flag.** Every declaration — all 21 tools — also
carries a required `execution_state` field, a self-declared signal
naming the state of the agent's work loop at the moment of
declaration. Three values: `normal` (ordinary work, no active failure
loop), `repeating_failure` (the agent has noticed it is repeating the
same failure across multiple edits), and `recovery` (the agent has
recorded the failure and is executing a deliberate single-intervention
diagnosis). The field is a declaration (not detection) — the server
does not analyze edit content or history to infer the state. It falls
within Articles 1–2 (typed surface, non-adversarial threat model) and
does not alter the Article 7 / scope-expansion amendment bar. The
(kind, execution_state) audit matrix lives in §3.4.

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
descriptions feel low-stakes (`edit_cosmetic`,
`edit_dependency_config`, `edit_policy_change`) are the ones the
agent will reach for under friction. Their descriptions therefore
include explicit obligations that fire if the choice was wrong:

- `edit_cosmetic`: if the patch turns out to contain anything beyond
  whitespace / comments / formatter output (a rename slipped in, a
  guard clause moved), the agent OWES the user a follow-up
  explanation in the next message — what slipped in, why the narrow
  definition didn't catch it earlier.
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

**Sixteen impl tools (15 SQLite-derived + edit_cosmetic) — 1 declaration ≡ 1 target_file.**
Each call binds exactly one file. A change that spans multiple
production files is multiple typed_edit calls, each producing its own
binding. Per-file kind selection IS the unit of cognitive intervention
for code changes; collapsing multiple files into one declaration would
weaken the bet. Atomic multi-file rename (today's `apply.ts`
invariant) is **not** preserved; partial application is recoverable in
the friendly-AI threat model.

**Five workflow-axis kinds — 1 declaration ≡ 1 or N target_files.**
The 5 workflow-axis kinds (`edit_progress`, `edit_observation`,
`edit_proposal`, `edit_decision`, `edit_explanation`) MAY accept a
batch of files in one declaration, with acceptance decided cell-wise
by (kind, provenance) per §3.3.2. When `additional_files` is accepted
or warned, the binding's TTL covers the whole batch; native Edit /
Write calls consume the batch's entries in any order until the
declaration is exhausted or expires. Per-file classification has no
cognitive value at sweep moments (sweeping a docs rename across 30
markdown files is one act, not 30), and observation suggests that
forcing them 1-by-1 is the friction surface most likely to push the
agent toward shell-redirect bypass. `edit_progress` is the lone
workflow kind that rejects `additional_files` in every cell — a
progress entry is per-moment and per-place by nature.

**prod/test target flag.** Every impl tool (the 15 SQLite-derived +
`edit_cosmetic`) carries a required `target: "prod" | "test"` field.
One declaration covers exactly one target. The granularity is
per-declaration: pairing implementation with its tests is two
declarations of the same impl tool (target: "prod" then target: "test"),
each producing its own binding and rationale. Both may land in the
same commit. The pair makes the test edit visible inside that kind's
audit surface rather than collapsing into a generic test bucket.

**Test obligations.** SQLite-derived impl tools that modify production
code declare `test_files: [...]` as a **forward declaration** — paths
the agent commits to fulfilling test obligations on. Forward
declarations are recorded in the edit log but are NOT bound by the
production declaration; they do not authorize writes to the test
files. Test edits land via a second invocation of the same impl tool
with `target: "test"`, with that test file as `target_file` and
`test_files` empty. Selecting the same impl tool a second time is the
agent's re-affirmation that this test belongs to the implementation
domain; the cognitive intervention fires twice, once for the production
change and once for the test addition.

If the production edit's `test_files` lists multiple paths, the agent
issues one `target: "test"` declaration per test file. This is the
intended cost: each test file is its own cognitive unit, so multi-file
fulfillment cannot be batched under a single declaration.

**`edit_cosmetic` is a strict 1-file impl tool** despite having no
test obligation: it carries the cognitive intervention "this change
is surface-level only — whitespace / comments / formatter output", and
the narrowness of the vocabulary is per-file by definition. Anything
outside that vocabulary routes to stop-and-ask, not to a generic
refactor catch-all.

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
  ├─ 15 SQLite-discipline-derived impl tools (single-file declarations, prod/test target flag)
  ├─ 1 cosmetic tool (single-file declarations, prod/test target flag, narrow scope)
  ├─ 5 workflow-axis tools (batch declarations of N files cell-wise by (kind, provenance), no target flag)
  ├─ Every declaration carries a required provenance field (v0.6.0)
  └─ Issues tokens; never writes files

State
  ├─ .meta-edit/state/grants/         in-flight tokens
  └─ .meta-edit/state/edits.jsonl     append-only audit log

CLI
  ├─ meta-edit serve / log / summary
```

That is the entire system.

---

## 3. The twenty-one tools: common schema

A typed_edit MCP call is a **declaration of intent**. The server validates the request, reads disk to compute `before_sha256` itself, issues a single-use token bound to one or more `(file, before_sha256)` tuples, and returns. **It does not write.** Native `Edit` / `Write` / `MultiEdit` performs the write under hook validation (see §5).

```typescript
type EditToolRequest = {
  target_file: string;            // primary bound file. Always present.
  rationale: string;              // 1-3 sentences, non-empty after trim
  risk_level: "low" | "medium" | "high" | "critical";

  // REQUIRED on every impl tool (15 SQLite-derived + edit_cosmetic).
  // Forbidden on the 5 workflow-axis kinds (edit_progress /
  // edit_observation / edit_proposal / edit_decision /
  // edit_explanation; documentation / workflow content has its own
  // surface and the prod/test split does not apply). One declaration
  // covers exactly one target. Pair impl with tests via two
  // declarations of the same tool — target: "prod" then target:
  // "test"; both land in the same commit. See §4.
  target?: "prod" | "test";

  // REQUIRED on every tool (v0.6.0). Names the epistemic source of
  // the edit. The (kind, provenance) cell matrices in §3.3 decide
  // acceptance.
  provenance:
    | "user_confirmed"
    | "accepted_artifact"
    | "direct_observation"
    | "inference"
    | "speculation";

  // REQUIRED on every tool (v0.7.0). Self-declared state of the
  // agent's work loop at the moment of declaration. The
  // (kind, execution_state) audit matrix in §3.4 decides whether a
  // warn is recorded; there is no REJ cell. Schema is strict
  // (required, no default).
  execution_state: "normal" | "repeating_failure" | "recovery";

  test_files: string[];           // forward declaration; not bound by token

  // ONLY accepted by the 5 workflow-axis kinds (v0.6.0). The 15
  // SQLite-derived impl tools and edit_cosmetic MUST omit this field;
  // validation rejects its presence elsewhere. Acceptance of a
  // particular workflow-kind declaration is further refined cell-wise
  // by (kind, provenance) per §3.3.2. (v0.3.1 dropped edit_create_file
  // and edit_create_planning_artifact; empty file creation is now a
  // free hook-level action — see §5.1.)
  additional_files?: Array<{
    file: string;
  }>;
};

type EditToolResult = {
  summary?: string;                // first field in JSON results: compact
                                  // human-readable status for collapsed
                                  // / preview-oriented clients.
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

### Repository root

The **repository root** is the single directory that all `target_file`
/ `additional_files` paths are resolved against (after `realpath`) and
the boundary the path-safety check enforces. Every path in this spec is
repository-relative to it.

Resolution precedence (the chosen value is then upward-discovered and
realpath-normalized):

1. the explicit `--repo-root <path>` flag (`meta-edit serve`) — on the
   hook side, the Claude Code hook event's `cwd`
2. the `META_EDIT_REPO_ROOT` environment variable
3. `process.cwd()` (the default)

Whichever branch wins is passed through one shared resolver
(`src/utils/repo-paths.ts resolveRepoRoot`) that (a) walks **up** the
directory tree to the nearest ancestor containing a `.git` or `.jj`
marker (a sub-directory or jj-workspace launch resolves to the actual
workspace root), then (b) `realpath`-normalizes it. The MCP server and
**both** hooks call this one implementation — parity is structural, not
comment-enforced across copies. This is a correctness requirement: if
the server (issuer) and the hooks (consumer) land on different roots,
the grant binding key diverges and the single-use lookup fails.

The same module provides the one **existence-independent**
canonicalizer (`canonicalizeRepoRelative`) used by both the issuer
(`checkPathSafety`) and the consumer (`canonicalizeForBinding`): it
realpaths the deepest existing **directory** ancestor and re-attaches
the remaining components — including the leaf — lexically, so a
declaration against a not-yet-created file binds the same key the
later native write resolves to (the file's existence state at each
moment no longer changes the canonical form).

`.git`/`.jj` upward discovery is VCS-agnostic plumbing — meta-edit
still does not parse VCS layouts or add a VCS adapter (Article 7).
`--repo-root` / `META_EDIT_REPO_ROOT` remain available to override
discovery explicitly.

### Argument validation

The MCP server enforces:

- `target_file` is inside the repo (after `realpath`) and not in protected paths (`.meta-edit/state/**`, `.meta-edit/tmp/**`).
- `rationale` is non-empty after trim.
- `target` field presence: required (`"prod"` or `"test"`) on every impl tool (15 SQLite-derived + `edit_cosmetic`); forbidden on the 5 workflow-axis kinds. Validation rejects both omissions and misplacements.
- `provenance` field presence: required on every declaration (v0.6.0). The schema is strict (no default). Cell-level acceptance by (kind, provenance) is then decided per §3.3.
- `execution_state` presence: required on every declaration (v0.7.0). The schema is strict (no default). Cell-level audit by (kind, execution_state) is then decided per §3.4.
- `test_files` cardinality follows the per-tool rule encoded in §4: non-empty for SQLite-derived impl tools when `target: "prod"`; empty when `target: "test"` (target_file IS the test file in that case); empty for `edit_cosmetic` and the 5 workflow-axis kinds regardless.
- `test_files` entries are **forward declarations**: each path names a test file the agent commits to populating via a subsequent declaration of the same impl tool with `target: "test"`. Paths MAY name files that do not yet exist on disk — `test_files` is recorded in the audit log but is NOT bound by the issued token, and the server does not require the path to be a current file. (Issue 0105-test-files-burden / Article 6: the cognitive intervention is the commitment, not the file existence.)
- The server reads `target_file` from disk and binds `before_sha256 := sha256(disk_content_utf8)`. If the file does not exist yet, the binding is `before_sha256 := sha256("")` — a declaration against a not-yet-created file is valid (v0.4.2). The subsequent native Write creates the file (auto-mkdir-ing parents) and the binding resolves; the hook reads an absent file as `""` so the digests agree.
- v0.4.2 removed the v0.3.1 "create the empty file first via a `content === ""` Write, THEN declare" requirement. That ordering-sensitive dance was a primary cause of binding failures (issues/2026-05-17-grant-binding-canonicalization-parity.md). The free empty-`content` Write to a non-existent in-repo path is still authorized at the hook (it remains a convenient scaffold), but it is no longer a prerequisite for declaring against a new file.
- `additional_files` is accepted only for the 5 workflow-axis kinds, with cardinality ≤ 32 (operational hygiene; not a constitutional value). Per-cell acceptance / warning / rejection is further decided by §3.3.2.
- Each `file` in `additional_files` is validated under the same path-safety rules as `target_file`.
- Legacy `edit_docs_only` (v0.5.x and earlier): write path rejects on v0.6.0 as an unknown tool; read path surfaces past entries in a dedicated `legacy:` bucket — see `meta-edit summary` and §6.

Validation failures result in a rejected request with a non-empty `warnings` array and no token issued. Every typed-edit result includes a compact `summary` string as the first JSON field (for example, `edit_boundary_condition declared: src/foo.ts target=prod provenance=direct_observation bindings=1` or `edit_boundary_condition rejected: src/foo.ts ...`) so clients that preview only the beginning of tool output still show the specific edit kind and target path.

The `tools/list` response also supplies each tool's MCP `title` and `annotations.title`. The machine `name` remains the stable API (`edit_boundary_condition`, etc.), but display-capable clients can show a more readable title while still keeping the exact tool name visible.

### Token issuance

A successful declaration produces a token bound to the set of
`(file, before_sha256)` tuples (1 entry for SQLite-derived; 1+N for workflow tools). The server computes each `before_sha256` from disk at declaration time; agents do not supply hashes. The token expires 10 minutes after issuance — operational hygiene only; the single-use binding is the actual integrity guarantee, so the TTL is purely garbage-collection (it keeps the grants/ dir from accumulating abandoned files). The 10-minute window absorbs realistic agent thinking time between the typed_edit call and the native Edit / Write call without weakening the model (v0.3.1: extended from 5 min after dogfood report of mid-edit expiry). Storage is `.meta-edit/state/grants/<token_id>.json`, a protected path.

The grant file also carries optional declaration metadata (`kind`,
`target`, `provenance`, `execution_state`, `target_file`,
`test_files`). This metadata is not authority — the binding tuples
remain the only authorization surface — but it lets the hook emit
kind / target / provenance / execution_state-aware success reminders
after the native write gate is passed. Older grant files without this
metadata remain valid and consumable; `execution_state` is optional on
read (pre-0.7.0 grant files simply omit it).

The result also carries a `next_action` field whenever a token is
issued. It first reminds the agent that the next native `Edit` /
`Write` / `MultiEdit` call against the bound file(s) will be authorized
automatically by the deny-raw-edit hook; the agent passes no extra
parameters. It then appends a `meta-edit reminder:` block generated
from the declaration's `kind`, `target`, `provenance`, and
forward-declared `test_files`. The block is intentionally written as a
short action cue rather than a policy lecture: kind-specific lines seed
the next likely action (`test`, `check`, `run`, `compare`,
`distinguish`, ...), `target: "test"` reminds the agent that a TDD red
step should fail against current production code for the intended
reason, and `target: "prod"` reminds the agent to run the already-
written red test or declare the matching test edit. This is the
strongest pre-write reminder surface: the typed edit tool result is
read before the agent chooses the native write. Per Article 4, the
agent should only have to declare intent; the server takes care of the
bookkeeping (and of telling the agent what comes next). On rejection,
`next_action` is omitted.

> **v0.2.2 fix.** Earlier (v0.2.0 / v0.2.1) revisions of this spec asked the agent to surface the token by passing it as `_meta_edit_token` on the native Edit / Write / MultiEdit call. Claude Code's native edit tools have strict input schemas that reject extra fields, so the framework strips `_meta_edit_token` before the hook ever sees it — making the end-to-end flow unusable. v0.2.2 moves the binding-presence check server-side: the hook scans `.meta-edit/state/grants/` on disk, finds the most-recently-issued unconsumed binding matching the call's canonical `file_path`, and consumes it. The agent never thinks about tokens.

> **v0.2.1 thinning.** Earlier (v0.2.0) revisions of this spec required the agent to supply `before_sha256` and `after_sha256` per binding. Both fields were dropped: under Article 3 (non-adversarial threat model) and Article 4 (descriptions read as a comfortable tool, not a hashing chore), the client-supplied digests added friction without proportional protective value. The server reads disk itself; the hook re-reads disk to detect staleness only.

The MCP server does not analyze the new content. It does not check whether the chosen tool is appropriate for the change. It does not verify the test files exist or contain meaningful tests. None of that. The whole point per Article 4 is that tool descriptions, not server logic, do the work.

### 3.3. Kind × provenance matrices (v0.6.0)

The `provenance` field is required on every declaration, and the
(kind, provenance) cell decides whether the declaration is accepted,
accepted-with-warning, or rejected. The matrices below are the
validation rule.

#### 3.3.1. Base validity of a (kind, provenance) declaration

```
                     u_c    a_a    d_o    inf    spec
edit_progress        OK     OK     OK◎    OK     OK
edit_observation     OK     OK     OK◎    warn   OK
edit_proposal        OK     OK     OK     OK     OK◎
edit_decision        OK◎    OK     OK     REJ    REJ
edit_explanation     OK     OK◎    OK     warn   REJ

(15 SQLite-derived + edit_policy_change impl tools): all OK for every
provenance.
edit_cosmetic: see §3.3.3.
```

`◎` denotes the typical provenance for that kind (description guides
toward it). `warn` lands with an audit warning recorded in
`audit_warnings`; the declaration still issues a grant. `REJ` rejects
the declaration outright with a non-empty `warnings` array.

#### 3.3.2. `additional_files` acceptance matrix

Invoked only when the declaration carries `additional_files` AND the
kind is one of the 5 workflow-axis kinds:

```
                     u_c    a_a    d_o    inf    spec
edit_progress        REJ    REJ    REJ    REJ    REJ
edit_observation     REJ    warn   warn   warn   warn
edit_proposal        warn   ACC    warn   warn   ACC
edit_decision        ACC    ACC    warn   n/a    n/a
edit_explanation     ACC    ACC    ACC    warn   n/a
```

`ACC` = land without warning; `warn` = land with an `additional_files_warn`
in `audit_warnings`; `REJ` = reject the declaration; `n/a` = unreachable
because §3.3.1 already rejects the kind × provenance pair.

When `additional_files` is declared in a warn cell, the rationale MUST
name the unifying theme. When it is declared in an accept cell, the
rationale SHOULD name the theme. (Lint-side: the server records the
warn but does not enforce the rationale-must-name-theme rule beyond
the description-level obligation.)

#### 3.3.3. `edit_cosmetic` provenance matrix

```
                     u_c    a_a    d_o    inf    spec
edit_cosmetic        OK     OK◎    OK◎    REJ    REJ
```

`edit_cosmetic` has zero semantic effect by definition, so epistemic
uncertainty here signals that the kind selection is wrong. Declaring
`inference` or `speculation` on `edit_cosmetic` is rejected — the
agent should re-classify to the workflow kind whose intent matches
(`edit_explanation` for reader-facing clarification, `edit_observation`
for an observed fact, `edit_proposal` for an open question) or to the
kind-specific impl tool whose semantics actually changed.

#### 3.3.4. `accepted_artifact` citation lint

When `provenance: "accepted_artifact"` is declared, the rationale
should carry at least one syntactically-recognizable artifact reference
(`§...`, `ADR-...`, `RFC-...`, `issues/...`, or a URL). The server
lints the rationale and records a `citation_lint_missing` audit
warning if no reference is present. The lint is structure-only — the
server does not verify the artifact exists or that its content matches
the declaration.

### 3.4. Kind × execution_state audit matrix (v0.7.0)

The `execution_state` field is required on every declaration. Unlike
§3.3's (kind, provenance) matrices, there is **no REJ cell** — the
field is `soft + audit warn` per design Q3. Hard rejection would
punish honest declaration and incentivize under-declaration (Article 3
— the lazy agent routes around friction).

```
                                       normal   repeating_failure   recovery
15 SQLite-derived impl + edit_cosmetic    OK           warn             OK
edit_observation                          OK           OK               OK
edit_proposal                             OK           OK               OK
edit_progress                             OK           OK               OK
edit_decision                             OK           OK               OK
edit_explanation                          OK           OK               OK
```

The single `warn` group is the 16 impl tools × `repeating_failure`.
An impl tool is a *fix attempt*; stacking another fix while the loop
is acknowledged is the thing to flag. A `warn` records an
`AuditWarning` with code `execution_state_repeating_failure` into the
edit log's existing `audit_warnings` field and never blocks the
declaration.

**The escape set is `{edit_observation, edit_proposal}`** — the two
recommended moves out of the loop (record the failure / raise a
hypothesis or open question). `repeating_failure × {escape set}` is
deliberately clean. The other three workflow kinds (`edit_progress`,
`edit_decision`, `edit_explanation`) are also clean under
`repeating_failure` because they are not fix attempts, not because
they are escape moves.

`recovery` is a sanctioned state and is clean in every cell.

**Warn semantics are distinct from §3.3.** The §3.3 warnings
(`kind_provenance_warn`, `additional_files_warn`,
`citation_lint_missing`) all describe a *mismatch* — the
declaration's pieces do not cohere. `execution_state_repeating_failure`
is different: a correctly-formed declaration that is a
*self-flagged loop signal*. Both ride the same `audit_warnings` field,
but consumers (e.g. a future `meta-edit summary` warnings breakdown)
MUST group by warning *code*, not pool a single warn count across the
two meanings.

### Multi-kind precedence

If a single change might fit multiple tools, prefer the more specific:

- `edit_permission_logic` over `edit_boolean_condition` / `edit_boundary_condition`
- `edit_retry_timeout` over generic `edit_boundary_condition`
- `edit_external_side_effect` over generic `edit_error_handling` for failure-side-effect interactions
- `edit_data_migration` over generic `edit_db_schema` when existing data is being modified
- `edit_policy_change` over any ordinary code tool when the change touches `meta-edit` configuration, hooks, or tool descriptions

A change that spans multiple kinds and cannot be safely split should choose the highest-risk applicable tool and mention secondary aspects in `rationale`.

---

## 4. The twenty-one tool descriptions

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

### `edit_cosmetic`

```
Surface-level edit with no semantic effect and no information change:
whitespace, formatter output, or comment edits that do not change the
information content of the comment.

Use this tool when, and ONLY when, the patch is one of the following:
- Whitespace adjustment (indentation, blank lines, trailing whitespace,
  line breaks)
- Comment edits that change NO information content (typo fix,
  line-break reflow within a comment block, formatter-driven comment
  reformatting). Comments that add or change information go through the
  workflow kind that matches the comment's intent — `edit_explanation`
  for reader-facing clarification, `edit_observation` for
  observed-fact notes (`// XXX ...`, stale-comment deletions),
  `edit_proposal` for open questions (`// TODO ...`,
  `// FIXME ...`).
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
Declare `target: "prod"` for cosmetic edits to production files, or
`target: "test"` for cosmetic edits to test files. Cosmetic changes
do not require behavioral tests in either case; `test_files` may be
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

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

Provenance combinations (cosmetic-specific):
This tool accepts only `user_confirmed`, `accepted_artifact`, and
`direct_observation`. Declaring `inference` or `speculation` here
is rejected. cosmetic has zero semantic effect, so epistemic uncertainty
is a structural signal that the kind selection is wrong: the patch
likely adds or changes information (in which case use the matching
workflow kind) or changes behavior (in which case use the kind-specific
impl tool). Re-classify before retrying.

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

Target (required):
Declare `target: "prod"` when editing the production boundary itself,
or `target: "test"` when editing the boundary tests (the file pointed
at by your earlier target: prod declaration's `test_files`). One
declaration covers one target — pair a target: prod call with a
target: test call to land both within the same commit. When target is
"test", `target_file` IS the test file and `test_files` must be
empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

If the boolean change is purely a transformation that preserves truth
values (e.g., De Morgan's law applied), it still goes through this tool —
the rewritten bytes affect future readers and modifiers, so the kind-
specific risk surface still applies. edit_cosmetic is reserved for
whitespace / comments / formatter output only and does NOT cover boolean
restructuring.

Target (required):
Declare `target: "prod"` when editing the conditional logic in
production code, or `target: "test"` when editing the boolean tests
that exercise it. Pair the two declarations in the same commit. When
target is "test", `target_file` IS the test file and `test_files`
must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the state machine in production
code, or `target: "test"` when editing its transition tests. Pair the
two declarations in the same commit. When target is "test",
`target_file` IS the test file and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the migration / DDL itself, or
`target: "test"` when editing the migration tests (apply / data /
rollback / constraint tests). Pair the two declarations in the same
commit. When target is "test", `target_file` IS the test file and
`test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the migration / backfill script
itself, or `target: "test"` when editing the migration tests
(idempotency, partial failure, fixture transformation, edge cases). Pair
the two declarations in the same commit. When target is "test",
`target_file` IS the test file and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the API surface in production
code (handlers, schemas, OpenAPI / GraphQL / gRPC definitions), or
`target: "test"` when editing the contract tests (backward
compatibility, missing/extra field, status code). Pair the two
declarations in the same commit. When target is "test", `target_file`
IS the test file and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the serializer / parser / codec
itself, or `target: "test"` when editing its round-trip / old-format /
invalid-input tests. Pair the two declarations in the same commit. When
target is "test", `target_file` IS the test file and `test_files`
must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing error-handling code in
production, or `target: "test"` when editing the tests that exercise
failure paths and observable-error contracts. Pair the two declarations
in the same commit. When target is "test", `target_file` IS the test
file and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the retry / timeout / backoff
logic in production code, or `target: "test"` when editing its
exhaustion / duplicate-side-effect / success-on-retry tests. Pair the
two declarations in the same commit. When target is "test",
`target_file` IS the test file and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the concurrency primitives in
production code, or `target: "test"` when editing the concurrency
tests. Pair the two declarations in the same commit. When target is
"test", `target_file` IS the test file and `test_files` must be
empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the side-effect-producing code
in production, or `target: "test"` when editing its tests (fires-on-
success, no-fire-on-failure, idempotency, correct recipient). Pair the
two declarations in the same commit. When target is "test",
`target_file` IS the test file and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing cache key / TTL / invalidation
code in production, or `target: "test"` when editing its tests
(stale-data prevention, invalidation triggers, TTL boundary, key
collision). Pair the two declarations in the same commit. When target
is "test", `target_file` IS the test file and `test_files` must be
empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing permission / authz code in
production, or `target: "test"` when editing the allow / deny matrix
tests and negative-side-effect tests. Pair the two declarations in the
same commit. When target is "test", `target_file` IS the test file
and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the manifest / config in
production, or `target: "test"` when editing tests that exercise the
new configuration (reproducibility, default value, new-config behavior).
Pair the two declarations in the same commit. When target is "test",
`target_file` IS the test file and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

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

Target (required):
Declare `target: "prod"` when editing the policy / configuration /
description files themselves, or `target: "test"` when editing tests
that exercise the new policy (validity, readability of existing log
entries, clean-checkout applicability). Pair the two declarations in
the same commit. When target is "test", `target_file` IS the test
file and `test_files` must be empty.

Provenance (required):
Declare the epistemic source of this edit. Pick exactly one of:
- `user_confirmed` — the user explicitly stated this in the current
  session. Quote or summarize the user's instruction in the rationale.
  Do not select this when you "feel" the user would agree.
- `accepted_artifact` — based on an accepted spec / ADR / test / API.
  The rationale MUST include at least one artifact reference
  (`§...`, `ADR-...`, `issues/...`, `RFC-...`, or a URL); the
  server lints this and warns if no reference is present. Where natural,
  quote the artifact in the prose itself, not only in the rationale.
- `direct_observation` — observed from execution, logs, or code you
  just read. Make the observation source visible in the prose ("Running
  X produced Y", "I observed that ...", "src/foo.ts:42 reads ...") so
  future readers can re-verify.
- `inference` — reasoned from observation, not directly observed.
  Frame the inference explicitly in the prose ("Based on observed X, it
  appears that ...", "Likely ...", "Probably ..."). Do not write
  inferences as if they were confirmed.
- `speculation` — an unverified hypothesis. Open the prose with strong
  hedging ("**Unverified**: ...", "**Hypothesis**: ...", "TODO:
  verify — ..."). The reader sees the prose, not the provenance field.

The prose-uncertainty obligation is load-bearing: a later session that
reads this file picks up the hedging language directly, with no
structural-marker machinery in the loop.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

General principles (apply to every edit):
- Keep the code simple. Prefer three similar lines over a premature abstraction.
- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.
```

---

### Five workflow-axis kinds (v0.6.0)

The five workflow-axis kinds replace v0.5.x's single `edit_docs_only`.
They classify documentation / planning edits by the intent of the
current session moment, not by file path. Verbatim text mirrors
`src/tools/descriptions.ts` per CLAUDE.md §4; here we summarize the
shapes and route to that file for the full bodies.

Every workflow-axis tool:

- carries no `target` field (workflow content is not bound to the
  prod/test axis)
- requires no `test_files` (workflow content is not tested in the
  impl-tool sense; `test_files` must be empty)
- MAY carry `additional_files`, with per-cell acceptance per §3.3.2
- carries the same required `provenance` field as every other tool
- carries the standard `PROVENANCE_FOOTER` block + `EXECUTION_STATE_FOOTER`
  block + a kind-specific `Provenance combinations` paragraph spelling
  out reject / warn cells

#### `edit_progress`

Record what was actually done, tried, or observed in the current
session — a session work-log entry. Typical target:
`IMPLEMENTATION-LOG.md`. Rejects `additional_files` in every cell.
All five provenance values accepted; the typical value is
`direct_observation`. Inference / speculation lands but the prose
obligation is strict (the body must carry hedging language; a
work-log entry written in speculative provenance whose prose reads as
confirmed is the exact "past-chat looks like a decision" failure this
refactor prevents).

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

#### `edit_observation`

Record an observation, surprise, finding, or gotcha — content that
outlives the session. Typical targets: `OBSERVED-FAILURES.md`, code
comments that flag known-bad patterns (`// XXX ...`, `// HACK ...`),
stale-comment deletions. Rejects `additional_files` for
`user_confirmed`; warns for the other four provenance values.
`edit_observation + inference` lands with a `kind_provenance_warn`
audit signal — re-route to `edit_proposal` if the body reads as "this
is what I think given what I saw". Implementing detectors for the
observed pattern is OUT of scope per Article 7.

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

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

#### `edit_proposal`

Raise a proposal, question, or open issue — content meant to start or
continue a deliberation about what to do. Typical targets: files
under `issues/`, RFC drafts under `docs/plan/`, ADR drafts, code
comments that open a question (`// TODO ...`, `// FIXME ...`).
Accepts `additional_files` for `accepted_artifact` and `speculation`
(audit-driven issue burst, exploratory feature kickoff); warns for
the other three provenance values. All five provenance values
accepted at the base level; the typical value is `speculation`. When
provenance is `speculation`, the prose MUST open with strong hedging.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

#### `edit_decision`

Record a decision that has already been made. Typical targets:
accepted ADRs, CHANGELOG entries for releases this commit actually
cuts, release-commit batches that update CHANGELOG + version +
plugin manifests in one place. Accepts `additional_files` for
`user_confirmed` and `accepted_artifact`; warns for
`direct_observation`. The base validity matrix rejects `inference`
and `speculation` (decisions are confirmed by their nature; treating
an inference or hypothesis as a decision is the exact misclassification
the workflow-axis split is meant to surface). The typical provenance
is `user_confirmed`.

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

#### `edit_explanation`

Explain or document known facts for a reader. Typical targets: README
files (and their translations), `docs/`, JSDoc / docstrings, API
documentation, code comments whose purpose is to explain how a thing
works (`/** function does X */`). Accepts `additional_files` for
`user_confirmed`, `accepted_artifact`, and `direct_observation`
(multilingual sync, spec-driven sweep, impl/doc sync); warns for
`inference`. The base validity matrix rejects `speculation`
(explanations are contracts with future readers; speculative
explanations mislead more than they clarify). The typical provenance
is `accepted_artifact` (the explanation is derived from an accepted
spec, ADR, or API contract; quote the artifact in the rationale and,
where natural, in the prose).

Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- `normal` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- `repeating_failure` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- `recovery` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.

The full verbatim descriptions live in `src/tools/descriptions.ts`.
Per CLAUDE.md §4 the spec text above must move in lockstep with the
descriptions; the SQLite-style `Use this tool when`, `MUST NOT`,
`additional_files cardinality`, `Provenance combinations`, and
`General principles` blocks in `descriptions.ts` are the
verbatim authority for what the agent reads.

### `edit_docs_only` (legacy, v0.5.x and earlier)

`edit_docs_only` was retired in v0.6.0 (see §4 above). The write path
rejects new calls naming it; the read path (`meta-edit log`,
`meta-edit summary`) surfaces legacy entries in a dedicated
`legacy: edit_docs_only` bucket so audit continuity is preserved.

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

  # Pre-condition read FIRST so the disk sha can both steer grant
  # selection (anti-hijack) and categorize the deny. An absent file
  # reads as "" (a declaration against a not-yet-created file binds
  # sha256("")); any other read failure fails closed.
  disk_content = read(file_path) if exists(file_path) else b""
  disk_sha = sha256(disk_content)

  match = grants.findActiveBindingForFile(file_path,
                                          preferBeforeSha=disk_sha)
  if match is None:
    return deny("[meta-edit:undeclared] ...")
  if disk_sha != match.binding.before_sha256:
    return deny("[meta-edit:stale] ...")

  grants.consume(match.grant.token_id, file_path)   # cross-process locked
  appendConsumed(edit_log, { edit_id, consuming_tool, ts })
  return no_permission_decision(
    additionalContext=success_reminder(match.grant.declaration)
  )
```

`findActiveBindingForFile` scans every grant file in
`.meta-edit/state/grants/`, skips expired entries and bindings already
in `consumed_files`. Selection: when `preferBeforeSha` is supplied and
any candidate's `before_sha256` matches the current disk, selection is
restricted to those candidates, so an interleaved **later** declaration
(whose `before_sha256` reflects a different disk state) cannot hijack
this file's pending write. Within the chosen set the most-recently-
issued grant wins (LIFO).

`grants.consume` is serialized by an in-process mutex **and** a
cross-process O_EXCL advisory lock keyed per grant file (v0.4.2). The
hook is a fresh single-shot process per native edit; without the
cross-process lock, N parallel native writes against one multi-file
grant race the grant file's `consumed_files` read-modify-write and only
one survives. The lock is best-effort and bounded: a lock older than a
staleness window is presumed orphaned and stolen; on lock-acquire
timeout the consume proceeds without the lock rather than deny a
legitimate write (the residual race under pathological contention is
accepted under Article 3 — silently denying the agent is worse).

Deny reasons are **categorized** with a `[meta-edit:<category>]`
prefix — `path-mismatch`, `unreadable`, `undeclared`, `stale`,
`expired`, `consumed`, `consume-failed` — and surface the computed
canonical path and `repoRoot` so a path/root divergence is
diagnosable from the transcript.

The pre-condition check is **staleness detection**, not a TOCTOU
defense: it catches declarations made against a prior disk state but
does not eliminate the residual race between hook approval and the
native write. The residual race is accepted under the threat model in
Article 3.

> **v0.2.2 fix.** The v0.2.0 / v0.2.1 hook required the agent to surface the token by passing it as `_meta_edit_token` on the native Edit / Write / MultiEdit call. Claude Code's native edit tools have strict input schemas that reject extra fields, so the framework strips `_meta_edit_token` before the hook sees it — making the end-to-end flow unusable. v0.2.2 moves the binding-presence check entirely server-side: the agent makes a normal native call after `typed_edit`, and the hook resolves the active declaration on its own by file path. The constitutional principles (Article 5: declaration → presence-check → consume) are unchanged; only the implementation of the presence-check changed.

> **v0.2.1 thinning + v0.3.0 NotebookEdit re-allow.** A v0.2.0 draft of this hook also performed a `simulate(toolName, toolInput, disk_content)` replay and compared `sha256(proposed) == bound.after_sha256`. Per Article 3 (non-adversarial) and Article 4 (descriptions as comfortable tools), the post-condition check was friction without proportional value: it required client-supplied `after_sha256`, a per-tool replay engine in the hook, and a `NotebookEdit` UNSUPPORTED branch. All three were removed. v0.2.1 then policy-denied NotebookEdit at gate time as a placeholder until cell-semantics could be re-evaluated; v0.3.0 (issue 0105-notebookedit) lifts that deny because the staleness check on `before_sha256` operates on byte content (the `.ipynb` JSON file as a whole) and is well-defined regardless of cell semantics. NotebookEdit now routes through the same canonicalize → grant → consume → before_sha256 flow as Edit / Write / MultiEdit. The single load-bearing pre-condition remains the byte-level staleness check.

Read-only tools (Read, Grep, Glob, Bash without writes, ...) do not consume tokens; the agent may freely interleave them between declaration and consumption, bounded only by the token's TTL.

When the hook authorizes the native write internally (i.e. after the grant preconditions pass), it appends a `consumed` record to `.meta-edit/state/edits.jsonl` (see §6). The record captures meta-edit grant authorization, not native write completion — the actual write success is git's job to verify, and under Article 3's friendly-AI threat model, write failures after hook approval are rare and recoverable.

If the consumed grant carries declaration metadata, the hook also
returns model-facing `additionalContext` containing a `meta-edit
reminder:` block, but deliberately omits `permissionDecision`. This
preserves the user's normal Claude Code permission mode: returning
`permissionDecision: "allow"` would skip the permission prompt. The
block is generated from the declaration's `kind`, `target`,
`provenance`, and forward-declared tests, using the same self-reminder
wording style as the denial / warn hooks. It also asks the agent to
check whether the chosen kind and file scope still match the actual
edit; if the write crossed another kind or file, the next move is a
fresh typed declaration for that scope. This context is for the
**next** reasoning step: Claude Code places `additionalContext`
alongside the tool result, so it should not be treated as a chance for
the model to reconsider the already-authorized native tool call before
execution. The pre-write reminder remains the typed edit tool's
`next_action` field above.

Other-MCP write paths (e.g. `ctx_execute` writing to disk without going through this hook — see issue 1108) are an acknowledged hook-scope gap. Closing that gap is a future hook expansion (PostToolUse monitoring, MCP-write allowlist), not part of this hook.

### 5.2. deny-bash-write-bypass

Fires on Claude Code's `Bash` tool. Denies write patterns that would route bytes into the repository without going through native Edit/Write:

- **Verb denylist**: `cat >`, `sed -i`, `tee`, `dd of=`, `patch`, `git apply`, ...
- **Heredoc-with-redirect**: `cat <<EOF > target`
- **Inline interpreter writes**: `python -c '...write'`, `node -e '...write'`, `perl -e ...`, `ruby -e ...`, `php -r ...`
- **Decode-and-execute pipelines**: `base64 -d | bash`, `eval "$(...)"`
- **Protected-path writes**: `printf > .meta-edit/state/...` (always denied regardless of redirect target)

The structural redirect-target check (a redirect to a path outside the safe-sink allowlist) is **warned, not denied** since v0.1.5; the verbs `mv`, `cp`, and `rsync` are likewise **warned, not denied** since v0.4.3. In each case the call proceeds with a `permissionDecisionReason` (and model-facing `additionalContext`) nudging the agent toward an `edit_*` tool. `mv`/`cp`/`rsync` were relaxed because they dominate legitimate non-edit dev workflows (rename/move, copy templates/fixtures, backup, deploy/sync) and a hard deny was over-hardening friction under Article 3's non-adversarial threat model; `patch` stays on `deny`. The rest of the verb denylist and **all protected-path checks (`.meta-edit/state/**`, `.meta-edit/tmp/**`) remain `deny` regardless of verb** — `mv payload .meta-edit/state/x` is still denied. See `OBSERVED-FAILURES.md` for the warn→deny restore trigger.

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
 "target":"prod",
 "provenance":"direct_observation",
 "execution_state":"normal",
 "audit_warnings":[],
 "test_files":["tests/foo.test.ts"],
 "binding":[{"file":"src/foo.ts","before_sha256":"..."}],
 "token":"met_20260502_a3f9b2..."}
```

The `target` field is `"prod"` or `"test"` on every impl tool (15 SQLite-derived + `edit_cosmetic`) and is omitted on the 5 workflow-axis kinds (workflow content has its own surface; the prod/test split does not apply). Persisting it on the issued record is what lets audit analysis split a kind's edits into prod vs test rather than collapsing them into a single bucket. The paired `target: "test"` declaration appears as its own `issued` record with the same `kind` and a different `target_file`.

v0.6.0 additions: the issued record carries a required `provenance`
field naming the epistemic source of the edit (one of `user_confirmed`
/ `accepted_artifact` / `direct_observation` / `inference` /
`speculation`), and an optional `audit_warnings` array recording soft
signals from the (kind, provenance) cell matrices (codes:
`kind_provenance_warn`, `additional_files_warn`,
`citation_lint_missing`). Both fields are optional on read so the log
remains backward-compatible with v0.5.x entries; `meta-edit summary`
buckets v0.5.x entries as the `unspecified` provenance and surfaces
legacy `edit_docs_only` entries in a dedicated `legacy:` bucket.

v0.7.0 additions: the issued record also carries an optional
`execution_state` field (one of `"normal"` / `"repeating_failure"` /
`"recovery"`). The field is optional on read — pre-0.7.0 entries omit
it and are bucketed as `(pre-0.7.0)` in `meta-edit summary`'s
execution_state breakdown. When `execution_state: "repeating_failure"`
is declared on any of the 16 impl tools, the `audit_warnings` array
gains the code `execution_state_repeating_failure` (see §3.4). This
code is semantically distinct from the §3.3 mismatch codes —
consumers MUST group by warning code, not pool a single warn count.

The CLI exposes a `--provenance` filter on `meta-edit log` (e.g.
`meta-edit log --provenance speculation,inference` to inspect every
edit that was declared as exploratory).

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

```
meta-edit serve [--repo-root <path>]
```

`--repo-root` (or the `META_EDIT_REPO_ROOT` environment variable)
overrides the repository root; see §3 "Repository root" for the
resolution precedence and why it must match the hooks. Use it when the
launch cwd is not the repository top-level (jj workspace, git worktree,
sub-directory launch).

### `meta-edit log`

Print the contents of `edits.jsonl`, optionally filtered.

```
meta-edit log [--since DATE] [--tool TOOL_NAME] [--provenance VAL[,VAL...]] [--execution-state VAL[,VAL...]] [--limit N]
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

By tool (prod / test counts shown for impl tools):
  edit_boundary_condition      8 (prod 4 / test 4) (17%)
  edit_boolean_condition       8 (prod 4 / test 4) (17%)
  edit_api_contract            6 (prod 3 / test 3) (13%)
  edit_error_handling          6 (prod 3 / test 3) (13%)
  edit_permission_logic        6 (prod 3 / test 3) (13%)
  edit_external_side_effect    4 (prod 2 / test 2) ( 9%)
  edit_cosmetic                4 (prod 3 / test 1) ( 9%)
  edit_explanation             3                   ( 6%)
  edit_progress                2                   ( 4%)
  edit_dependency_config       2 (prod 1 / test 1) ( 4%)
  edit_policy_change           1 (prod 1 / test 0) ( 2%)
  legacy: edit_docs_only       2                   ( 4%)

By provenance:
  user_confirmed       21  (44%)
  accepted_artifact    15  (31%)
  direct_observation    8  (17%)
  inference             3  ( 6%)
  speculation           1  ( 2%)

By execution state:
  normal               43  (91%)
  repeating_failure     2  ( 4%)
  recovery              1  ( 2%)
  (pre-0.7.0)           1  ( 2%)

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
      descriptions.ts       the twenty-one descriptions, verbatim from §4
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

`src/tools/descriptions.ts` contains the twenty-one descriptions from §4 of this document, verbatim. Spec and code MUST stay in sync; any change to either updates both in the same change.

Tool handlers share common logic via helpers, but each tool is registered separately under the MCP server with its own description. Per Article 4, tool selection is the cognitive intervention; the surface is not collapsed into a generic `kind`-parameterized handler.

---

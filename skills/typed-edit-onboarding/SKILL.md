---
name: typed-edit-onboarding
description: Use when starting development work in a project where the meta-edit MCP server is registered, especially on first contact in a new session, when encountering a deny-raw-edit hook denial, or when the typed_edit tool catalog is missing from the agent's tool list. Provides the seventeen-tool surface map and selection heuristic so the agent can pick the right tool before its first edit.
---

# typed_edit onboarding

`meta-edit` is a **test-driven development (TDD) framework** delivered
as an MCP server. It replaces the agent's raw `Edit` / `Write` /
`MultiEdit` / `NotebookEdit` calls with **seventeen kind-specific MCP
tools**. Each tool's description encodes when to use it, when not to
use it, and what tests must accompany the edit — every typed_edit
declaration (except `edit_cosmetic` and `edit_docs_only`) requires
non-empty `test_files` when `target = "prod"`, so writing or updating
tests is a first-class step of every change, not an afterthought. The
bet is that a structured tool surface plus testing obligations encoded
in tool descriptions changes editing behavior — without diff
classification or post-hoc verification.

## Catalog (15 SQLite-derived + edit_cosmetic + 1 workflow)

**SQLite-derived (kind-specific, modify-mode):**
- `edit_boundary_condition` — comparison / threshold / limit / range bound changes
- `edit_boolean_condition` — boolean logic / conditional / guard clause changes
- `edit_state_transition` — state machine / workflow / status changes
- `edit_db_schema` — tables, columns, indexes, constraints, migrations (DDL)
- `edit_data_migration` — backfills / transforms of existing production data
- `edit_api_contract` — request/response shape, endpoints, status codes, schemas
- `edit_serialization` — parsers, codecs, JSON/YAML/XML/Protobuf handlers
- `edit_error_handling` — try/catch, exception propagation, fallback logic
- `edit_retry_timeout` — retry counts, timeouts, backoff, idempotency keys
- `edit_concurrency` — locks, transactions, async, parallelism primitives
- `edit_external_side_effect` — emails, events, webhooks, billing, audit logs
- `edit_cache_invalidation` — cache keys, TTLs, invalidation triggers
- `edit_permission_logic` — authz, roles, ownership, tenancy, feature flags
- `edit_dependency_config` — package deps, runtime config, env vars
- `edit_policy_change` — meta-edit / hooks / CI / build profile flags

**Cosmetic (narrow, non-behavioral):**
- `edit_cosmetic` — whitespace / comments / formatter output ONLY. Renames,
  extracts, dead-code removal etc. are NOT cosmetic; stop and ask if no
  kind-specific tool fits.

**Workflow (batch-friendly, multi-file):**
- `edit_docs_only` — Markdown, README, comments, JSDoc, CHANGELOG, planning docs

## `target: "prod" | "test"` — required on every tool except edit_docs_only

Every impl tool (the 15 SQLite-derived + `edit_cosmetic`) carries a
required `target` field:

- `target: "prod"` — the edit lands in production code. `test_files`
  must be non-empty (except for `edit_cosmetic`) and forward-declares
  the test files the paired `target: "test"` call will modify.
- `target: "test"` — the edit lands in test code. `target_file` IS the
  test file. `test_files` must be empty.

One declaration covers exactly one target. To pair an implementation
change with its tests, issue **two declarations of the same impl
tool** — one with `target: "prod"`, then one with `target: "test"`
— both landing in the same commit. The per-edit granularity makes the
test edit visible inside this kind's audit surface, rather than
disappearing into a generic test bucket.

`edit_docs_only` does NOT carry a `target` field. Documentation has its
own surface and the prod/test split does not apply.

## Selection heuristic

The agent picks the tool that matches *the smallest unit of cognitive
intervention* the change requires. Order of disambiguation:

1. Modifying documentation only (Markdown / README / comments / docstrings
   with no executable production code change)? → `edit_docs_only`.
2. Changing comparisons / thresholds / limits / ranges? → `edit_boundary_condition`.
3. Changing boolean operators / guard clauses / conditional structure? → `edit_boolean_condition`.
4. Changing state machine transitions / status flow? → `edit_state_transition`.
5. Changing how errors / failures propagate? → `edit_error_handling`.
6. Changing retries / timeouts / backoff? → `edit_retry_timeout`.
7. Changing locks / transactions / async primitives? → `edit_concurrency`.
8. Changing external side effects (emails, billing, events)? → `edit_external_side_effect`.
9. Changing cache logic (keys, TTLs, invalidation)? → `edit_cache_invalidation`.
10. Changing authz / roles / feature flags? → `edit_permission_logic`.
11. Changing API request / response shape? → `edit_api_contract`.
12. Changing parser / serializer / codec? → `edit_serialization`.
13. Changing DB schema (DDL)? → `edit_db_schema`.
14. Backfilling / transforming production data? → `edit_data_migration`.
15. Changing package deps / runtime config? → `edit_dependency_config`.
16. Changing build profile / CI / hook config / tool descriptions themselves? → `edit_policy_change`.
17. Whitespace / comment / formatter output ONLY (no rename, no extract,
    no logic change)? → `edit_cosmetic`.

False precision is safer than false generality — when two tools could
apply, choose the more specific one. **If no kind-specific tool fits,
stop and ask the user.** There is no generic refactor catch-all by
design; the absence of one forces the question "what kind of change is
this, really?"

## Editing tests

A test edit is **not** its own kind — it is the test surface of the
impl kind it exercises. To add a boundary test, use
`edit_boundary_condition` with `target: "test"`. To strengthen an API
contract test, use `edit_api_contract` with `target: "test"`. The
risk profile and rationale follow the implementation domain, not a
generic test bucket.

Test infrastructure (fixtures, helpers, mocks) that does not belong to
any single impl kind is currently an open case — stop and ask the user
if no kind-specific tool fits. This is intentional friction: the design
is observing whether a separate tool needs to be added later.

## Empty file creation is free (v0.3.1)

Creating a NEW file with empty content does NOT require a typed_edit
declaration. Just make the native Write with `content === ""`; the
`deny-raw-edit` hook authorizes it directly and auto-creates parent
directories. Then declare an appropriate `edit_<TYPE>` against the
now-empty file for the actual content fill (the file is in modify
mode; `before_sha256 = sha256("")`).

This applies to source files, test files, configs, and Markdown
artifacts (issue files, ADRs, design docs). Each gets the typed
intervention from its content-fill declaration, not from a separate
"create" act.

## Recovery: when the typed_edit schemas aren't loaded

If the seventeen `edit_*` tools are not visible in your tool list (the
harness deferred them, the MCP server connected late, or your session
started outside a meta-edit project), use **ToolSearch** to load the
schemas you need:

```
ToolSearch query: "select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic"
```

Or a keyword search:

```
ToolSearch query: "mcp meta-edit edit_state_transition"
```

ToolSearch is the harness-native way to load deferred MCP schemas into
the callable surface. `meta-edit -h` (CLI) prints the verbatim
descriptions for human inspection but does NOT populate the agent's
tool list.

## `additional_files` (workflow-tool batches)

Only `edit_docs_only` accepts `additional_files` for sweeping multi-file
edits (e.g. renaming a deprecated API across 10 README references in
one declaration). Cap is 32 entries. SQLite-derived tools MUST NOT
include `additional_files` — per-tool cognitive intervention assumes
one declaration per change.

**`edit_docs_only` supports consecutive editing across the batch.**
One `edit_docs_only` declaration binds `target_file` + every
`additional_files` entry under a single grant. You then issue
*consecutive* native Edit / Write calls against the bound files **in
any order — one per bound file — without re-declaring per file**,
until every bound file is consumed or the 10-minute TTL expires. This
is the one tool where a single declaration covers many native edits;
the impl tools are strictly one declaration → one native edit per file
(see "Single-use binding" below).

## Things to keep in mind

- **Single-use binding**: each typed_edit declaration authorizes ONE
  native Edit / Write per bound file. After consumption, re-declare
  for further edits to the same file. Exception: `edit_docs_only`
  binds a whole batch under one declaration and authorizes one native
  edit per bound file — consecutive edits across the batch, in any
  order, no per-file re-declaration (see "`additional_files`" above).
- **TTL is 10 minutes** post-issuance. Garbage-collection only — the
  single-use property is the integrity guarantee.
- **Out-of-repo writes pass through**: the hook is repo-scoped. Plan
  files in `~/.claude/plans/`, scratch in `/tmp/`, other-plugin writes
  outside this repo — all authorized without typed_edit.
- **The descriptions are the product.** When in doubt, read the full
  description via `meta-edit -h <tool_name>` or ToolSearch and follow
  its required-tests / MUST-NOT clauses literally.

See `docs/SPEC.md` (Articles 1–8 + §4 per-tool descriptions) for the
constitutional and verbatim authority.

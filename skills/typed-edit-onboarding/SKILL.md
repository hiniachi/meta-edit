---
name: typed-edit-onboarding
description: Use when starting development work in a project where the meta-edit MCP server is registered, especially on first contact in a new session, when encountering a deny-raw-edit hook denial, or when the typed_edit tool catalog is missing from the agent's tool list. Provides the eighteen-tool surface map and selection heuristic so the agent can pick the right tool before its first edit.
---

# typed_edit onboarding

`meta-edit` replaces the agent's raw `Edit` / `Write` / `MultiEdit` /
`NotebookEdit` calls with **eighteen kind-specific MCP tools**. Each
tool's description encodes when to use it, when not to use it, and what
tests must accompany the edit. The bet is that a structured tool surface
plus testing obligations encoded in tool descriptions changes editing
behavior — without diff classification or post-hoc verification.

## Catalog (17 SQLite-derived + 1 workflow)

**SQLite-derived (kind-specific, modify-mode):**
- `edit_refactor_only` — rename / extract / reformat without changing observable behavior
- `edit_test_only_change` — add or modify test code only
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

**Workflow (batch-friendly, multi-file):**
- `edit_docs_only` — Markdown, README, comments, JSDoc, CHANGELOG, planning docs

## Selection heuristic

The agent picks the tool that matches *the smallest unit of cognitive
intervention* the change requires. Order of disambiguation:

1. Touching production code? **No** → `edit_test_only_change`,
   `edit_docs_only`, or `edit_dependency_config` / `edit_policy_change`
   per file role.
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
17. Pure rename / extract / reformat that preserves observable behavior? → `edit_refactor_only`.

False precision is safer than false generality — when two tools could
apply, choose the more specific one. Misusing `edit_refactor_only` is
the largest source of regression bugs.

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

If the eighteen `edit_*` tools are not visible in your tool list (the
harness deferred them, the MCP server connected late, or your session
started outside a meta-edit project), use **ToolSearch** to load the
schemas you need:

```
ToolSearch query: "select:mcp__plugin_meta-edit_meta-edit__edit_refactor_only"
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

## Things to keep in mind

- **Single-use binding**: each typed_edit declaration authorizes ONE
  native Edit / Write per bound file. After consumption, re-declare
  for further edits to the same file.
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

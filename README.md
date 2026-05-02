# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**Languages:** **English** · [日本語](./README.ja.md) · [简体中文](./README.zh-CN.md)

> An MCP server that replaces a coding agent's generic file-edit tool with **nineteen kind-specific edit tools**, each encoding the testing obligations for that kind of change directly in its tool description.

**破壊的な変更を実施中なので、v0.1.5を推奨**

## Why typed edits?

Instructions in `CLAUDE.md` decay across turns. Skills only fire when the agent decides to invoke them. Both rely on text the model *might* re-read — neither has structural force at the moment of action.

Tool definitions don't decay. The schema and description of the tool the agent is about to call are loaded at every invocation. Instead of hoping the agent remembers "add boundary tests", `meta-edit` splits the single `Edit` primitive into nineteen kind-specific tools, each carrying — in its own description — when to use it, when not to use it, what tests must accompany the edit, and when to stop and ask the user.

The bet: **the shape of the tool surface is what changes AI editing behavior**, not detection or post-hoc verification. The conceptual ancestor is [SQLite's testing strategy](https://sqlite.org/testing.html) — boundary values, MC/DC condition coverage, anomaly testing, per-change checklists — translated from C library quality into application-level edit categories. See [`docs/SPEC.md`](./docs/SPEC.md) for the full specification (Part I constitution + Part II derived spec), and [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md) for the post-v0.2 detection backlog.

Status: `0.2.0` pre-release. v0.2 reframes the mechanism as **declaration + token binding** (per `SPEC.md` Article 5): the MCP server validates declarations and issues short-lived tokens; native `Edit` / `Write` performs the actual writes under the `deny-raw-edit` hook's binding-validation gate. Distributed as a single-plugin Claude Code marketplace (this repo) and as the `@hiniachi/meta-edit` npm package (not yet published).

## The nineteen tools

```
edit_refactor_only            edit_test_only_change
edit_boundary_condition       edit_boolean_condition
edit_state_transition         edit_db_schema
edit_data_migration           edit_api_contract
edit_serialization            edit_error_handling
edit_retry_timeout            edit_concurrency
edit_external_side_effect     edit_cache_invalidation
edit_permission_logic         edit_dependency_config
edit_policy_change            edit_docs_only
edit_create_file
```

Each tool description specifies:

- when to use it,
- when not to use it,
- which tests must accompany the edit,
- when to stop and ask the user.

## Observed: the agent stops and asks

The first time `meta-edit` was self-applied to its own repository, with the conversation context already ~80% full, an `OBSERVED-FAILURES.md` append was requested. None of the (then) seventeen tools cleanly matched a documentation-only edit. Instead of stretching one to fit, the agent paused:

> OBSERVED-FAILURES.md is a docs file and matches none of the seventeen `edit_*` tools strictly (descriptions assume "production code" / "test files" / "policy/governance"). CLAUDE.md §9 says "no edit_* tool fits, stop and ask." Two options: (a) stretch `edit_refactor_only` — its MUST-NOT list (operator / guard / return-shape) trivially passes for prose, and the "no observable behavior change" intent is satisfied; (b) `/plugin disable meta-edit` and use raw `Edit`. Which do you prefer?

Three things worth noting:

1. The "stop and ask" instruction was honoured at 80% context — exactly when `CLAUDE.md`-style instructions normally decay.
2. The agent identified the spec gap in its own terms ("seventeen tools don't cover docs files").
3. It produced the v0.2 entry that subsequently became the eighteenth tool, `edit_docs_only`.

Tool-shaped instructions read at every call won out over text-shaped instructions read once at session start. (This very README was rewritten through `edit_docs_only`.)

## Install

### Option A: Claude Code Plugin marketplace

This repository **is** a single-plugin marketplace. Add it once, then
install meta-edit:

```sh
/plugin marketplace add hiniachi/meta-edit
/plugin install meta-edit@meta-edit
```

That auto-registers the meta-edit MCP server (the nineteen `edit_*`
tools) and the two safety hooks (`deny-raw-edit`,
`deny-bash-write-bypass`). The plugin runs prebuilt JavaScript shipped
under `dist/` — Node 20+ is the only runtime requirement; no Bun, no
`npm install`, no build step on the consumer side.

#### Refreshing to a newer version

`/plugin install` reuses the marketplace clone Claude Code already has
on disk. After a new meta-edit release lands on `main`, the local clone
can lag — `/plugin install meta-edit@meta-edit` will keep installing
the previous commit's `dist/` until the clone is refreshed. To pick up
the latest version:

```sh
git -C ~/.claude/plugins/marketplaces/meta-edit pull origin main
rm -rf ~/.claude/plugins/cache/meta-edit
/plugin install meta-edit@meta-edit
/reload-plugins
```

Verify by checking
`~/.claude/plugins/marketplaces/meta-edit/.claude-plugin/plugin.json`'s
`version` field. (Option B users with the npm-installed binary on
`PATH` can also run `meta-edit --version`.) Tracked upstream as a
Claude Code limitation; this section will go away once `/plugin
install` performs an automatic fetch.

### Option B: npm package

```sh
npm install -g @hiniachi/meta-edit
# then enable the safety hooks
meta-edit install-hooks --scope user
```

Or per-project:

```sh
npm install --save-dev @hiniachi/meta-edit
meta-edit install-hooks --scope project
```

Add the server to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "meta-edit": { "command": "meta-edit", "args": ["serve"] }
  }
}
```

## Runtime requirements

- **Node 20 LTS or newer** on the consumer side. The plugin and the npm bin both invoke `node` against the prebuilt `dist/cli.js` shipped in the package.
- POSIX shell environment for the bash-write-bypass hook. Windows is not currently a target.
- Bun is used only for development and CI (`bun run build`, `bun test`); consumers do not need it installed.

## Commands

```
meta-edit serve                                          Run the MCP stdio server
meta-edit log [--tool NAME] [--risk LEVEL] [--since DATE]  Print edits.jsonl entries
meta-edit summary [--since DATE]                         Aggregate statistics from the edit log
meta-edit install-hooks --scope user|project             Install Claude Code hooks into settings.json
meta-edit uninstall-hooks --scope user|project           Remove Claude Code hooks from settings.json
```

### Examples

```sh
# Show all edits to billing code that landed since the start of April:
meta-edit log --tool edit_boundary_condition --since 2026-04-01

# Show high-risk and critical edits only:
meta-edit log --risk high
meta-edit log --risk critical

# Aggregate summary for the last seven days (date in YYYY-MM-DD or any ISO 8601 form):
meta-edit summary --since 2026-04-23

# Install hooks for the current project (writes .claude/settings.json):
meta-edit install-hooks --scope project

# Install hooks for the user (writes ~/.claude/settings.json):
meta-edit install-hooks --scope user
```

## Edit log

Each typed_edit call produces up to two JSONL lines in `.meta-edit/state/edits.jsonl`. The schema follows [`SPEC.md` §6](./docs/SPEC.md):

1. **`issued`** — written when the MCP server accepts the declaration and issues a token:

   ```json
   {"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:00+09:00","phase":"issued","kind":"edit_boundary_condition","target_file":"src/billing/charge.ts","rationale":"Allow exact-balance charges by changing < to <=","risk_level":"high","test_files":["tests/billing/charge.test.ts"],"binding":[{"file":"src/billing/charge.ts","before_sha256":"…"}],"token":"met_20260502_a3f9b2…"}
   ```

2. **`consumed`** — written when the `deny-raw-edit` hook authorizes the corresponding native Edit / Write call (PreToolUse, before the write executes):

   ```json
   {"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:02:43+09:00","phase":"consumed","consuming_tool":"Edit"}
   ```

Validation rejections produce a single `phase: "rejected"` entry with a non-empty `audit_error`. The patch body is **not** stored — your VCS history is the source of truth. An `issued` record without a `consumed` sibling is evidence of an abandoned or expired declaration.

## CI integration

A reference workflow at [`examples/.github/workflows/meta-edit-summary.yml`](./examples/.github/workflows/meta-edit-summary.yml)
runs `meta-edit summary` on every PR and uploads the report as a build
artifact. Drop it into your own repo's `.github/workflows/` directory.

## Support

If `meta-edit` saves you time or prevents a bad edit, please consider buying the author a coffee:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

Your support helps fund:

- New `edit_*` categories based on observed AI failure modes
- The optional future lightweight diff classifier as a backstop if descriptions prove insufficient (see [`SPEC.md` Article 2](./docs/SPEC.md))
- Tighter Claude Code Plugin integration

## License

MIT. See [`LICENSE`](./LICENSE).

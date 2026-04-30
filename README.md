# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**Languages:** **English** · [日本語](./README.ja.md) · [简体中文](./README.zh-CN.md)

> An MCP server that replaces a coding agent's generic file-edit tool with **eighteen kind-specific edit tools**, each encoding the testing obligations for that kind of change directly in its tool description.

The bet: tool design — not detection, not verification — is what changes AI editing behavior. See [`docs/SPEC.md`](./docs/SPEC.md) for the full specification.

## Status

`0.1.0` — pre-release. All core components are in place: eighteen
`edit_*` MCP tools, two PreToolUse safety hooks, append-only edit log
at `.meta-edit/state/edits.jsonl`, and the CLI. See
[`docs/SPEC.md`](./docs/SPEC.md) for the contract and
[`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md) for known v0.2 work.

Distributed as a single-plugin Claude Code marketplace (this repo) and
as the `@hiniachi/meta-edit` npm package. Not yet published to npm.

## The eighteen tools

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
```

Each tool description specifies:

- when to use it,
- when not to use it,
- which tests must accompany the edit,
- when to stop and ask the user.

## Install

### Option A: Claude Code Plugin marketplace

This repository **is** a single-plugin marketplace. Add it once, then
install meta-edit:

```sh
/plugin marketplace add hiniachi/meta-edit
/plugin install meta-edit@meta-edit
```

That auto-registers the meta-edit MCP server (the eighteen `edit_*`
tools) and the two safety hooks (`deny-raw-edit`,
`deny-bash-write-bypass`). Requires [Bun](https://bun.sh) on PATH —
the plugin runs the TypeScript sources directly without a build
step.

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

## Runtime

Source is published as TypeScript and runs unchanged on:

- Bun 1.x (preferred, used in development and CI)
- Node 20 LTS (`node` invokes the dist build; `bun` runs the source directly)

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

Every `edit_*` call appends one JSONL line to `.meta-edit/state/edits.jsonl`,
whether the call succeeded, was rejected by validation, or failed during
apply. The schema follows [`SPEC.md` §6](./docs/SPEC.md):

```json
{"edit_id":"edit_20260427_0001","timestamp":"2026-04-27T10:15:00+09:00","tool_name":"edit_boundary_condition","target_file":"src/billing/charge.ts","rationale":"Allow exact-balance charges by changing < to <=","risk_level":"high","test_files":["tests/billing/charge.test.ts"],"patch_size_bytes":432,"applied":true,"warnings":[]}
```

The patch body is **not** stored. If you need it, your VCS history is
the source of truth.

## CI integration

A reference workflow at [`examples/.github/workflows/meta-edit-summary.yml`](./examples/.github/workflows/meta-edit-summary.yml)
runs `meta-edit summary` on every PR and uploads the report as a build
artifact. Drop it into your own repo's `.github/workflows/` directory.

## Support

If `meta-edit` saves you time or prevents a bad edit, please consider buying the author a coffee:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

Your support helps fund:

- New `edit_*` categories based on observed AI failure modes
- The optional v0.2 lightweight diff classifier (see [`SPEC.md` §11](./docs/SPEC.md))
- Tighter Claude Code Plugin integration

## License

MIT. See [`LICENSE`](./LICENSE).

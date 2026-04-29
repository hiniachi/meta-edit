# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**Languages:** **English** · [日本語](./README.ja.md) · [简体中文](./README.zh-CN.md)

> An MCP server that replaces a coding agent's generic file-edit tool with **seventeen kind-specific edit tools**, each encoding the testing obligations for that kind of change directly in its tool description.

The bet: tool design — not detection, not verification — is what changes AI editing behavior. See [`docs/SPEC.md`](./docs/SPEC.md) for the full specification.

## Status

Pre-release. Phase 1 skeleton is in place; tools register but do not yet apply patches.

## The seventeen tools

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

Each tool description specifies:

- when to use it,
- when not to use it,
- which tests must accompany the edit,
- when to stop and ask the user.

## Install

### Option A: Claude Code Plugin marketplace

Once published:

```sh
/plugin install meta-edit
```

This auto-registers the MCP server and the two safety hooks
(`deny-raw-edit`, `deny-bash-write-bypass`).

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
meta-edit serve              Run the MCP stdio server
meta-edit log [filters]      Print edits.jsonl entries
meta-edit summary            Aggregate statistics from the edit log
meta-edit install-hooks      Install Claude Code hooks into settings.json
meta-edit uninstall-hooks    Remove Claude Code hooks from settings.json
```

## Support

If `meta-edit` saves you time or prevents a bad edit, please consider buying the author a coffee:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

Your support helps fund:

- New `edit_*` categories based on observed AI failure modes
- The optional v0.2 lightweight diff classifier (see [`SPEC.md` §11](./docs/SPEC.md))
- Tighter Claude Code Plugin integration

## License

MIT. See [`LICENSE`](./LICENSE).

# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**Languages:** **English** · [日本語](./README.ja.md) · [简体中文](./README.zh-CN.md)

> An MCP server that replaces a coding agent's single `Edit` tool with
> **twenty-one kind-specific edit tools**. Each tool carries — in its own
> description — the testing obligations for that kind of change. The 16
> impl tools additionally carry a required `target: "prod" | "test"`
> flag so test edits are visible inside their kind's audit surface.

For the long-form explanation, with applications beyond editing, see the
[project page](https://hiniachi.github.io/meta-edit/).

## The idea

`CLAUDE.md`, Skills, system prompts, and review checklists are all texts
the model *might* re-read. They drift out of attention as the conversation
grows. By the time the agent calls `Edit`, those instructions have
effectively expired.

One surface is different. The **schema and description** of the tool the
agent is about to call are loaded *at every invocation*, immediately before
the call. They are the only place where an instruction is guaranteed to be
in front of the model at the moment of action.

`meta-edit` puts obligations there. A single generic `Edit` is too coarse —
you cannot write "produce a boundary test when changing `<` to `<=`" on it
without also misfiring on a typo fix. So we split: `Edit` becomes twenty-one
edits, one per kind of change. The agent must pick a kind before it can
edit. **Picking the kind is the reasoning step.**

The conceptual ancestor is
[SQLite's testing strategy](https://sqlite.org/testing.html) — boundary
values, MC/DC condition coverage, anomaly testing, per-change checklists —
translated from C-library quality discipline into application-level edit
categories.

## The twenty-one tools

```
edit_cosmetic                 edit_boundary_condition
edit_boolean_condition        edit_state_transition
edit_db_schema                edit_data_migration
edit_api_contract             edit_serialization
edit_error_handling           edit_retry_timeout
edit_concurrency              edit_external_side_effect
edit_cache_invalidation       edit_permission_logic
edit_dependency_config        edit_policy_change
edit_progress
edit_observation
edit_proposal
edit_decision
edit_explanation
```

Each description specifies: when to use it, when *not* to use it, which
tests must accompany the edit, and when to stop and ask the user. The 16
impl tools (everything except the 5 workflow-axis kinds) carry a required
`target: "prod" | "test"` flag — prod/test pairs land as two
declarations of the same tool, both in the same commit.

> **v0.5.0**: the previous `edit_test_only_change` and
> `edit_refactor_only` slots are gone. Test edits flow through the
> kind-specific impl tool with `target: "test"`. `edit_cosmetic`
> replaces `edit_refactor_only` with a much narrower vocabulary
> (whitespace / comments / formatter output only); renames, extracts,
> and dead-code removal route to stop-and-ask instead of a generic
> refactor catch-all.

## What we've observed

When no kind cleanly fits a requested change, the agent **stops and asks**
instead of forcing the change through the nearest tool. We have observed
this at ~80% context utilisation — exactly the regime where `CLAUDE.md`
normally loses its grip. The transcript that led to the workflow tool
The 5 workflow-axis kinds (`edit_progress` / `edit_observation` / `edit_proposal` / `edit_decision` / `edit_explanation`) are on the
[project page](https://hiniachi.github.io/meta-edit/#proof).

## Install

### Claude Code plugin marketplace

This repo *is* a single-plugin marketplace.

```sh
/plugin marketplace add hiniachi/meta-edit
/plugin install meta-edit@meta-edit
```

That auto-registers the MCP server (twenty-one `edit_*` tools) and the two
safety hooks (`deny-raw-edit`, `deny-bash-write-bypass`). The plugin runs
prebuilt JavaScript shipped under `dist/`; **Node 20+ is the only runtime
requirement** — no Bun, no `npm install`, no build step.

To pull a newer marketplace version after a release:

```sh
git -C ~/.claude/plugins/marketplaces/meta-edit pull origin main
rm -rf ~/.claude/plugins/cache/meta-edit
/plugin install meta-edit@meta-edit
/reload-plugins
```

### npm

```sh
npm install -g @hiniachi/meta-edit
meta-edit install-hooks --scope user
```

Then register the server in your MCP configuration:

```json
{
  "mcpServers": {
    "meta-edit": { "command": "meta-edit", "args": ["serve"] }
  }
}
```

### opencode

```sh
npm install -g @hiniachi/meta-edit
meta-edit install-opencode --scope user
```

Writes the MCP server and the `@hiniachi/meta-edit/opencode` plugin into
`opencode.json`. Reference snippet:
[`examples/.opencode/opencode.json`](./examples/.opencode/opencode.json).
Same twenty-one tool descriptions, same audit log, same grant flow as the
Claude Code path.

## Reference

| | |
| --- | --- |
| Full spec (the twenty-one descriptions, declaration + token binding, the protocol) | [`docs/SPEC.md`](./docs/SPEC.md) |
| Edit log schema (`issued` / `consumed` / `rejected` records) | [`docs/SPEC.md` §6](./docs/SPEC.md) |
| Observed failure modes (the v0.2+ backlog) | [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md) |
| CI sample (run `meta-edit summary` on PR) | [`examples/.github/workflows/meta-edit-summary.yml`](./examples/.github/workflows/meta-edit-summary.yml) |
| CLI reference | `meta-edit --help` |

Status: `0.3.1` pre-release. Node 20 LTS+, POSIX shell. Bun is dev-only.

## Support

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

## License

MIT. See [`LICENSE`](./LICENSE).

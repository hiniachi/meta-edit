# Codex Migration Research

Date: 2026-06-17

## Sources

- Local Codex CLI: `codex-cli 0.136.0`
- Codex manual cache: `/tmp/openai-docs-cache/codex-manual.md`
- Plugin creator validator: `/home/nia/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py`
- Local probe by subagent Pascal; no workspace files edited.

## Codex Plugin Packaging

Codex plugins require `.codex-plugin/plugin.json`. The local CLI accepts a
manifest-level `hooks` field, but the skill-local validator rejects it as
unsupported. The implemented package therefore avoids the manifest-level field
and uses Codex's default bundled hook path, `hooks/hooks.json`, inside the
Codex plugin directory.

Local smoke also showed that a marketplace entry cannot point at the
marketplace root itself (`source.path: "./"`). `codex plugin list` only found
the plugin when `source.path` pointed at a subdirectory. The repository
therefore publishes a Codex marketplace catalog at
`.agents/plugins/marketplace.json` that points to `./plugins/meta-edit`, and
`plugins/meta-edit` carries a self-contained copy of `.codex-plugin`,
`.mcp.json`, `hooks/hooks.json`, `codex/hooks.json`, `dist/`, `skills/`, and
`AGENTS.md`.

Accepted manifest fields observed locally include:

- `name`
- `version`
- `description`
- `author`
- `homepage`
- `repository`
- `license`
- `keywords`
- `skills`
- `apps`
- `mcpServers`
- `interface`

Because the validator and CLI differ, do not use manifest-level `hooks` in the
release artifact. `python3 .../validate_plugin.py .` and
`python3 .../validate_plugin.py plugins/meta-edit` both pass with the default
hook file layout.

## Plugin MCP Config

Plugin-bundled MCP config uses top-level `mcpServers` JSON in `.mcp.json`, for
example:

```json
{
  "mcpServers": {
    "meta-edit": {
      "command": "node",
      "args": ["./dist/cli.js", "serve"]
    }
  }
}
```

User/project Codex config still uses TOML under `[mcp_servers.NAME]`.

## Hooks

Manual section: `/tmp/openai-docs-cache/codex-manual.md`, lines
`10353-10596`.

Hook config shape:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "meta-edit-codex-deny-raw-edit",
            "statusMessage": "Checking meta-edit declaration"
          }
        ]
      }
    ]
  }
}
```

Matcher facts:

- `matcher` is a regex string.
- `*`, empty string, or omitted matcher matches all supported occurrences.
- `PreToolUse`, `PostToolUse`, and `PermissionRequest` match on tool name.
- `apply_patch`, `Edit`, and `Write` can all match apply-patch activity.
- `SessionStart` matchers are `startup`, `resume`, `clear`, and `compact`.
- Matching hooks from multiple sources all run.
- Multiple matching command hooks for one event run concurrently.
- Non-managed command hooks must be reviewed and trusted.
- Hook commands run with the session cwd.

No plugin-root environment variable was found locally, and hook commands run
with the session cwd. For npm-installed user/project config,
`install-codex` uses globally installed bin names. For the plugin-bundled hook
file, commands resolve the installed cache path through
`${CODEX_HOME:-$HOME/.codex}/plugins/cache` and execute the bundled `dist`
entrypoint with Node.

## Hook Payload And Output

The public manual did not expose the full stdin/stdout JSON schema. Local binary
strings confirm common input fields such as:

- `hook_event_name`
- `transcript_path`
- `permission_mode`
- `source`
- `turn_id`
- `agent_transcript_path`
- `agent_type`
- `last_assistant_message`
- `prompt`

Local strings also show that Codex parses hook stdout as JSON and supports a
blocking decision requiring a non-empty reason:

- `hook returned decision:block without a non-empty reason`
- `hook returned invalid hook JSON output`
- `Command blocked by PreToolUse hook:`
- `Tool call blocked by PreToolUse hook:`

The implementation uses a tolerant parser around `hook_event_name`,
`tool_name`, `tool_input`, and `cwd`, plus a top-level JSON response shape. The
test suite currently pins deny/block as:

```json
{ "decision": "block", "reason": "..." }
```

and model-visible context as:

```json
{ "additional_context": "..." }
```

## apply_patch Payload

The local Codex MCP server did not expose `apply_patch` as an MCP tool schema.
The generated app-server schema for approval uses:

```ts
type ApplyPatchApprovalParams = {
  conversationId: ThreadId;
  callId: string;
  fileChanges: Record<string, FileChange>;
  reason: string | null;
  grantRoot: string | null;
};
```

`FileChange` variants:

- `{ type: "add", content: string }`
- `{ type: "delete", content: string }`
- `{ type: "update", unified_diff: string, move_path: string | null }`

For the initial migration, `meta-edit` still supports a raw patch string because
current hook payload shape is not fully documented. The supported path is:

- extract `*** Add File:`
- extract `*** Update File:`
- extract `*** Delete File:`
- deny `*** Move to:` rename/move patches
- preflight all targets before consuming any grant

The hook adapter supports both raw patch strings and the observed
`fileChanges` shape. It rejects CR/LF/header injection in file keys and rejects
`move_path` rename/move changes for the first migration.

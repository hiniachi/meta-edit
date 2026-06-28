// `meta-edit help` / `meta-edit -h` / `meta-edit --help` — the recovery
// surface for when tool descriptions never reach the agent's context
// (issue 1530). The agent can run `meta-edit -h` from a Bash tool and
// see the typed-edit catalog; `meta-edit -h <tool_name>` prints the
// verbatim description for that tool.
//
// This module is intentionally a separate file from cli.ts so the
// general usage block stays small and the tool-catalog rendering can
// grow independently. Hook deny reasons reference `meta-edit -h` as the
// recovery hint, so the surface here is load-bearing for adoption-flow
// correctness.

import { TOOL_NAMES, TOOL_DESCRIPTIONS, type ToolName } from "../tools/descriptions.js";
import { VERSION } from "../version.js";
import { SPEC_URL, SPEC_TOOLS_URL } from "../docs-urls.js";

/**
 * Extract a short one-line summary from a verbatim tool description.
 * Tool descriptions consistently lead with a single declarative sentence
 * (per `docs/SPEC.md` §4 and `CLAUDE.md` §4 — verbatim, do not paraphrase),
 * so the first non-empty line is the summary.
 */
export function summaryLine(description: string): string {
  for (const line of description.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

export type HelpCmdResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

/**
 * Render the help output. With no `tool` arg, returns the general help
 * block including the compact tool catalog. With a `tool` arg, returns
 * the verbatim description for that tool. Unknown tool names return
 * `{ ok: false }` so the CLI can choose the exit code.
 */
export function renderHelp(tool?: string): HelpCmdResult {
  if (tool === undefined) {
    return { ok: true, output: renderGeneralHelp() };
  }
  if (!isToolName(tool)) {
    return {
      ok: false,
      error: `meta-edit: unknown tool "${tool}". Run \`meta-edit -h\` for the full list.`,
    };
  }
  return { ok: true, output: renderToolHelp(tool) };
}

function renderGeneralHelp(): string {
  const catalog = TOOL_NAMES.map((name) => {
    const summary = summaryLine(TOOL_DESCRIPTIONS[name]);
    return `  ${name.padEnd(28)} ${summary}`;
  }).join("\n");

  return `meta-edit ${VERSION}

Usage:
  meta-edit serve [--repo-root <path>]     Run the MCP stdio server.
                                           --repo-root (or $META_EDIT_REPO_ROOT)
                                           overrides the repository root when the
                                           launch cwd is not the repo top-level
                                           (jj workspace, git worktree, subdir).
  meta-edit log [--tool NAME] [--risk LEVEL] [--since DATE]
                                           Print edits.jsonl entries.
  meta-edit summary [--since DATE]         Aggregate statistics from the edit log.
  meta-edit install-hooks --scope user|project
                                           Install Claude Code hooks into settings.json.
  meta-edit uninstall-hooks --scope user|project
                                           Remove Claude Code hooks from settings.json.
  meta-edit install-opencode --scope user|project
                                           Install opencode mcp + plugin into opencode.json.
  meta-edit uninstall-opencode --scope user|project
                                           Remove opencode mcp + plugin from opencode.json.
  meta-edit install-codex --scope user|project
                                           Install Codex MCP + hooks into config.toml.
  meta-edit uninstall-codex --scope user|project
                                           Remove Codex MCP + hooks from config.toml.
  meta-edit help [TOOL]                    Show this help, or the verbatim
                                           description for one typed_edit tool.
  meta-edit --version                      Show version.
  meta-edit --help                         Show this help.

Typed edit tools (run \`meta-edit -h <tool_name>\` for the full description):
${catalog}

If the typed_edit tool SCHEMAS are not loaded in your AI agent's tool
list (the harness deferred them, or the MCP server connected late),
the harness-native recovery is to call ToolSearch — e.g. query
\`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic\`
— so the schemas land in the agent's callable surface.

Running \`meta-edit help <tool_name>\` from a Bash tool emits the
verbatim description text for human inspection. It does NOT populate
the agent's tool list; it only restores the prose into conversation
context. For automated recovery prefer ToolSearch.

See ${SPEC_URL} for the full specification.
Tool descriptions: ${SPEC_TOOLS_URL}
`;
}

function renderToolHelp(name: ToolName): string {
  return `meta-edit ${VERSION} — ${name}

${TOOL_DESCRIPTIONS[name]}

See ${SPEC_TOOLS_URL} for all twenty-one tool descriptions.
`;
}

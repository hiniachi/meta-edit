// Pure policy function for the deny-raw-edit hook.
//
// meta-edit's bet is that the AI must reach for a kind-specific edit_*
// MCP tool, never the raw Edit / Write / MultiEdit primitives. This hook
// fires on PreToolUse and denies those primitives outright, so the agent
// has no fallback path that bypasses the nineteen typed tools.

export const RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  // NotebookEdit edits Jupyter (.ipynb) cells, which contain arbitrary
  // executable code (Python, shell `!cmd`, JS). Without this entry an
  // agent could rewrite notebook cells and bypass the entire edit_*
  // surface. Treat it as a raw editing primitive.
  "NotebookEdit",
]);

// Lower-cased copy used for the actual decision so the deny gate is robust
// against host shims that deliver tool names in alternate casing
// (e.g. "edit", "WRITE", "multiedit"). The exported `RAW_EDIT_TOOLS` keeps
// the canonical PascalCase names for documentation / API stability.
const LOWER_RAW_EDIT_TOOLS: ReadonlySet<string> = new Set(
  [...RAW_EDIT_TOOLS].map((t) => t.toLowerCase()),
);

export type HookDecision = {
  decision: "allow" | "deny";
  reason?: string;
};

export function evaluateRawEdit(toolName: string): HookDecision {
  if (LOWER_RAW_EDIT_TOOLS.has(toolName.toLowerCase())) {
    return {
      decision: "deny",
      reason:
        `meta-edit forbids the raw "${toolName}" tool. ` +
        `Choose one of the nineteen edit_* tools that match the kind of ` +
        `change you are making (see docs/SPEC.md §4). If no edit_* tool ` +
        `fits, stop and ask the user before bypassing the typed surface.`,
    };
  }
  return { decision: "allow" };
}

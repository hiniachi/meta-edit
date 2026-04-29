// Pure policy function for the deny-raw-edit hook.
//
// meta-edit's bet is that the AI must reach for a kind-specific edit_*
// MCP tool, never the raw Edit / Write / MultiEdit primitives. This hook
// fires on PreToolUse and denies those primitives outright, so the agent
// has no fallback path that bypasses the seventeen typed tools.

export const RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
]);

export type HookDecision = {
  decision: "allow" | "deny";
  reason?: string;
};

export function evaluateRawEdit(toolName: string): HookDecision {
  if (RAW_EDIT_TOOLS.has(toolName)) {
    return {
      decision: "deny",
      reason:
        `meta-edit forbids the raw "${toolName}" tool. ` +
        `Choose one of the seventeen edit_* tools that match the kind of ` +
        `change you are making (see docs/SPEC.md §4). If no edit_* tool ` +
        `fits, stop and ask the user before bypassing the typed surface.`,
    };
  }
  return { decision: "allow" };
}

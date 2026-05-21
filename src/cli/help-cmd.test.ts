import { describe, it, expect } from "bun:test";
import { renderHelp, summaryLine } from "./help-cmd.js";
import { TOOL_NAMES, TOOL_DESCRIPTIONS } from "../tools/descriptions.js";

describe("summaryLine", () => {
  it("returns the first non-empty line", () => {
    expect(summaryLine("first line\nsecond line")).toBe("first line");
  });

  it("skips leading blank lines", () => {
    expect(summaryLine("\n   \nactual line\nrest")).toBe("actual line");
  });

  it("trims surrounding whitespace", () => {
    expect(summaryLine("   padded   \nrest")).toBe("padded");
  });

  it("returns empty string for empty input", () => {
    expect(summaryLine("")).toBe("");
  });
});

describe("renderHelp — general (no tool argument)", () => {
  it("lists every TOOL_NAMES entry exactly once", () => {
    const result = renderHelp();
    if (!result.ok) throw new Error("expected ok=true");
    for (const name of TOOL_NAMES) {
      const occurrences = result.output.split(name).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(1);
    }
  });

  it("includes the harness-native recovery hint pointing at ToolSearch", () => {
    // v0.2.4: hint shifted from `meta-edit -h <tool_name>` (human-only)
    // to ToolSearch (the harness-native way to load deferred MCP tool
    // schemas into the agent's tool list). The CLI text mentions both,
    // but the recovery direction is ToolSearch.
    const result = renderHelp();
    if (!result.ok) throw new Error("expected ok=true");
    expect(result.output).toContain("ToolSearch");
    expect(result.output).toContain("not loaded in your AI agent's tool");
  });

  it("includes a one-line summary for each tool (locks A5 catalog format)", () => {
    const result = renderHelp();
    if (!result.ok) throw new Error("expected ok=true");
    for (const name of TOOL_NAMES) {
      const summary = summaryLine(TOOL_DESCRIPTIONS[name]);
      expect(summary.length).toBeGreaterThan(0);
      expect(result.output).toContain(summary);
    }
  });
});

describe("renderHelp — per-tool full description", () => {
  it("returns the verbatim description for a known tool", () => {
    const result = renderHelp("edit_cosmetic");
    if (!result.ok) throw new Error("expected ok=true");
    // The full description must appear verbatim — the whole point of A5
    // is restoring this prose into the agent's context.
    expect(result.output).toContain(TOOL_DESCRIPTIONS["edit_cosmetic"]);
  });

  it("includes the tool name in a banner above the description", () => {
    // v0.6.0: edit_docs_only was retired; use edit_explanation, one of
    // the five workflow-axis kinds that replaced it.
    const result = renderHelp("edit_explanation");
    if (!result.ok) throw new Error("expected ok=true");
    expect(result.output).toContain("edit_explanation");
  });

  it("rejects unknown tool names with a discoverable error", () => {
    const result = renderHelp("edit_does_not_exist");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok=false");
    expect(result.error).toContain("edit_does_not_exist");
    expect(result.error).toContain("meta-edit -h");
  });

  it("treats the empty string as an unknown tool (not as no-arg)", () => {
    // Important contract: the CLI dispatches on `args[0]`. When the user
    // types `meta-edit help ""` we must not silently fall back to general
    // help — that would mask a typo.
    const result = renderHelp("");
    expect(result.ok).toBe(false);
  });
});

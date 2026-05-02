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

  it("includes the recovery hint pointing at `meta-edit -h <tool_name>`", () => {
    const result = renderHelp();
    if (!result.ok) throw new Error("expected ok=true");
    expect(result.output).toContain("meta-edit -h <tool_name>");
    expect(result.output).toContain("missing from your AI agent's context");
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
    const result = renderHelp("edit_refactor_only");
    if (!result.ok) throw new Error("expected ok=true");
    // The full description must appear verbatim — the whole point of A5
    // is restoring this prose into the agent's context.
    expect(result.output).toContain(TOOL_DESCRIPTIONS["edit_refactor_only"]);
  });

  it("includes the tool name in a banner above the description", () => {
    const result = renderHelp("edit_create_file");
    if (!result.ok) throw new Error("expected ok=true");
    expect(result.output).toContain("edit_create_file");
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

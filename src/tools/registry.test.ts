import { describe, it, expect } from "bun:test";
import { TOOL_NAMES, TOOL_DESCRIPTIONS } from "./descriptions.js";

describe("seventeen tools", () => {
  it("registers exactly seventeen tool names", () => {
    expect(TOOL_NAMES.length).toBe(17);
    expect(new Set(TOOL_NAMES).size).toBe(17);
  });

  it("has a non-empty description for each tool", () => {
    for (const name of TOOL_NAMES) {
      const desc = TOOL_DESCRIPTIONS[name];
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(0);
    }
  });
});

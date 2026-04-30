import { describe, it, expect } from "bun:test";
import {
  TOOL_NAMES,
  TOOL_DESCRIPTIONS,
  TOOLS_REQUIRING_TEST_FILES,
} from "./descriptions.js";

describe("eighteen tools", () => {
  it("registers exactly eighteen tool names", () => {
    expect(TOOL_NAMES.length).toBe(18);
    expect(new Set(TOOL_NAMES).size).toBe(18);
  });

  it("has a non-empty description for each tool", () => {
    for (const name of TOOL_NAMES) {
      const desc = TOOL_DESCRIPTIONS[name];
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it("registers edit_docs_only with a verbatim documentation description", () => {
    expect(TOOL_NAMES).toContain("edit_docs_only");
    expect(TOOL_DESCRIPTIONS.edit_docs_only).toContain(
      "Modify documentation, README, comments, or other narrative content",
    );
  });

  it("treats edit_docs_only as test-files-optional, like edit_refactor_only", () => {
    expect(TOOLS_REQUIRING_TEST_FILES).not.toContain("edit_docs_only");
    expect(TOOLS_REQUIRING_TEST_FILES).not.toContain("edit_refactor_only");
    expect(TOOLS_REQUIRING_TEST_FILES).not.toContain("edit_test_only_change");
  });
});

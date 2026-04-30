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

  it("includes the universal General principles block verbatim in every description", () => {
    // Per the v0.1.2 policy change: every edit_* tool description must
    // carry the same three-line block so the agent reads the same text
    // at every tool call (cf. docs/SPEC.md §4 trailing block on each
    // tool). Assert byte-for-byte equality of the block — substring-
    // only checks would let drift in spacing, ordering, or bullet
    // wording slip through.
    const principlesBlock =
      "General principles (apply to every edit):\n" +
      "- Keep the code simple. Prefer three similar lines over a premature abstraction.\n" +
      "- When the intent or boundary is unclear, stop and ask the user — do not invent a workaround.";
    for (const name of TOOL_NAMES) {
      const desc = TOOL_DESCRIPTIONS[name];
      expect(desc).toContain(principlesBlock);
    }
  });
});

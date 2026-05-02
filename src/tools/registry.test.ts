import { describe, it, expect } from "bun:test";
import {
  TOOL_NAMES,
  TOOL_DESCRIPTIONS,
  TOOLS_REQUIRING_TEST_FILES,
} from "./descriptions.js";

describe("eighteen tools", () => {
  it("registers exactly eighteen tool names", () => {
    // v0.3.1: edit_create_file and edit_create_planning_artifact were
    // dropped. Empty file creation is now free at the deny-raw-edit
    // hook level; content fills go through the appropriate type-specific
    // tool's modify path. Surface count: 17 SQLite-derived + 1 workflow
    // tool (edit_docs_only) = 18.
    expect<number>(TOOL_NAMES.length).toBe(18);
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

  it("does NOT register edit_create_file or edit_create_planning_artifact (v0.3.1 removal)", () => {
    expect(TOOL_NAMES).not.toContain("edit_create_file" as never);
    expect(TOOL_NAMES).not.toContain("edit_create_planning_artifact" as never);
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

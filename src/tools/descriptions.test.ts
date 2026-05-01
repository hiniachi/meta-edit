import { describe, it, expect } from "bun:test";
import {
  TOOL_NAMES,
  TOOLS_REQUIRING_TEST_FILES,
  type ToolName,
} from "./descriptions.js";

// Issue 021 (a5-04): drift guard for the TOOLS_REQUIRING_TEST_FILES
// classification. The filter in descriptions.ts encodes the
// test_files-cardinality contract for every registered tool, but no test
// previously enforced the three-way invariant:
//   TOOL_NAMES = TOOLS_REQUIRING_TEST_FILES ∪ EXPLICIT_EXEMPT, disjoint.
// If a 19th tool is added to TOOL_NAMES without being placed in either set,
// or if one of the exempt tools is renamed and the filter falls out of sync,
// validateRequest's test_files cardinality check (common.ts:97-105) silently
// changes meaning. These tests pin the invariant so any drift fails CI.

// Explicit exempt set: tools for which test_files is NOT required.
// Mirrors the filter in descriptions.ts. If the two diverge, the test fails.
const EXPLICIT_EXEMPT: ReadonlySet<ToolName> = new Set([
  "edit_refactor_only",
  "edit_test_only_change",
  "edit_docs_only",
]);

describe("TOOLS_REQUIRING_TEST_FILES coverage", () => {
  it("every tool in TOOL_NAMES is either in TOOLS_REQUIRING_TEST_FILES or in the explicit exempt set", () => {
    for (const name of TOOL_NAMES) {
      const inRequired = TOOLS_REQUIRING_TEST_FILES.includes(name);
      const inExempt = EXPLICIT_EXEMPT.has(name);
      // Each tool must be in exactly one of the two sets.
      expect(
        inRequired !== inExempt,
        `Tool "${name}" must be in exactly one of TOOLS_REQUIRING_TEST_FILES or the exempt set. ` +
          `Got: inRequired=${inRequired}, inExempt=${inExempt}`,
      ).toBe(true);
    }
  });

  it("TOOLS_REQUIRING_TEST_FILES contains no tools that are in the explicit exempt set", () => {
    for (const name of TOOLS_REQUIRING_TEST_FILES) {
      expect(
        EXPLICIT_EXEMPT.has(name),
        `Tool "${name}" is in both TOOLS_REQUIRING_TEST_FILES and the exempt set — contradiction`,
      ).toBe(false);
    }
  });

  it("all tools in the explicit exempt set are present in TOOL_NAMES", () => {
    for (const name of EXPLICIT_EXEMPT) {
      expect(
        (TOOL_NAMES as readonly string[]).includes(name),
        `Exempt tool "${name}" is not in TOOL_NAMES — stale exempt set`,
      ).toBe(true);
    }
  });

  it("TOOL_NAMES length equals TOOLS_REQUIRING_TEST_FILES length plus exempt set size", () => {
    // If a new tool is added to TOOL_NAMES without being placed in either
    // set, this length-invariant assertion catches the omission.
    expect(TOOL_NAMES.length).toBe(
      TOOLS_REQUIRING_TEST_FILES.length + EXPLICIT_EXEMPT.size,
    );
  });
});

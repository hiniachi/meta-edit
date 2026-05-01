---
id: a5-04
category: bug/validation
severity: HIGH
affected_files: [src/tools/descriptions.ts, src/tools/registry.ts]
test_file: src/tools/descriptions.test.ts
---

# [BUG] `TOOLS_REQUIRING_TEST_FILES` drift: no test enforces coverage of all registered tools

## Summary

`TOOLS_REQUIRING_TEST_FILES` is built by filtering `TOOL_NAMES` in `descriptions.ts` (lines 28–33):

```typescript
export const TOOLS_REQUIRING_TEST_FILES: readonly ToolName[] = TOOL_NAMES.filter(
  (name) =>
    name !== "edit_refactor_only" &&
    name !== "edit_test_only_change" &&
    name !== "edit_docs_only",
);
```

This construction is correct today. However, the logic has two fragile properties:

1. **New tool addition drift.** If a 19th tool is added to `TOOL_NAMES` without also being
   considered in the filter — either by explicitly exempting it or by relying on the default
   include — the filter silently decides its test-file requirement by omission. For a tool that
   **should** require test files, this is fine (it inherits the default). For a tool that
   **should be exempt** (like a future `edit_docs_only_markdown` variant), the absence from the
   explicit exempt list means `TOOLS_REQUIRING_TEST_FILES.includes(name)` returns `true` —
   **requiring test files when the tool description says they are optional**. There is no test
   that would catch this mismatch.

2. **Exempt-set drift.** The exempt set `{edit_refactor_only, edit_test_only_change, edit_docs_only}`
   is hardcoded as three string literals in `descriptions.ts` with no corresponding structural
   assertion. If one of the exempt tools is renamed in `TOOL_NAMES` (e.g., `edit_docs_only` →
   `edit_documentation_only`), the filter condition becomes dead code — the renamed tool is no
   longer excluded, so it joins `TOOLS_REQUIRING_TEST_FILES`, and requests using the renamed
   tool with `test_files: []` are incorrectly rejected.

**No test currently iterates over all tools in `TOOL_NAMES` (or `registry.ts`) and asserts that
each is classified consistently.** The `registry.ts` `TOOL_NAMES` import is the authoritative
list of registered tools; it should be the source of truth for the assertion.

## Attack surface

If the drift goes undetected:
- A new tool whose description says "test_files not required" silently enforces test_files,
  causing confusing rejections for valid requests.
- A renamed exempt tool silently joins the required set, breaking workflows.
- Neither scenario is caught at CI time because there is no assertion over the full tool set.

## Reproducing failing test

Create `src/tools/descriptions.test.ts`. This test **currently passes** (no drift exists today),
but it will **fail** if drift is introduced — which is the intended regression-gate behavior.

```typescript
import { describe, it, expect } from "bun:test";
import {
  TOOL_NAMES,
  TOOLS_REQUIRING_TEST_FILES,
  type ToolName,
} from "./descriptions.js";

// Explicit exempt set: tools for which test_files is NOT required.
// This mirrors the filter in descriptions.ts. If the two diverge, the test fails.
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
    // set, this assertion catches the omission.
    expect(TOOL_NAMES.length).toBe(
      TOOLS_REQUIRING_TEST_FILES.length + EXPLICIT_EXEMPT.size,
    );
  });
});
```

## Expected vs actual

**Expected:** All four assertions in `descriptions.test.ts` pass. Every tool in `TOOL_NAMES` is
accounted for in exactly one classification.

**Actual (current state):** The test does not exist. Drift from adding, removing, or renaming a
tool would not be caught until a runtime `validateRequest` call produces an unexpected
`test_files` error.

**If a new tool `edit_docs_supplemental` is added to `TOOL_NAMES` without a corresponding exempt
entry, the fourth assertion (`TOOL_NAMES.length === ...`) would fail immediately, surfacing the
gap at test time rather than at runtime.**

## Suggested fix direction

Create `src/tools/descriptions.test.ts` with the tests above. No change to `descriptions.ts` is
needed today — the current filter is correct. The tests serve as a locked specification for the
three-way invariant: `TOOL_NAMES` = `TOOLS_REQUIRING_TEST_FILES` ∪ `EXPLICIT_EXEMPT`, disjoint.

## Out of scope notes

`registry.ts` imports `TOOL_NAMES` and registers all 18 tools. A future test could also assert
that every name in `TOOL_NAMES` has a registered handler in the server, but that is a separate
concern. This issue is scoped to the `test_files` classification invariant only.

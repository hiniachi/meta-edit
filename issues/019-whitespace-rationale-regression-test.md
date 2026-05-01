---
id: a5-02
category: bug/validation
severity: MEDIUM
affected_files: [src/tools/common.ts, src/tools/common.test.ts]
test_file: src/tools/common.test.ts
---

# [BUG] Regression-test gap: whitespace-only `rationale` produces warning but no exact-count assertion

## Summary

`validateRequest` (common.ts line 93–95) checks `request.rationale.trim().length === 0` and
pushes `"rationale must be non-empty"` to `warnings`. The function then **continues processing**
rather than returning early. The existing test at `common.test.ts:40-51` asserts that
`r.ok === false` and that at least one warning includes `"rationale"`. However, it does **not**
assert:

1. That exactly one warning is emitted for the rationale violation (i.e., no double-counting).
2. That no unrelated warnings are emitted when all other fields are valid (i.e., only the
   rationale warning fires, not warnings from downstream validation steps that should have been
   gated by an early return).

The second point is the defect surface: because `validateRequest` does not return early after
recording a rationale warning, it continues into path-safety checks, test-file checks, and
change-loop checks. In the existing test, the base request has a valid `target_file`,
`test_files`, and `changes`, so the only warning that fires is the rationale one — but this is
coincidental. If the function's control flow were accidentally restructured, multiple unrelated
warnings could fire for a whitespace rationale, making error messages confusing. More critically,
the test does not pin the exact warning message text, so a future refactor that changes
`"rationale must be non-empty"` to something unrelated would not be caught.

## Attack surface

Low. This is a quality/usability issue rather than a security vulnerability: a caller providing
`rationale: "   "` will correctly receive `ok: false`, but the exact shape of the warnings array
is unspecified by tests. A future regression where the rationale check is moved or silently
removed would not be caught by the current test.

## Reproducing failing test

This test **currently passes** — but it pins behavior more tightly than the existing test does.
If the existing passing test were the only one, a regression where `validateRequest` emits a
different warning message for blank rationale would go undetected.

Add to `src/tools/common.test.ts` inside `describe("validateRequest") > describe("rationale")`:

```typescript
it("emits exactly one warning for whitespace-only rationale when all other fields are valid", () => {
  const r = validateRequest(
    "edit_boundary_condition",
    baseRequest({ rationale: "   " }),
    ctx,
  );
  expect(r.ok).toBe(false);
  if (!r.ok) {
    // Pin the exact warning message so renames are caught.
    expect(r.warnings).toContain("rationale must be non-empty");
    // Only one warning must be present: the rationale warning.
    // If downstream checks also fire for an otherwise-valid request,
    // the warnings array will be longer and this assertion catches it.
    expect(r.warnings).toHaveLength(1);
  }
});

it("emits rationale warning and continues to accumulate other warnings (does not early-return)", () => {
  // validateRequest does NOT early-return after the rationale check.
  // Confirm that a request with both a blank rationale AND an invalid
  // target_file produces both warnings — verifying the documented behavior
  // that validation accumulates multiple errors in one pass.
  const r = validateRequest(
    "edit_boundary_condition",
    baseRequest({
      rationale: "   ",
      target_file: "../outside.ts",
      changes: [makeChange("../outside.ts")],
    }),
    ctx,
  );
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.warnings.some((w) => w.includes("rationale must be non-empty"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("escapes repository root"))).toBe(true);
  }
});
```

## Expected vs actual

**Expected:** For `rationale: "   "` with otherwise valid fields, `warnings` is
`["rationale must be non-empty"]` — length 1.

**Actual (current behavior):** The behavior is correct (length 1 in this case), but no test
asserts the exact length or the exact message string. The test only checks
`.some((w) => w.includes("rationale"))`.

## Suggested fix direction

Add the two tests above. No source code change is required.

If a future decision is made to early-return on blank rationale (returning immediately with one
warning rather than accumulating), that would be a deliberate behavioral change and the second
test would need to be updated. That tradeoff should be explicit, not accidental.

## Out of scope notes

Whether `validateRequest` should fast-fail on blank rationale (vs accumulate) is an API design
question. MVP behavior (accumulate) is documented in comments. This issue only files the
missing regression tests.

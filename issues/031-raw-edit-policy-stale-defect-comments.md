---
id: a8-02
category: test-quality
severity: MEDIUM
affected_files:
  - src/hooks/raw-edit-policy.test.ts
test_file: src/hooks/raw-edit-policy.test.ts
---

# [TEST-QUALITY] Stale "this is the defect" comments in `raw-edit-policy.test.ts` contradict passing tests

## Summary

Lines 40-55 of `src/hooks/raw-edit-policy.test.ts` contain comments stating the current
behavior is a defect that causes the test to return `"allow"` instead of `"deny"`:

```typescript
// src/hooks/raw-edit-policy.test.ts lines 40-56
it("denies lowercase 'edit' (case-insensitive contract)", () => {
  // Currently returns "allow" — this is the defect.
  const r = evaluateRawEdit("edit");
  expect(r.decision).toBe("deny");
});

it("denies uppercase 'WRITE' (case-insensitive contract)", () => {
  // Currently returns "allow" — this is the defect.
  const r = evaluateRawEdit("WRITE");
  expect(r.decision).toBe("deny");
});

it("denies mixed-case 'multiedit' (case-insensitive contract)", () => {
  // Currently returns "allow" — this is the defect.
  const r = evaluateRawEdit("multiedit");
  expect(r.decision).toBe("deny");
});
```

The same file also has (line 58-64):

```typescript
it("denies NotebookEdit (scope gap: Jupyter notebooks contain executable code)", () => {
  // NotebookEdit is a Claude Code built-in that edits .ipynb files.
  // It is currently NOT in RAW_EDIT_TOOLS, so this assertion fails.
  const r = evaluateRawEdit("NotebookEdit");
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("edit_*");
});
```

All four tests **currently pass**. The defects described in the comments were fixed when
issues 012 and 013 were resolved: `raw-edit-policy.ts` now contains a case-insensitive
`LOWER_RAW_EDIT_TOOLS` set and `NotebookEdit` is in `RAW_EDIT_TOOLS`.

The stale comments are misleading: a future maintainer reading the test file sees tests
labeled "this is the defect" and "this assertion fails" that are actually green regression
guards. This creates three risks:

1. **Confusion during triage**: a developer seeing 4 out of 9 tests marked as "currently
   broken" may falsely believe the test suite is in a known-broken state.
2. **Incorrect revert risk**: someone "fixing" what they believe is a failing test may
   inadvertently revert the case-insensitive check, re-introducing the real defect.
3. **Broken-windows signal**: stale misleading comments in tests erode trust in the
   comment layer across the entire test file.

## Reproducing the issue

The issue is a test quality problem, not a runtime failure. It can be demonstrated by
running the suite and noting the contradiction:

```
bun test src/hooks/raw-edit-policy.test.ts
```

Output shows all 9 tests passing, including the ones labelled "this is the defect" and
"this assertion fails". The test file itself is the reproducing artifact.

A regression-guard test that verifies the comments are NOT stale (and that the correct
behavior is documented as such) would be:

```typescript
// Add to src/hooks/raw-edit-policy.test.ts, replacing or annotating the
// four misleading tests with clarified intent:

it("denies lowercase 'edit' — case-insensitive check (regression guard, NOT a defect)", () => {
  // Issues 012/013 fixed the case-sensitive gap. This test is a regression
  // guard: if the LOWER_RAW_EDIT_TOOLS lookup is removed, this fails.
  const r = evaluateRawEdit("edit");
  expect(r.decision).toBe("deny");
});

it("denies uppercase 'WRITE' — case-insensitive check (regression guard, NOT a defect)", () => {
  const r = evaluateRawEdit("WRITE");
  expect(r.decision).toBe("deny");
});

it("denies mixed-case 'multiedit' — case-insensitive check (regression guard, NOT a defect)", () => {
  const r = evaluateRawEdit("multiedit");
  expect(r.decision).toBe("deny");
});

it("denies NotebookEdit — scope fix (regression guard, NOT a defect)", () => {
  // Issue 013 added NotebookEdit to RAW_EDIT_TOOLS. This test guards
  // against regression.
  const r = evaluateRawEdit("NotebookEdit");
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("edit_*");
});
```

These pass today and fail if the fixes are reverted — which is exactly what a
regression guard should do.

## Expected vs actual

| Location | Expected comment | Actual comment |
|---|---|---|
| `raw-edit-policy.test.ts` line 41 | "regression guard for issue 012" | "Currently returns 'allow' — this is the defect." |
| `raw-edit-policy.test.ts` line 47 | "regression guard for issue 012" | "Currently returns 'allow' — this is the defect." |
| `raw-edit-policy.test.ts` line 53 | "regression guard for issue 012" | "Currently returns 'allow' — this is the defect." |
| `raw-edit-policy.test.ts` line 59-61 | "regression guard for issue 013" | "It is currently NOT in RAW_EDIT_TOOLS, so this assertion fails." |

## Suggested fix direction

Update the four misleading comment blocks to read "regression guard for issue 012/013"
(or similar). The `expect` assertions themselves are correct and should stay unchanged.
No production code change is needed.

## Out of scope notes

This is a documentation/comment quality issue, not a runtime defect. The assertions
themselves are correct regression guards; only the comments misstate their status.

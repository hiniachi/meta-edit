---
id: a5-03
category: bug/validation
severity: MEDIUM
affected_files: [src/tools/common.ts, src/tools/common.test.ts]
test_file: src/tools/common.test.ts
---

# [BUG] Regression-test gap: duplicate canonical change detection is tested for string-identical paths but not for alias-equivalent paths

## Summary

`validateRequest` (common.ts lines 207–216) uses a `Set<string>` (`seenCanonical`) to detect
two `Change` entries resolving to the same canonical path. The existing test at
`common.test.ts:376-395` covers the case where both entries use the **same string**
(`"src/foo.ts"` twice). However, no test covers the case where two entries have **different
input strings that canonicalize to the same path** — for example, `"src/./foo.ts"` and
`"src/foo.ts"`, or `"src/foo.ts"` and `"./src/foo.ts"`. If `checkPathSafety` normalizes these
to the same canonical string, the duplicate guard should fire. If it does not normalize them, the
duplicate guard silently fails: two changes targeting the same physical file are both accepted,
and the second silently overwrites the first's effect in `applyChanges` (which has its own
duplicate guard as a defensive assertion, but that fires after the fact and aborts).

The current test pins only the string-identical case. The alias-equivalent case is unverified.

## Attack surface

A caller could submit two `Change` entries with syntactically different but semantically equal
paths (`src/foo.ts` vs `src/./foo.ts`). If `validateRequest` does not catch this:

- Both changes pass validation.
- `applyChanges` encounters the duplicate canonical in its own `seenCanonical` check (lines 97–106
  of `apply.ts`) and returns `{ applied: false }` with an internal-error warning.
- The result is a confusing error at apply time rather than a clean validation rejection.

This is a correctness and UX defect, not a security escape, but the confusing apply-time error
could mask other issues.

## Reproducing failing test

The first sub-test below checks a case that **currently passes** (string-identical duplicate) —
it already exists but is reproduced here for context. The second sub-test is **new** and may
reveal a gap.

Add to `src/tools/common.test.ts` inside `describe("validateRequest") > describe("scope")`:

```typescript
it("rejects a request with two changes that resolve to the same canonical via path normalization", () => {
  // "src/./foo.ts" normalizes to "src/foo.ts" via checkPathSafety's
  // normalizeRepoRelative path. Both entries should be seen as duplicates.
  const r = validateRequest(
    "edit_boundary_condition",
    baseRequest({
      target_file: "src/foo.ts",
      test_files: ["tests/foo.test.ts"],
      changes: [
        // First change uses the canonical form.
        makeChange("src/foo.ts", "alpha", "beta"),
        // Second change uses a path that normalizes to the same canonical.
        makeChange("src/./foo.ts", "alpha", "beta"),
      ],
    }),
    ctx,
  );
  // Both entries normalize to "src/foo.ts" so one of the following must hold:
  // (a) validateRequest rejects with a duplicate-canonical warning, or
  // (b) validateRequest rejects with an out-of-scope warning for "src/./foo.ts"
  //     (because normalizeRepoRelative treats "src/./foo.ts" as a distinct string
  //     that does not match "src/foo.ts" in the allowed set).
  // Either is acceptable; what is NOT acceptable is ok: true, because that
  // would allow two changes to the same file through to applyChanges.
  expect(r.ok).toBe(false);
  if (!r.ok) {
    // At least one warning must reference the affected path.
    expect(
      r.warnings.some(
        (w) =>
          w.includes("foo.ts") &&
          (w.includes("multiple entries") || w.includes("scope")),
      ),
    ).toBe(true);
  }
});

it("duplicate-canonical guard fires before applyChanges internal assertion", () => {
  // If validateRequest lets through duplicate canonicals, applyChanges
  // catches them as an internal-error assertion (apply.ts:100-104).
  // This test ensures the rejection happens at validation time, not apply time.
  const r = validateRequest(
    "edit_boundary_condition",
    baseRequest({
      changes: [
        makeChange("src/foo.ts", "alpha", "beta"),
        makeChange("src/foo.ts", "beta", "gamma"),
      ],
    }),
    ctx,
  );
  expect(r.ok).toBe(false);
  if (!r.ok) {
    // Must include the duplicate warning, not an apply-internal-error warning.
    expect(
      r.warnings.some(
        (w) => w.includes("multiple entries") && w.includes("src/foo.ts"),
      ),
    ).toBe(true);
    // Must NOT include the apply-internal-error message — that would mean
    // the rejection came from applyChanges, not validateRequest.
    expect(
      r.warnings.every((w) => !w.includes("internal error")),
    ).toBe(true);
  }
});
```

## Expected vs actual

**Expected (string-identical duplicate):** `r.ok === false` with a warning containing
`"multiple entries"` and `"src/foo.ts"`. This already works and is tested.

**Expected (alias-equivalent duplicate):** `r.ok === false`. The exact warning depends on whether
`normalizeRepoRelative` collapses `"src/./foo.ts"` to `"src/foo.ts"` before the duplicate check.
If it does, the duplicate warning fires. If it does not, the out-of-scope warning fires (the
`allowed` set contains `"src/foo.ts"` but not `"src/./foo.ts"`). Either is acceptable; `ok: true`
is not.

**Current state:** The alias-equivalent case is **not tested**. If `normalizeRepoRelative` does
not normalize dot segments (it handles `./` prefix but may not handle embedded `./`), both paths
could appear as distinct canonicals and both be added to `touched`, potentially producing two
`ContentChange` entries with different `canonical` strings that happen to map to the same file
on disk — silently accepted by `validateRequest` and then rejected by `applyChanges` with a
confusing internal-error message.

## Suggested fix direction

Add the tests above. If the alias-equivalent test reveals that `validateRequest` returns
`ok: true` for two changes pointing at the same physical file via different path strings, then
`checkPathSafety` should normalize embedded dot-segments before returning the canonical string.

## Out of scope notes

Full path-aliasing coverage (symlinks, bind mounts) requires `realpath` at validation time, which
`checkPathSafety` already does for existing paths. For non-existent paths, only lexical
normalization is possible at validation time; the apply-time re-realpath provides the safety net.

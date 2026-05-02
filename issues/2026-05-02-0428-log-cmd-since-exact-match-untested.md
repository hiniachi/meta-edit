---
id: a9-02
category: test-quality
severity: MEDIUM
affected_files:
  - src/cli/log-cmd.ts
test_file: src/cli/log-cmd.test.ts
---

# [TEST GAP] `filterEntries` `--since` exact-match boundary is untested

## Summary

`filterEntries` in `src/cli/log-cmd.ts` uses a strict less-than comparison to
implement an inclusive `--since` boundary:

```typescript
// src/cli/log-cmd.ts line 38
if (t.getTime() < filters.since.getTime()) return false;
```

`t < since` means an entry with `timestamp === since` is **kept** (not filtered
out). The boundary is inclusive.

The existing test (`filterEntries "filters by since (inclusive)"`,
`log-cmd.test.ts` line 46) uses:

```typescript
since: new Date("2026-04-29T00:00:00+09:00")
```

The nearest entry in the fixture has `timestamp: "2026-04-29T10:00:00+09:00"` —
ten hours after `since`. The test verifies that the entry is kept, which it would
be under both `<` (current) and `<=` (a regression). A regression that changed
the operator to `<=` (exclusive `since`) would pass all current tests.

There is no test where an entry's timestamp equals `since` exactly.

## Reproducing failing test

Add to `src/cli/log-cmd.test.ts` in the `"filterEntries"` describe block:

```typescript
it("keeps an entry whose timestamp is exactly equal to --since (inclusive boundary)", () => {
  // The implementation uses `t < since`, so t === since is kept.
  // A regression to `t <= since` (exclusive) would drop this entry.
  // This test FAILS if the operator is changed to `<=`.
  const exactEntry = entry({
    edit_id: "edit_exact_0001",
    tool_name: "edit_boundary_condition",
    risk_level: "low",
    timestamp: "2026-04-29T00:00:00+09:00",
  });
  const r = filterEntries([exactEntry], {
    since: new Date("2026-04-29T00:00:00+09:00"),
  });
  expect(r).toHaveLength(1);
  expect(r[0]!.edit_id).toBe("edit_exact_0001");
});
```

Run with:

```
bun test src/cli/log-cmd.test.ts
```

This test currently **passes** because the implementation is correct. Its purpose
is to pin the boundary semantics so a future change from `<` to `<=` fails
loudly rather than silently.

## Why this matters

The `--since` flag is documented (implicitly through the `parseStrictSince`
contract) as inclusive: `meta-edit log --since 2026-04-29` should include edits
from that day forward including midnight. Without this test:

1. A refactor normalizing `t < since` to `t <= since` (common off-by-one
   direction) would not be caught by the test suite.
2. The symmetric boundary in `runSummaryCommand` uses `t >= since.getTime()`
   (also inclusive); the two filters ought to be consistent. The absence of a
   pinning test makes it easy for them to drift apart undetected.

## Note

`runSummaryCommand` in `src/cli/summary-cmd.ts` uses `t >= since.getTime()`,
which is the same inclusive semantics written from the other direction. That
path is likewise untested at exact-match; a single test covering both would
eliminate both gaps, but this issue tracks the `filterEntries` gap specifically.

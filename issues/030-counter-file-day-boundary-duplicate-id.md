---
id: a8-01
category: audit-integrity/edit-log
severity: HIGH
affected_files:
  - src/state/edit-log.ts
test_file: src/state/edit-log.test.ts
---

# [BUG] `writeCounterFile` discards previous-day reservation on day boundary, enabling duplicate `edit_id`

## Summary

`EditLog.writeCounterFile` writes `counter.json` as `{ [currentDayKey]: value }`, replacing
whatever was there before with a single-key object (line 245 of `src/state/edit-log.ts`):

```typescript
// src/state/edit-log.ts line 244-245
// Keep only the current day's counter — old days are recoverable
// from the log itself if needed and pruning keeps the file tiny.
const payload = JSON.stringify({ [key]: value });
```

When a new day's first `nextEditId` call runs, it writes `{"20260501":1}` to
`counter.json`, overwriting any previous content such as `{"20260430":3}`. The
previous day's counter reservation is now invisible to any new `EditLog` instance.

If, on the previous day, `nextEditId` was called (reserving a counter like `0003`) but
`append` was never called for that ID — which happens on the validation-rejection path
in `makeApplyingHandler` — then:

1. `counter.json` held `{"20260430":3}` (the reserved value).
2. The new day's first call overwrites it with `{"20260501":1}`.
3. A new `EditLog` instance constructed later that same previous day, with no append
   in the log to recover from, calls `readCounterFile("20260430")` → returns 0 (key
   absent), calls `scanMaxCounterForKey("20260430")` → returns 0 (nothing in log),
   and issues `edit_20260430_0001` — a duplicate of the already-reserved ID.

The counter file comment "old days are recoverable from the log itself" is only true
when IDs have been appended. The design of `nextEditId` specifically handles the case
where IDs are allocated but not appended — that is the entire purpose of the sidecar
counter file. Pruning the previous day's key defeats this guarantee at day boundaries.

## Attack surface / impact

- **Who triggers it**: Any validation failure (non-empty rationale, protected path,
  etc.) on day N, followed by any edit on day N+1, followed by another edit on day N
  from a fresh `EditLog` instance.
- **Severity**: HIGH — duplicate `edit_id` values break the audit-log's uniqueness
  guarantee. `meta-edit summary` and `meta-edit log` assume each `edit_id` is
  distinct; duplicate IDs corrupt forensic trail integrity.
- **Scope**: Requires crossing a calendar day boundary between the stranded `nextEditId`
  call and the subsequent same-day instance. In practice this is rare but not
  hypothetical: validation rejections are common; instance lifetimes are short (one
  MCP call = one handler invocation).

## Reproducing failing test

Add to `src/state/edit-log.test.ts` in the `"EditLog concurrent-instance safety"` describe block:

```typescript
it("does not reuse an id that was reserved-but-not-appended when a later day's write prunes counter.json", () => {
  // Step 1: instance A allocates an id on day0 but does NOT append.
  // This simulates the validation-rejection path (nextEditId is called
  // before validation, and validation fails before append).
  const day0 = new Date(2026, 3, 30); // 2026-04-30
  const day1 = new Date(2026, 4, 1);  // 2026-05-01

  const logA = new EditLog(tmpRoot);
  const idA = logA.nextEditId(day0);
  // idA === "edit_20260430_0001"; counter.json now holds {"20260430":1}
  // (No append — simulates validation failure.)

  // Step 2: instance B crosses into day1 and writes counter.json for the
  // new day, which overwrites the day0 entry. This is the defect site.
  const logB = new EditLog(tmpRoot);
  logB.nextEditId(day1);
  // counter.json is now {"20260501":1}; the "20260430":1 reservation is lost.

  // Step 3: instance C is a fresh instance on day0. It reads counter.json
  // (returns 0 for "20260430"), scans the log (no appends → 0), and starts
  // from 0001 again — producing a duplicate of idA.
  const logC = new EditLog(tmpRoot);
  const idC = logC.nextEditId(day0);

  // This assertion FAILS on current code: idC === "edit_20260430_0001" === idA.
  expect(idC).not.toBe(idA);
});
```

Run with:

```
bun test src/state/edit-log.test.ts
```

The test currently fails because `idC === "edit_20260430_0001" === idA`.

## Expected vs actual

| Scenario | Expected | Actual |
|---|---|---|
| Fresh instance on previous day after day boundary crossed | ID above previously reserved value | Restarts at 0001, duplicating reserved ID |
| `counter.json` after day1 write | Retains previous day's reserved counter | Overwrites with only current day's key |

## Suggested fix direction

Preserve all keys present in the counter file; only update the key for the current day:

```typescript
private writeCounterFile(key: string, value: number): void {
  const counterPath = path.join(this.statePath, "counter.json");

  // Read existing content to preserve other days' reservations.
  let existing: Record<string, number> = {};
  try {
    const text = fs.readFileSync(counterPath, "utf8");
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      existing = parsed as Record<string, number>;
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw e;
    // ENOENT: file doesn't exist yet, start fresh.
  }

  // Merge: keep all existing day keys, update (or add) the current day's key.
  const payload = JSON.stringify({ ...existing, [key]: value });

  // ... (rest of symlink guard + O_NOFOLLOW open unchanged)
}
```

Optionally, prune keys older than N days (e.g. 2 days) to keep the file
small while protecting the at-risk previous-day window. The minimum safe
retention is 1 day (the previous calendar day).

## Out of scope notes

Persisting counter entries for arbitrarily old days (beyond 1-2 days) is
not required. The log-scan fallback (`scanMaxCounterForKey`) handles the
case where the counter entry was already pruned and appended IDs exist. The
only gap is the no-append (validation-rejection) path within the pruning window.

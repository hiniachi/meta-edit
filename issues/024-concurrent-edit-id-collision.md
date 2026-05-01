---
id: a6-03
category: bug/audit-log
severity: HIGH
affected_files: [src/state/edit-log.ts]
test_file: src/state/edit-log.test.ts
---

# [BUG] Concurrent `EditLog` instances produce duplicate `edit_id` values

## Summary

`EditLog` maintains an in-memory counter (`todayCounter`) that is seeded once
from the on-disk log when the first `nextEditId()` call is made for a given
day (`scanMaxCounterForKey`, lines 141-177).  If two `EditLog` instances are
constructed **after** the same set of existing log entries and both call
`nextEditId()` before either has appended anything, they will each start their
counter at the same value and produce duplicate `edit_id`s.

This is the canonical multi-process scenario: two tool invocations running in
the same MCP server process (or two separate processes) that each construct
their own `EditLog` will collide on IDs.

## Attack surface

`edit_id` is the primary audit trail identifier.  Duplicate IDs make the log
ambiguous: forensic queries filtering by `edit_id` return multiple records,
and any external system that treats `edit_id` as a unique key (e.g. a CI
summary or a downstream SIEM) will silently lose or conflate records.

Relevant code — `nextEditId()` at lines 55-65 and `scanMaxCounterForKey()` at
lines 141-177:

```typescript
// edit-log.ts:55-65
nextEditId(d: Date = new Date()): string {
  const key = formatDayKey(d);
  if (this.todayKey !== key) {
    this.todayKey = key;
    this.todayCounter = this.scanMaxCounterForKey(key);  // reads disk once
  }
  this.todayCounter += 1;   // increments only in memory
  const nnnn = String(this.todayCounter).padStart(4, "0");
  return `edit_${key}_${nnnn}`;
}
```

Two instances that both call `scanMaxCounterForKey` before either appends will
both obtain `max = N`, then both produce `edit_YYYYMMDD_000(N+1)`.

## Reproducing failing test

This test is expected to **FAIL** on current code.

```typescript
// Add as a new describe block in edit-log.test.ts

describe("EditLog concurrent-instance safety", () => {
  it("two instances on the same path do not produce duplicate edit_ids", () => {
    const d = new Date(2026, 3, 30);

    // Both instances start from the same (empty) log.
    const log1 = new EditLog(tmpRoot);
    const log2 = new EditLog(tmpRoot);

    const ids: string[] = [];

    // Alternate appends: log1, log2, log1, log2 ...
    for (let i = 0; i < 6; i++) {
      const active = i % 2 === 0 ? log1 : log2;
      const id = active.nextEditId(d);
      ids.push(id);
      active.append({
        edit_id: id,
        timestamp: "2026-04-30T10:00:00+09:00",
        tool_name: "edit_refactor_only",
        target_file: "src/foo.ts",
        rationale: `entry ${i}`,
        risk_level: "low",
        test_files: [],
        patch_size_bytes: 1,
        applied: true,
        warnings: [],
      });
    }

    // All six IDs must be unique.
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("large-entry concurrent appends produce no interleaved bytes within a line", () => {
    // Each entry has a >4 KB rationale to stress kernel write atomicity.
    const largeRationale = "x".repeat(5000);
    const d = new Date(2026, 3, 30);

    const log1 = new EditLog(tmpRoot);
    const log2 = new EditLog(tmpRoot);

    const makeEntry = (id: string): EditLogEntry => ({
      edit_id: id,
      timestamp: "2026-04-30T10:00:00+09:00",
      tool_name: "edit_refactor_only",
      target_file: "src/foo.ts",
      rationale: largeRationale,
      risk_level: "low",
      test_files: [],
      patch_size_bytes: largeRationale.length,
      applied: true,
      warnings: [],
    });

    for (let i = 0; i < 4; i++) {
      const active = i % 2 === 0 ? log1 : log2;
      const id = active.nextEditId(d);
      active.append(makeEntry(id));
    }

    // Every line in the raw file must be individually valid JSON.
    const raw = fs.readFileSync(
      path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl"),
      "utf8",
    );
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(4);

    for (const line of lines) {
      // Must parse without throwing (no interleaved bytes from another write).
      expect(() => JSON.parse(line)).not.toThrow();
      // Must contain the expected large rationale value, not a partial.
      const parsed = JSON.parse(line) as { rationale?: string };
      expect(parsed.rationale).toBe(largeRationale);
    }
  });
});
```

**Why the first test fails:** `log1.nextEditId(d)` and `log2.nextEditId(d)`
both call `scanMaxCounterForKey("20260430")` against an empty file and both
get `max = 0`.  Both then produce `edit_20260430_0001` on their first call,
yielding duplicate IDs.

**Why the second test may or may not fail:** POSIX guarantees that writes
smaller than `PIPE_BUF` (~4 KB) to `O_APPEND` file descriptors are atomic.
Writes larger than this limit may be split.  The 5 KB rationale exercises the
non-atomic boundary; whether the test fails depends on kernel scheduling.  On
Linux with `ext4`/`tmpfs` the write is typically atomic up to a page, but
this is not guaranteed and the test documents the risk.

## Expected vs actual

**Expected:** All `edit_id` values emitted by any number of `EditLog`
instances sharing the same `logPath` are globally unique.

**Actual (current):** Two freshly constructed instances produce the same
sequence of IDs because each reads the same max counter from disk and
increments independently in memory.

## Suggested fix direction

Options (in increasing complexity):

1. **Re-scan on every `nextEditId` call** (simplest, safe for low-volume
   use): remove the in-process counter and always call
   `scanMaxCounterForKey()` just before incrementing.  Costly for high-volume
   use but correct.

2. **Advisory file lock** (`lockfile` or a `.lock` file with `O_EXCL`):
   acquire a lock for the duration of `nextEditId` + `append`.  Correct and
   safe, but adds latency under contention.

3. **Append a placeholder line to claim the ID** atomically (advanced):
   use `O_APPEND` atomicity to write a minimal reservation line, then
   replace it.  Fragile; not recommended.

Option 1 is sufficient for the MVP given the expected call frequency.

## Out of scope notes

Multi-process file locking and distributed counter coordination are out of
scope for MVP (SPEC §11).  The issue documents the gap and proposes a fix
direction.  The `edit_id` uniqueness guarantee should be documented as
"best-effort within a single process" in `SPEC.md` if Option 1 is not adopted
before v0.1.3.

---
created_at: 2026-05-03T01:05:00+09:00
id: dogfood-2026-05-03-1113
category: ux/audit-log
severity: low
target_file: src/state/edit-log.ts
related_files:
  - src/tools/apply.ts
  - issues/2026-05-02-1101-edit-create-file-no-implicit-mkdir.md
discovered_in: 2026-05-03 v0.2.1 dogfood agent-burden audit
---

# [UX] Validation rejection consumes the daily `edit_id` counter, polluting the sequence

## Status

✅ **RESOLVED** by PR #61 (merged 2026-05-02, commit `81f58b9`).
Rejected typed_edit calls now produce `reject_<key>_<8-hex>` handles
via the new `EditLog.nextRejectId(now)`; the daily
`edit_<key>_<NNNN>` counter only advances on issued declarations.
Option 1 of this filing was taken.

## Concrete behavior

`edit_id` is allocated as `edit_<YYYYMMDD>_<NNNN>` from a
monotonically-incrementing daily counter. The counter advances on
**every** typed_edit call — successful or rejected. Result: rejected
declarations leave permanent gaps in the sequence of "real" edits.

Sample audit log fragment from a real session:

```
edit_20260503_0001  phase=rejected  // (sha mismatch typo)
edit_20260503_0002  phase=issued    // (real edit)
edit_20260503_0003  phase=rejected  // (test_files cardinality)
edit_20260503_0004  phase=issued    // (next real edit)
```

The "real" edits are 2 of 4. Anyone reconciling by edit_id has to
filter out rejection entries, and the IDs themselves don't carry
information about success rate.

## Why this matters

- Long-term audit log noise: rejection entries accumulate, and the
  counter sequence becomes a poor proxy for "how many real edits".
- v0.1.5 dogfood (issue 1101) flagged this in the context of
  `edit_create_file` + missing parent dir, where every "first try"
  rejection costs an edit_id.

## Options

1. **Don't pre-allocate edit_id for rejections** — generate a
   different identifier (e.g., `reject_<ts>_<random>`) for the
   rejection log entry. The success counter advances only on issued.
2. **Keep current behavior** — edit_id is a "declaration id", not a
   "successful edit id". The audit log needs reconciliation by phase
   either way; the cost is naming, not semantics.
3. **Compact retroactively** — periodic log compaction collapses
   rejection-only edit_ids into a single "rejection batch" entry.
   Adds machinery; out of scope per Article 7.

Option 1 is the cleanest direction; it's a small implementation
change in `src/tools/apply.ts` (allocate id later) and `edit-log.ts`
schema (RejectedEntry's edit_id becomes a non-sequential reject id).

## Severity

Low — cosmetic / audit-quality; no functional impact.

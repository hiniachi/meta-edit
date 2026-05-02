---
id: a9-03
category: bug
severity: MEDIUM
affected_files:
  - src/cli/log-cmd.ts
  - src/cli/summary-cmd.ts
test_file: src/cli/log-cmd.test.ts
---

# `--since` フィルタ時に不正タイムスタンプを持つエントリが無音で除外される

## 概要

`EditLogEntrySchema` は `timestamp` フィールドを `z.string()` としか検証しない。
そのため手書き編集や将来のバグでタイムスタンプが `"not-a-date"` のような
パース不能な文字列になったエントリも `readAll()` が返す。

このエントリを `filterEntries` / `runSummaryCommand` に `--since` フィルタ付きで
渡すと、`new Date("not-a-date").getTime()` が `NaN` になり
`Number.isFinite(NaN)` が `false` を返すため、エントリは **無音で除外される**。
一方で `--since` なしの場合は同じエントリが含まれる。

この非一貫性はテストされておらず、オペレータが「`--since` あり」と「なし」で
異なる合計件数を目にしたとき、ログに欠陥エントリが混入していることに気付けない。

## 該当箇所

```typescript
// src/cli/log-cmd.ts:35-39
if (filters.since !== undefined) {
  const t = parseTimestamp(e.timestamp);
  if (t === null) return false;   // ← NaN → null → 無音で除外
  if (t.getTime() < filters.since.getTime()) return false;
}
```

```typescript
// src/cli/summary-cmd.ts:33-37
all.filter((e) => {
  const t = new Date(e.timestamp).getTime();
  return Number.isFinite(t) && t >= (options.since as Date).getTime();
  //     ↑ NaN は false → 無音で除外
})
```

`EditLogEntrySchema` でのタイムスタンプ検証:
```typescript
// src/state/edit-log.ts:22
export const EditLogEntrySchema = z.object({
  // ...
  timestamp: z.string(),   // ← 有効な日付形式かどうかを検証しない
  // ...
});
```

## 再現テスト (重要)

以下のテストは `filterEntries` の挙動を実際に示し、現在 FAIL する。

```typescript
import { describe, it, expect } from 'bun:test';
import { filterEntries } from './log-cmd.js';
import type { EditLogEntry } from '../state/edit-log.js';

function entry(overrides: Partial<EditLogEntry> = {}): EditLogEntry {
  return {
    edit_id: "edit_20260430_0001",
    timestamp: "2026-04-30T10:00:00+09:00",
    tool_name: "edit_boundary_condition",
    target_file: "src/foo.ts",
    rationale: "test",
    risk_level: "medium",
    test_files: ["tests/foo.test.ts"],
    patch_size_bytes: 42,
    applied: true,
    warnings: [],
    ...overrides,
  };
}

describe("filterEntries — invalid timestamp consistency", () => {
  it("--since なしでは無効タイムスタンプを含む全エントリを返す", () => {
    const invalid = entry({ edit_id: "edit_20260430_0002", timestamp: "not-a-date" });
    const valid = entry({ edit_id: "edit_20260430_0001" });
    // フィルタなし: 2件返る (Zod は通過済みなので readAll は両方返す)
    expect(filterEntries([valid, invalid], {}).length).toBe(2);
  });

  it("--since ありでは無効タイムスタンプのエントリが無音除外され件数が変わる", () => {
    const invalid = entry({ edit_id: "edit_20260430_0002", timestamp: "not-a-date" });
    const valid = entry({ edit_id: "edit_20260430_0001" });
    const since = new Date("2026-01-01T00:00:00Z");

    const result = filterEntries([valid, invalid], { since });

    // BUG: 無効タイムスタンプのエントリは無音除外され 1 件だけ返る
    // 一貫した挙動なら --since あり/なしで件数は変わらないはず
    expect(result.length).toBe(2);   // ← FAILS: 実際は 1 が返る
  });
});
```

## 期待される挙動

`--since` フィルタ使用時に不正タイムスタンプのエントリが除外されるなら、
その挙動は明示的にドキュメント化され、かつ `--since` なしでも同様に除外
されるか、または警告として `err` ストリームに報告されるべき。

選択肢:
1. **保守的除外+警告**: タイムスタンプが解析不能な場合は `err` に警告を出し
   フィルタあり/なし両方で除外する（一貫性を保つ）
2. **スキーマ強化**: `EditLogEntrySchema` の `timestamp` を
   `z.string().datetime({ offset: true })` に強化し、不正タイムスタンプを
   `readAll()` 時点で弾く（根本解決）

## 推奨される修正方針

スキーマ強化（選択肢 2）が最もクリーンだが、既存ログとの後方互換性を
破る可能性がある。短期的には `filterEntries` / `runSummaryCommand` に
`if (t === null) { err.warn(...)` のパスを追加してオペレータに可視化する。

## 確信度

高 — 再現テストは上記の通りコピペ実行で FAIL することを確認済み。
現行 Zod スキーマが `timestamp: z.string()` であることも確認済み。

---
id: a9-02
category: bug
severity: MEDIUM
affected_files:
  - src/cli/log-cmd.ts
test_file: src/cli/log-cmd.test.ts
---

# `parseLogArgs` が重複フラグを黙って受け入れ、最後の値で上書きする

## 概要

`src/cli/log-cmd.ts` の `parseLogArgs` は `--since`・`--tool`・`--risk` の
重複を検出しない。同じフラグを 2 回渡すと後の値で前の値が黙って上書きされる。
一方、同じファイルの姉妹関数 `parseSummaryArgs` は `--since` の重複を明示的に
検出してエラーを返す。この非一貫性により、ユーザーが誤って
`meta-edit log --since A --since B` と入力したとき、エラーになると思いきや
`B` を使って静かに動作し続ける。

## 該当箇所

```typescript
// src/cli/log-cmd.ts:52-77
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--tool") {
    const v = argv[++i];
    if (v === undefined) return { ok: false, error: "--tool requires a value" };
    filters.tool = v;           // ← 重複チェックなし。前の値を上書き
  } else if (arg === "--risk") {
    const v = argv[++i];
    if (v === undefined) return { ok: false, error: "--risk requires a value" };
    // ...
    filters.risk = v;           // ← 重複チェックなし
  } else if (arg === "--since") {
    const v = argv[++i];
    if (v === undefined) return { ok: false, error: "--since requires a date" };
    const d = parseSinceDate(v);
    if (d === null) { return { ok: false, error: ... }; }
    filters.since = d;          // ← 重複チェックなし。parseSummaryArgs と挙動が違う
  }
}
```

```typescript
// src/cli/summary-cmd.ts:133-135 — 正しい実装
if (sinceSeen) {
  return { ok: false, error: "--since may only appear once" };
}
sinceSeen = true;
```

## 再現テスト (重要)

以下のテストは現在 `log-cmd.test.ts` に存在せず、実行すると FAIL する。

```typescript
import { describe, it, expect } from 'bun:test';
import { parseLogArgs } from './log-cmd.js';

describe("parseLogArgs — duplicate flag rejection", () => {
  it("rejects duplicate --since (mirrors parseSummaryArgs contract)", () => {
    const r = parseLogArgs(["--since", "2026-04-01", "--since", "2026-04-30"]);
    // 現在 ok: true, filters.since = new Date("2026-04-30") で PASS してしまう
    expect(r.ok).toBe(false);  // ← FAILS
  });

  it("rejects duplicate --tool", () => {
    const r = parseLogArgs([
      "--tool", "edit_refactor_only",
      "--tool", "edit_boundary_condition",
    ]);
    // 現在 ok: true, filters.tool = "edit_boundary_condition" で PASS してしまう
    expect(r.ok).toBe(false);  // ← FAILS
  });

  it("rejects duplicate --risk", () => {
    const r = parseLogArgs(["--risk", "low", "--risk", "high"]);
    // 現在 ok: true, filters.risk = "high" で PASS してしまう
    expect(r.ok).toBe(false);  // ← FAILS
  });
});
```

## 期待される挙動

`parseLogArgs` は各フラグが最大 1 回しか指定できないことを保証し、重複時は
`{ ok: false, error: "--since may only appear once" }` （または同様のメッセージ）
を返すべき。これは `parseSummaryArgs` の既存動作と一貫する。

## 推奨される修正方針

`parseSummaryArgs` と同様に `toolSeen`・`riskSeen`・`sinceSeen` フラグを
導入し、2 回目の出現時にエラーを返す。あるいは既出フラグを Set で管理する。

## 確信度

高 — 再現テストは上記の通りコピペ実行で FAIL することを確認済み。
`parseSummaryArgs` との不整合は同ファイル内で並べると明白。

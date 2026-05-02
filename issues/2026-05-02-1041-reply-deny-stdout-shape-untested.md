---
id: a9-01
category: test-quality
severity: MEDIUM
affected_files:
  - src/hooks/hook-runtime.ts
test_file: src/hooks/hook-runtime.test.ts
---

# `replyDeny` stdout JSON shape not verified by any unit test

## 概要

`hook-runtime.ts` の `replyDeny(reason)` は Claude Code のフック・プロトコルに従い、
標準出力に特定の JSON 構造を書き出す。この JSON がプロトコル外の形式になると
Claude Code はそれを「deny」として解釈せず、フックが何も制限しない状態（Allow
のまま）に見えてしまう。しかし `hook-runtime.test.ts` は `readStdin` しか
テストしておらず、`replyDeny` と `replyAllow` の stdout 出力を検証するテストが
一切存在しない。

## 該当箇所

```typescript
// src/hooks/hook-runtime.ts:44-54
export function replyDeny(reason: string): number {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}
```

`hook-runtime.test.ts` の `readStdin — fail-closed behaviour` ブロックには
`replyDeny` / `replyAllow` に関するテストが一つも存在しない。

## 再現テスト (重要)

以下のテストは **現在 test ファイルに存在しない**（それが品質問題の本体）。
追加すれば現行実装では PASS するが、`permissionDecision` → `decision` などの
誤ったリファクタが行われた際に確実に検出できる。

```typescript
import { describe, it, expect } from 'bun:test';
import { replyDeny, replyAllow } from './hook-runtime.js';

// ---------------------------------------------------------------------------
// テスト補助: process.stdout.write の出力を一時的にキャプチャ
// ---------------------------------------------------------------------------
function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (
    chunk: string
  ) => { chunks.push(chunk); return true; };
  try {
    fn();
  } finally {
    (process.stdout as unknown as { write: (s: string) => boolean }).write =
      original as (s: string) => boolean;
  }
  return chunks.join('');
}

describe("replyDeny — stdout protocol shape", () => {
  it("writes valid JSON with hookSpecificOutput.permissionDecision === 'deny'", () => {
    const out = captureStdout(() => replyDeny("blocked by meta-edit"));
    // 現在このテストが存在しないため、次のアサーションはいずれも未保護:
    const parsed = JSON.parse(out) as {
      hookSpecificOutput?: {
        permissionDecision?: unknown;
        permissionDecisionReason?: unknown;
        hookEventName?: unknown;
      };
    };
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput?.permissionDecisionReason).toBe(
      "blocked by meta-edit"
    );
    expect(parsed.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
  });

  it("returns exit code 0", () => {
    captureStdout(() => {
      const code = replyDeny("x");
      expect(code).toBe(0);
    });
  });
});

describe("replyAllow — stdout behaviour", () => {
  it("writes nothing to stdout (0 bytes)", () => {
    const out = captureStdout(() => replyAllow());
    expect(out).toBe("");
  });

  it("returns exit code 0", () => {
    const code = replyAllow();
    expect(code).toBe(0);
  });
});
```

## 期待される挙動

- `replyDeny(reason)` は `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }` を JSON として stdout に書き出す
- `replyAllow()` は stdout に何も書き出さず (または空文字列)、`0` を返す
- 両関数とも戻り値 `0` を返す（呼び出し側がこれを `process.exit(code)` に渡す）

## 推奨される修正方針

上記テストを `src/hooks/hook-runtime.test.ts` の末尾に追加する。
`captureStdout` ヘルパーは `withMockStdin` と同じパターンで実装できる。

## 確信度

高 — テストが存在しないことは機械的に確認可能。現行実装は正しいが、
`hookSpecificOutput` / `permissionDecision` キー名のリファクタ等で
無音の退行が起きるリスクがある。フックの deny 機能はメタ編集の
セキュリティ中核であり、回帰保護がない状態は許容できない。

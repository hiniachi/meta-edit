---
created_at: 2026-05-01T09:12:00+09:00
category: test-quality
severity: medium
target_file: src/hooks/hook-runtime.ts
target_lines: 15-33
related_test: src/hooks/hook-runtime.test.ts
reviewed_files:
  - src/hooks/hook-runtime.ts
  - src/hooks/hook-runtime.test.ts
  - src/hooks/deny-raw-edit.ts
---

# `readStdin()` の誤命名テストが null 解決の型違反を隠蔽し hook クラッシュを誘発する

## 概要

`hook-runtime.test.ts` の `"rejects on bare string value (not an object)"` というテストは名前に反して `resolves.toEqual(null)` をアサートしており、`readStdin()` が JSON `"null"` 入力に対して `null` で解決することを文書化している。`readStdin()` の返り型は `Promise<HookEvent>` = `Promise<Record<string, unknown>>` だが `null` は `Record` ではない。`deny-raw-edit.ts` などの hook スクリプトは `event["tool_name"]` にアクセスするため、`event` が `null` の場合に `TypeError: Cannot read properties of null` が発生しプロセスが exit 2 で終了する。fail-closed なので結果的には安全だが、テスト名は動作を誤表現しており、アサーションも「これは望ましくない現状動作」を示すべきであるのに曖昧なまま放置されている。

## 該当箇所

```typescript
// src/hooks/hook-runtime.test.ts:45-54
it("rejects on bare string value (not an object)", async () => {
  // This is the critical path: malformed input must reject so that the
  // hook exits 2 (blocked) rather than silently allowing the tool call.
  await expect(
    withMockStdin("null", () => readStdin()),
  ).resolves.toEqual(null as unknown as Record<string, unknown>);
  // ^ null parses; document that we get it back (current behaviour).
  // A stricter fix would reject non-object payloads too — see fix direction.
});
```

テスト名: "rejects on bare string value" → 実態: `resolves`
コメント: "A stricter fix would reject non-object payloads too" → TODO として放置

関連する hook の動作:
```typescript
// src/hooks/deny-raw-edit.ts:29-31
const event = await readStdin();  // resolves with null
const toolName = typeof event["tool_name"] === "string"  // TypeError: null["tool_name"]
  ? event["tool_name"] : "";
```

## 再現テスト (重要)

```typescript
import { describe, it, expect } from 'bun:test';
import { Readable } from 'node:stream';
import { readStdin } from './hook-runtime.js';

async function withMockStdin<T>(data: string, fn: () => Promise<T>): Promise<T> {
  const original = process.stdin;
  const mock = Readable.from((async function* () { yield Buffer.from(data); })());
  (process as NodeJS.Process & { stdin: Readable }).stdin = mock as unknown as typeof process.stdin;
  try { return await fn(); }
  finally {
    (process as NodeJS.Process & { stdin: Readable }).stdin = original as unknown as typeof process.stdin;
  }
}

describe('readStdin — non-object JSON input should reject', () => {
  it('rejects when stdin is JSON null (not a Record<string, unknown>)', async () => {
    // Claude Code always sends a JSON object. If null arrives,
    // readStdin() should reject so the hook exits 2 (fail-closed) cleanly,
    // instead of resolving null and crashing the hook script with TypeError.
    //
    // Currently FAILS: readStdin() resolves with null.
    await expect(
      withMockStdin('null', () => readStdin()),
    ).rejects.toThrow();
  });

  it('rejects when stdin is a JSON array (not a Record<string, unknown>)', async () => {
    // Currently FAILS: JSON.parse('["foo"]') resolves with an array.
    await expect(
      withMockStdin('["foo"]', () => readStdin()),
    ).rejects.toThrow();
  });

  it('accessing tool_name on null event throws TypeError (demonstrates crash path)', async () => {
    // Documents what deny-raw-edit.ts would do with a null event.
    const event = await withMockStdin('null', () => readStdin());
    expect(() => {
      // Replicate deny-raw-edit.ts line 30: event["tool_name"]
      const _ = (event as unknown as Record<string, unknown>)['tool_name'];
    }).toThrow(/Cannot read properties of null/);
  });
});
```

## 期待される挙動

`readStdin()` は JSON パース後にオブジェクト型を確認し、`null`・配列・数値・文字列など非オブジェクト値の場合は Promise を reject する。hook スクリプトの catch ハンドラが exit(2) を発行し fail-closed が実現する。

## 推奨される修正方針

```typescript
// src/hooks/hook-runtime.ts — readStdin の end ハンドラ内
process.stdin.on("end", () => {
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) { resolve({}); return; }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    reject(e);
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    reject(new TypeError(`stdin must be a JSON object; got ${parsed === null ? "null" : typeof parsed}`));
    return;
  }
  resolve(parsed as HookEvent);
});
```

## 確信度

高 — テスト名と `resolves` アサーションの矛盾は明確。`deny-raw-edit.ts` の `event["tool_name"]` が null で TypeError を投げることはコード上確定的。fix が fail-closed 保証を強化する。

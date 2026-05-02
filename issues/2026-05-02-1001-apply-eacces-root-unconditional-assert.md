---
created_at: 2026-05-02T10:01:00+09:00
category: test-quality
severity: medium
target_file: src/tools/apply.test.ts
target_lines: 167-198
related_test: src/tools/apply.test.ts
reviewed_files:
  - src/tools/apply.ts
  - src/tools/apply.test.ts
---

# EACCES テストが root で実行すると無条件アサーション失敗（現在 CI で failing）

## 概要

`apply.test.ts:167-198` の `"refuses on EACCES at apply time without modifying the file"` テストは `chmod 0o000` でファイルをロックした後 `expect(result.applied).toBe(false)` を **無条件に** アサートする。しかし root ユーザーは `chmod 0` を無視してファイルを読めるため `applyChanges` が成功し、`result.applied === true` になって assert が失敗する。コメントには「chmod 0 still allows root to read; in CI environments where tests run as root we accept that result.applied may be true」と明記されているが、コードはその条件分岐なしにアサートするため、コメントとコードが矛盾している。現在の実行環境（root）でこのテストは実際に failing している。

同じファイル内の類似テスト（`create.test.ts:227`）では適切に root をスキップしている：
```typescript
if (process.getuid && process.getuid() === 0) return; // root bypasses dir mode
```

## 該当箇所

```typescript
// src/tools/apply.test.ts:167-198
it("refuses on EACCES at apply time without modifying the file", () => {
  if (process.platform === "win32") return; // chmod 0 is meaningless on Windows
  const abs = writeFile("src/locked.ts", "secret\n");
  fs.chmodSync(abs, 0o000);
  try {
    const result = applyChanges(tmpRoot, [
      change("src/locked.ts", "secret\n", "tampered\n"),
    ]);
    expect(result.applied).toBe(false);  // ← root では true になり FAIL
    // The file is untouched; the warnings detail the read failure.
    // chmod 0 still allows root to read; in CI environments where
    // tests run as root we accept that result.applied may be true.
    // Verify only that, on failure, the file is not corrupted.
    ...
    if (!result.applied) {
      expect(after).toBe("secret\n");
    }
  } finally { ... }
});
```

## 再現テスト (重要)

このテスト自体が現在 failing しているため、「失敗するテスト」として提示する：

```bash
bun test src/tools/apply.test.ts
# → (fail) applyChanges > refuses on EACCES at apply time without modifying the file
# Expected: false  Received: true
```

## 期待される挙動

root 環境では chmod 0 がアクセス制御を提供しないため、このテストケースはスキップされるべき。`create.test.ts:227` と同様のガードを先頭に追加する：

```typescript
it("refuses on EACCES at apply time without modifying the file", () => {
  if (process.platform === "win32") return;
  if (typeof process.getuid === "function" && process.getuid() === 0) return; // root bypasses chmod 0
  const abs = writeFile("src/locked.ts", "secret\n");
  // ... 残りは変更なし
});
```

## 推奨される修正方針

テストの先頭に root チェックを追加する。プロダクションコード（`apply.ts`）の変更は不要。コメント内の「we accept that result.applied may be true」という記述は、early return によるスキップの説明として更新する。

## 確信度

高 — テストが現在 failing しており再現確定。同一ファイルの `create.test.ts` の修正パターンが既に存在しており、修正内容も明確。

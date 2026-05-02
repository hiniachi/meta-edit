---
created_at: 2026-05-02T10:02:00+09:00
category: bug
severity: medium
target_file: src/state/edit-log.ts
target_lines: 300-304
related_test: src/state/edit-log.test.ts
reviewed_files:
  - src/state/edit-log.ts
  - src/state/edit-log.test.ts
  - src/cli/log-cmd.ts
---

# `readAll` が `existsSync` → `readFileSync` の TOCTOU で ENOENT をハンドルせずプロセスをクラッシュさせる

## 概要

`EditLog.readAll` は `fs.existsSync(this.logPath)` で存在確認した後 `fs.readFileSync(this.logPath, "utf8")` でファイルを読む。両呼び出しの間にファイルが削除されると（外部プロセス、テスト cleanup、または異常終了）、`readFileSync` が ENOENT をスローする。この例外はキャッチされず、呼び出し元の `runLogCommand` / `runSummaryCommand` へ伝播し、`meta-edit log` や `meta-edit summary` コマンドがフォーマットなしのスタックトレースでクラッシュする。既存テストは `existsSync` が false を返すケース（ファイルが最初から存在しない）のみをカバーしており、TOCTOU ウィンドウは未テスト。

## 該当箇所

```typescript
// src/state/edit-log.ts:300-304
readAll(): EditLogEntry[] {
  if (!fs.existsSync(this.logPath)) {
    return [];
  }
  const text = fs.readFileSync(this.logPath, "utf8");  // ← ここで ENOENT が投げられる可能性
  ...
}
```

## 再現テスト (重要)

```typescript
import { afterEach, beforeEach, describe, it, expect, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EditLog, type EditLogEntry } from "./edit-log.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-toctou-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

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

describe("EditLog.readAll TOCTOU", () => {
  it("returns empty array (does not throw) when file is deleted between existsSync and readFileSync", () => {
    const log = new EditLog(tmpRoot);
    log.append(entry()); // creates the log file

    // Spy on existsSync to delete the file immediately after it returns true,
    // simulating the TOCTOU window.
    const originalExistsSync = fs.existsSync;
    const spy = spyOn(fs, "existsSync");
    spy.mockImplementation(((p: unknown) => {
      const result = originalExistsSync(p as string);
      if (result && typeof p === "string" && p.endsWith("edits.jsonl")) {
        // Delete the file after existsSync confirms it exists
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
      return result;
    }) as typeof fs.existsSync);

    try {
      // Current code throws ENOENT here; the fix should return [].
      expect(() => log.readAll()).not.toThrow();
      expect(log.readAll()).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
```

## 期待される挙動

`readAll` は ENOENT のみを「ファイルが存在しない」として扱い `[]` を返すべき。`existsSync` によるプリフライトチェックを除去し、`readFileSync` を直接 try/catch で囲む方がよりシンプルかつ TOCTOU フリーな実装になる：

```typescript
readAll(): EditLogEntry[] {
  let text: string;
  try {
    text = fs.readFileSync(this.logPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  // ... existing line-by-line parsing
}
```

## 推奨される修正方針

`existsSync` + `readFileSync` のパターンを `readFileSync` の try/catch(ENOENT) に置き換える。これにより TOCTOU ウィンドウが完全に解消され、コードもシンプルになる。ENOENT 以外のエラー（EACCES、EIO など）は他のエラーパスと同様に再スローすること。

## 確信度

高 — `existsSync` が true を返した後にファイルを削除すると `readFileSync` が ENOENT をスローすることを実験で確認済み（`bun -e "..."` で再現）。修正パターンは `scanMaxCounterForKey`（同ファイル:338）で既に使われている。

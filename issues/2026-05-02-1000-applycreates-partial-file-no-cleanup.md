---
created_at: 2026-05-02T10:00:00+09:00
category: bug
severity: high
target_file: src/tools/apply.ts
target_lines: 656-688
related_test: src/tools/create.test.ts
reviewed_files:
  - src/tools/apply.ts
  - src/tools/create.test.ts
---

# `applyCreates` が `writeFileSync` 失敗後に `openSync` で作成したファイルを削除しない

## 概要

`applyCreates` の Phase 2 は各ターゲットファイルを `openSync(O_CREAT|O_EXCL|O_NOFOLLOW)` で直接開く。`openSync` が成功してファイルが作成された後、`writeFileSync` または `fsyncSync` が例外を投げた場合、catch ブロックは fd を閉じる（`finally` 経由）が、ディスク上の空ファイル（または部分書き込みファイル）を `unlinkSync` しない。その結果、呼び出しは `applied: false` を返すが、ターゲットパスに空のファイルが残留する。次回の `applyCreates` 呼び出しで lstat プリフライトがそのファイルを検出し「already exists」として拒否するため、ユーザーが手動でファイルを削除するまでリトライができなくなる。

## 該当箇所

```typescript
// src/tools/apply.ts:656-688
let fd: number | null = null;
try {
  fd = fs.openSync(
    w.absolute,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      O_NOFOLLOW,
    0o644,
  );
  fs.writeFileSync(fd, w.output, { encoding: "utf8" });
  fs.fsyncSync(fd);
} catch (e) {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  const reason =
    code === "EEXIST"
      ? `change.file "${w.canonical}" appeared on disk between preflight and create; refusing (raced)`
      : code === "ELOOP"
        ? `change.file "${w.canonical}" resolves through a symlink at the leaf; O_NOFOLLOW refused`
        : `failed to create "${w.canonical}": ${code ?? "ERR"}`;
  warnings.push(reason);
  partialWriteWarning();
  return { applied: false, warnings };   // ← ファイルが残留したまま返る
} finally {
  if (fd !== null) {
    try {
      fs.closeSync(fd);  // fd は閉じるがファイルは削除しない
    } catch {
      // ignore close errors
    }
  }
}
```

## 再現テスト (重要)

```typescript
import { afterEach, beforeEach, describe, it, expect, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyCreates } from "./apply.js";
import type { ContentChange } from "./common.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-create-cleanup-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function create(canonical: string, newContent: string): ContentChange {
  return { canonical, oldContent: "", newContent };
}

describe("applyCreates write-failure cleanup", () => {
  it("removes the file created by openSync when writeFileSync fails (ENOSPC simulation)", () => {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });

    const originalWriteFileSync = fs.writeFileSync;
    let writeCallCount = 0;
    const spy = spyOn(fs, "writeFileSync");
    spy.mockImplementation(((fdOrPath: unknown, ...args: unknown[]) => {
      // Throw ENOSPC on the first fd-based write (the applyCreates content write)
      if (typeof fdOrPath === "number") {
        writeCallCount++;
        if (writeCallCount === 1) {
          const err = Object.assign(new Error("ENOSPC: no space left on device, write"), {
            code: "ENOSPC",
          });
          throw err;
        }
      }
      return (originalWriteFileSync as Function)(fdOrPath, ...args);
    }) as typeof fs.writeFileSync);

    try {
      const result = applyCreates(tmpRoot, [create("src/new.ts", "alpha\n")]);

      // The call must fail
      expect(result.applied).toBe(false);
      if (!result.applied) {
        expect(result.warnings.some((w) => w.includes("src/new.ts"))).toBe(true);
      }

      // CRITICAL: the partially-created file must NOT remain on disk.
      // Current code FAILS this assertion — the empty file created by openSync
      // is left behind and blocks any retry.
      expect(fs.existsSync(path.join(tmpRoot, "src/new.ts"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
```

## 期待される挙動

`writeFileSync` または `fsyncSync` が例外を投げた後、`applyCreates` は `openSync` で作成されたファイルを `unlinkSync` で削除してから `{ applied: false }` を返すべき。`applyChanges` の temp+rename 方式とは対照的に `applyCreates` はターゲットを直接開くため、書き込み失敗後の明示的なクリーンアップが必要。

## 推奨される修正方針

catch ブロック内で `EEXIST` / `ELOOP` 以外のエラー（かつ `fd !== null` のとき）に対して `fs.unlinkSync(w.absolute)` を try/catch で呼び出し、作成されたファイルを削除する。EEXIST と ELOOP は `openSync` 自体が失敗した場合（ファイル未作成）なので cleanup 不要。

```typescript
} catch (e) {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  // EEXIST / ELOOP: openSync failed — file was never created
  if (fd !== null && code !== "EEXIST" && code !== "ELOOP") {
    try { fs.unlinkSync(w.absolute); } catch { /* ignore */ }
  }
  // ... existing reason / partialWriteWarning / return
}
```

## 確信度

高 — `applyChanges` は同様の状況に対して temp ファイルを `cleanupTemp` で削除している。`applyCreates` でその cleanup がないのは構造的な欠落であり、テストのモックを使って再現可能。

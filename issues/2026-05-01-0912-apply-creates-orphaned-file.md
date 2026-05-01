---
created_at: 2026-05-01T09:12:00+09:00
category: bug
severity: medium
target_file: src/tools/apply.ts
target_lines: 656-705
related_test: src/tools/create.test.ts
reviewed_files:
  - src/tools/apply.ts
  - src/tools/create.test.ts
---

# `applyCreates` が `writeFileSync` 失敗後に空ファイルを残しリトライを妨害する

## 概要

`applyCreates` は `openSync` で新規ファイルを作成した後に `writeFileSync` が失敗した場合 (ENOSPC・EIO など)、作成済みの空ファイルをクリーンアップしない。`applied: false` を返すが空ファイルがディスクに残るため、同じパスへのリトライが「already exists」エラーで拒否される。ユーザーは手動で空ファイルを削除しなければリトライできない。既存のテストはすべて `openSync` 自体が失敗するケース (EACCES・EEXIST など) のみを扱っており、open 成功 + write 失敗のパスには到達していない。

## 該当箇所

```typescript
// src/tools/apply.ts:656-705
let fd: number | null = null;
try {
  fd = fs.openSync(
    w.absolute,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
    0o644,
  );
  fs.writeFileSync(fd, w.output, { encoding: "utf8" });  // ← ここが ENOSPC で失敗
  fs.fsyncSync(fd);
} catch (e) {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  const reason =
    code === "EEXIST"
      ? `...`
      : code === "ELOOP"
        ? `...`
        : `failed to create "${w.canonical}": ${code ?? "ERR"}`;
  warnings.push(reason);
  partialWriteWarning();   // ← touchedAbsolutePaths は空なので何もしない
  return { applied: false, warnings };
  // ↑ fd は finally で close される (ファイルは存在したまま)
} finally {
  if (fd !== null) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

touchedAbsolutePaths.push(w.absolute);  // ← 到達しない
```

`openSync` が成功すると `w.absolute` に 0 バイトのファイルが作られる。`writeFileSync` が失敗すると catch が走り `fd` が閉じられるが、ファイルは削除されない。`touchedAbsolutePaths` は空なので `partialWriteWarning` は何も出力しない。

## 再現テスト (重要)

以下を `src/tools/create.test.ts` に追加すると **現状のコードで失敗する**:

```typescript
import { afterEach, beforeEach, describe, it, expect, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyCreates } from './apply.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-edit-orphan-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('applyCreates — orphaned file on write failure', () => {
  it('does not leave an empty file when writeFileSync fails after openSync succeeds', () => {
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    const targetPath = path.join(tmpRoot, 'src', 'new.ts');

    // Simulate ENOSPC: openSync succeeds (file is created), writeFileSync throws.
    const spy = spyOn(fs, 'writeFileSync');
    spy.mockImplementationOnce(() => {
      const err = Object.assign(new Error('No space left on device'), {
        code: 'ENOSPC',
      });
      throw err;
    });

    let result: Awaited<ReturnType<typeof applyCreates>>;
    try {
      result = applyCreates(tmpRoot, [
        { canonical: 'src/new.ts', oldContent: '', newContent: 'hello\n' },
      ]);
    } finally {
      spy.mockRestore();
    }

    expect(result.applied).toBe(false);
    expect(
      result.warnings.some((w) => w.includes('src/new.ts') && w.includes('ENOSPC')),
    ).toBe(true);

    // Currently FAILS: the 0-byte file created by openSync is not cleaned up.
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it('does not block a retry after a write-failure leaves an orphan', () => {
    // A follow-up symptom: if the empty file is not cleaned up, a retry
    // gets "already exists" instead of a clear write-failure message.
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });

    const spy = spyOn(fs, 'writeFileSync');
    spy.mockImplementationOnce(() => {
      throw Object.assign(new Error('EIO'), { code: 'EIO' });
    });

    try {
      applyCreates(tmpRoot, [
        { canonical: 'src/retry.ts', oldContent: '', newContent: 'v1\n' },
      ]);
    } finally {
      spy.mockRestore();
    }

    // Retry (no mock — write now succeeds).
    const retry = applyCreates(tmpRoot, [
      { canonical: 'src/retry.ts', oldContent: '', newContent: 'v1\n' },
    ]);

    // Currently FAILS: retry gets "already exists" because the orphan is present.
    expect(retry.applied).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, 'src/retry.ts'), 'utf8')).toBe('v1\n');
  });
});
```

## 期待される挙動

`openSync` 成功後に `writeFileSync` または `fsyncSync` が失敗した場合、`applyCreates` はそのファイルを `unlinkSync` でクリーンアップしてから `applied: false` を返す。これによりリトライが清潔な状態で再試行できる。

## 推奨される修正方針

catch ブロック内で `fd !== null` かつ `EEXIST` / `ELOOP` 以外のエラー (つまり我々が作成したファイル) を対象に `fs.unlinkSync(w.absolute)` を呼ぶ:

```typescript
} catch (e) {
  const code = ...;
  // openSync が作ったファイルを書き込みエラー時に削除
  if (fd !== null && code !== 'EEXIST' && code !== 'ELOOP') {
    try { fs.unlinkSync(w.absolute); } catch { /* best-effort */ }
  }
  const reason = ...;
  warnings.push(reason);
  partialWriteWarning();
  return { applied: false, warnings };
```

## 確信度

高 — コードパスは明確で、`create.test.ts` に open 成功 + write 失敗のケースは存在しない。`spyOn(fs, 'writeFileSync')` で再現可能 (同パターンが `edit-log.test.ts` で使用済み)。

---
created_at: 2026-05-01T09:12:00+09:00
category: bug
severity: medium
target_file: src/cli/summary-cmd.ts
target_lines: 15-19
related_test: src/cli/summary-cmd.test.ts
reviewed_files:
  - src/cli/summary-cmd.ts
  - src/cli/summary-cmd.test.ts
---

# `stripAnsi` leaks content of ST-terminated OSC sequences into CLI output

## 概要

`summary-cmd.ts` の `stripAnsi` 関数は BEL 終端 (`\x1b] ... \x07`) の OSC シーケンスは完全に除去するが、ST 終端 (`\x1b] ... \x1b\`) の OSC シーケンスは ESC バイトのペアのみを除去し、シーケンス内容テキストをそのまま出力に残す。`target_file` に `\x1b]0;INJECTED\x1b\\real.ts` を埋め込むと、`meta-edit summary` の出力に `0;INJECTEDreal.ts` が漏洩する。既存テストは `\x1b` バイトの不在のみを検査するため、この内容漏洩を検出できない。issue 026 が修正した BEL 終端ケースとは別の未対処の入力形式である。

## 該当箇所

```typescript
// src/cli/summary-cmd.ts:15-19
function stripAnsi(s: string): string {
  // CSI: ESC [ ... letter ; OSC: ESC ] ... BEL ; plus any bare ESC byte.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07|.)/g, "");
}
```

正規表現の代替 2 は `\][^\x07]*\x07` — BEL (`\x07`) 終端のみを対象とする。ST 終端 (`\x1b\` = ESC + バックスラッシュ) の場合、代替 2 はマッチに失敗し、代替 3 の bare-ESC フォールバック `.` にフォールバックして `\x1b]` の 2 バイトのみを除去する。次の `\x1b\` ペアも同様に除去されるが、内容テキスト (`0;INJECTED`) は残る。

動作トレース (`"\x1b]0;INJECTED\x1b\\real.ts"`):
1. position 0: `\x1b` → alt2 (`\][^\x07]*\x07`) は BEL がないためマッチ失敗 → alt3 `.` が `]` にマッチ → `\x1b]` を除去
2. position 17: `\x1b` → alt3 `.` が `\` にマッチ → `\x1b\` を除去
3. 結果: `"0;INJECTEDreal.ts"` (内容が漏洩)

## 再現テスト (重要)

以下を `src/cli/summary-cmd.test.ts` に追加すると **現状のコードで失敗する**:

```typescript
import { describe, it, expect } from 'bun:test';
import { formatSummary } from './summary-cmd.js';
import type { EditLogEntry } from '../state/edit-log.js';

function entry(overrides: Partial<EditLogEntry> = {}): EditLogEntry {
  return {
    edit_id: 'edit_20260501_0001',
    timestamp: '2026-05-01T09:12:00+09:00',
    tool_name: 'edit_boundary_condition',
    target_file: 'src/foo.ts',
    rationale: 'test',
    risk_level: 'medium',
    test_files: ['tests/foo.test.ts'],
    patch_size_bytes: 42,
    applied: true,
    warnings: [],
    ...overrides,
  };
}

describe('stripAnsi — ST-terminated OSC (ESC ] ... ESC \\)', () => {
  it('does NOT expose content of ST-terminated OSC in target_file', () => {
    // ESC ] payload ESC \ — ST-terminated OSC (common in iTerm2, tmux, VSCode)
    const text = formatSummary(
      [entry({ target_file: '\x1b]0;INJECTED_TITLE\x1b\\src/real.ts' })],
      undefined,
    );
    // Currently FAILS: stripAnsi removes \x1b] and \x1b\ but leaves
    // "0;INJECTED_TITLEsrc/real.ts" in the "Files most edited" table.
    expect(text).not.toContain('INJECTED_TITLE');
  });

  it('does NOT expose content of ST-terminated OSC in tool_name', () => {
    const text = formatSummary(
      [entry({ tool_name: '\x1b]0;FAKE_TOOL\x1b\\edit_boundary_condition' })],
      undefined,
    );
    // Currently FAILS: "0;FAKE_TOOL" appears in the By-tool section.
    expect(text).not.toContain('FAKE_TOOL');
  });
});
```

## 期待される挙動

`stripAnsi` はあらゆる OSC シーケンスをバイトと内容ともに完全に除去する:

| 入力 | 期待 | 現状 |
|---|---|---|
| `"\x1b]0;TITLE\x07"` (BEL終端) | `""` | `""` ✓ |
| `"\x1b]0;TITLE\x1b\\"` (ST終端) | `""` | `"0;TITLE"` ✗ |
| `"\x1b]0;TITLE\x1b\\real.ts"` | `"real.ts"` | `"0;TITLEreal.ts"` ✗ |

## 推奨される修正方針

正規表現の OSC 分岐に ST 終端パターンを追加する:

```typescript
// 現状 (BEL終端のみ):
/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07|.)/g

// 修正案 (BEL終端 + ST終端):
/\x1b(?:\[[0-?]*[ -/]*[@-~]|\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)|.)/g
```

または 2 パス方式: 先に `\x1b\][^\x07\x1b]*(?:\x1b\\|\x07)` で OSC を除去してから CSI / bare-ESC を処理する。

## 確信度

高 — 正規表現の動作とトレース結果は確定的。既存の `summary-cmd.test.ts` のテストは `\x1b` バイトの不在のみを検査しており、content 漏洩を検出しない。

---
created_at: 2026-05-02T18:00:00+09:00
id: dogfood-2026-05-02-1102
category: ux/raw-edit-policy
severity: low
target_file: src/hooks/raw-edit-policy.ts
related_test: src/hooks/raw-edit-policy.test.ts
reviewed_files:
  - src/hooks/raw-edit-policy.ts
  - src/hooks/deny-raw-edit.ts
  - src/hooks/bash-write-policy.ts
discovered_in: v0.1.5 self-application (Claude Code plan-mode write blocked)
---

# [UX] `deny-raw-edit` がパスを見ず一律 deny → リポジトリ外の Write も塞ぎ、Claude Code plan-mode 等の workflow を阻害

## 概要

`evaluateRawEdit` (`src/hooks/raw-edit-policy.ts:36`) は `toolName` のみを受け取り、`Edit` / `Write` / `MultiEdit` / `NotebookEdit` を deny する。エントリ `deny-raw-edit.ts` も `tool_input.file_path` を抽出せず `toolName` のみを evaluator に渡しているため、ターゲットパスが meta-edit リポジトリの外であっても一律に deny される。

2026-05-02 の v0.1.5 dogfood セッションで、Claude Code の plan-mode が要求した Write 先 `/home/nia/.claude/plans/elegant-nibbling-valiant.md` (meta-edit リポジトリ外) もこのフックで deny され、plan-mode workflow が中断した。他に影響する例: `~/.claude/...` の設定ファイル編集、`/tmp/scratch.txt` へのスクラッチ書き、他リポジトリ (CLAUDE_PLUGIN_ROOT 外) への Write も同様に塞がれる。

これは meta-edit の設計意図（meta-edit リポジトリ内で typed surface を徹底させる）に対する過剰 deny といえる。

## 該当箇所

```typescript
// src/hooks/raw-edit-policy.ts:36
export function evaluateRawEdit(toolName: string): HookDecision {
  if (LOWER_RAW_EDIT_TOOLS.has(toolName.toLowerCase())) {
    return { decision: "deny", reason: "..." };
  }
  return { decision: "allow" };
}
```

```typescript
// src/hooks/deny-raw-edit.ts エントリポイントも toolName のみを evaluateRawEdit に渡す
// → file_path / notebook_path を取り出していない
```

## 再現

```
# Claude Code plan-mode
# システムが plan ファイル /home/nia/.claude/plans/<name>.md への Write を要求
# → hook で deny、計画ファイル作成不可
```

現実のセッションで見たエラー文:

```
meta-edit forbids the raw "Write" tool. Choose one of the nineteen edit_* tools that match the kind of change you are making (full list: ...). If no edit_* tool fits, stop and ask the user before bypassing the typed surface.
```

ターゲットが meta-edit リポジトリ外であり、typed surface の適用領域外にも関わらず deny が起きている。

## 影響

- **システム workflow 阻害**: Claude Code の plan-mode、他プラグインやスキルがトップレベルで Write を使うケースも同様に塞がれる可能性。
- **ワークアラウンド負担**: これを避けるために一時的に plugin uninstall → 作業 → reinstall を要求される。
- **Severity**: LOW. 誤ったデータ損失やセキュリティインシデントではない、適用領域の誤った拡張による friction。

## 修正方針

3 案、振る舞い変更の小さい順:

1. **何もしない (明示的非対応)**: README/SPEC に「meta-edit をインストール中は他システムツールの Write も塞がれる」と明記、uninstall workaround を案内。仕様と呼ぶ。
2. **パスを受け取るようポリシー拡張、リポジトリ外は allow (推奨)**: `evaluateRawEdit(toolName, filePath, repoRoot)` にシグネチャ拡張。`filePath` が絶対化後に `repoRoot` 配下でなければ allow、都下なら既存の deny。この実装には以下の明確化が必要 (Codex レビュー追加):
   - **`repoRoot` の権威的ソース**: 黙黙と `process.cwd()` を meta-edit リポジトリと見なしたら不意のスコープ拡張・縮小が起こる。`deny-raw-edit.ts` は hooks/hooks.json 経由で起動されるため plugin context を見ている。`CLAUDE_PLUGIN_ROOT` / 明示的 env / hook event の cwd のいずれかを取って `repoRoot` とするかを SPEC で明確にする。
   - **canonical path 計算**: `filePath` は symlink や `..` を含みうるため `realpath` ベースでの比較が要る。`bash-write-policy.ts` の `isInRepoWriteTarget` と同じ哲学 (`bash-write-policy.ts:1096`) をとる。
   - **NotebookEdit カバー**: Edit / Write / MultiEdit は `file_path`、NotebookEdit は `notebook_path` (Claude Code tool_input スキーマ推奨) を明示的に抽出、不足キーは deny を保つ (fail-closed)。
3. **設定で allowlist**: 環境変数 `META_EDIT_ALLOW_RAW_EDIT_PATHS=$HOME/.claude/plans/:/tmp/` のようなリストを受け、一致したターゲットは allow。(2) より柔軟だが設定表面が増える。

(2) が meta-edit の設計意図「meta-edit リポジトリ内で typed surface を徹底」と最も整合し、余分な設定を生やさずに際を明確化できる。ただし (2) は上記 3 点の明確化が前提。

## 範囲外メモ

- meta-edit リポジトリ内の Write は依然 deny。本 issue は「適用領域をリポジトリ内に限定」を主張しているのであり、policy そのものの緩和ではない。
- bash-write-policy 側は `cwd` + safe-sink 分類 + protected-paths を使って redirect target を判定しており (`bash-write-policy.ts:1096`)、明示的な「configured repo root」を 1 フィールドとして持っているわけではない。raw-edit-policy も同じ考え方をとるか、明示的な `repoRoot` を新設するかは仕様議論が要る。
- `target_file` の抽出は Claude Code の tool_input スキーマ依存だが、`Edit`/`Write`/`MultiEdit` は一貫して `file_path`、`NotebookEdit` は `notebook_path` を使うという推奨スキーマが明らか。この issue の本リポでは Claude Code スキーマを検証していないため、修正時にドキュメントソースを明記し、不足キーや未知 tool_input 形式は deny を保つフェールコローセド動作とする。
- 本 issue 内には reproducing test を含めない（dogfood ルール）。修正時に `raw-edit-policy.test.ts` に case を追加する想定。

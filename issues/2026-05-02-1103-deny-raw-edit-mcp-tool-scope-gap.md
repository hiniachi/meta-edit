---
created_at: 2026-05-02T18:30:00+09:00
id: dogfood-2026-05-02-1103
category: security/raw-edit-policy
severity: high
target_file: hooks/hooks.json
related_test: src/hooks/raw-edit-policy.test.ts
reviewed_files:
  - hooks/hooks.json
  - src/hooks/raw-edit-policy.ts
  - src/hooks/deny-raw-edit.ts
  - docs/SPEC.md
discovered_in: v0.1.6 self-application (ctx_execute write to apply.ts during 1101 fix attempt)
---

# [SECURITY] `deny-raw-edit` matcher is tool-name-enumerable; arbitrary MCP write tools (e.g. `ctx_execute`) bypass the typed surface entirely — no hook, no `edits.jsonl` entry

## 概要

meta-edit の typed-surface invariant「meta-edit リポジトリ内の書き込みは全て `edit_*` ツールを経由し、`edits.jsonl` に記録される」は、`hooks/hooks.json` のマッチャー `Edit|Write|MultiEdit|NotebookEdit` と、`evaluateRawEdit` がそのツール名を deny する設計で担保されている。しかし **これは Anthropic サイドの「ラウ raw edit ツール名」をハードコードしたリストでしかなく**、Claude Code / 他ホストにインストールされている他 MCP サーバがファイル書き込み能力を持てば、そのツールは matcher に当たらず、hook は起動しない。

2026-05-02 の v0.1.6 作業セッション中に具体例を観測: agent が `mcp__plugin_context-mode_context-mode__ctx_execute` に Node スクリプトを渡し、`fs.writeFileSync('/home/nia/Desktop/meta-edit/src/tools/apply.ts', ...)` を実行したところ、いちぶいち hook が起動せず、ファイルは書き換わり、`edits.jsonl` には何のエントリも追加されなかった。CLAUDE.md §9 文言（「Use raw Edit/Write after Phase 3: refuse」）も enforcement 仅ではなくトリガされず、合意ベースの制約に長期依存していた。

これは Issue 1100 (「`cat <file> > <in-repo>` を verb-deny が見逯す」) や 1102 (「リポジトリ外 Write も塞ぐ」) とは質が違う: それらは bash hook と raw-edit hook の 内部 ID 調整だが、**本件は 「hook が見ていないツール名」が MCP に存在しうる** という仕様上のスコープ問題。Anthropic に未知の、他者作のファイル書き込み MCP ツールが1つインストールされると、typed-surface invariant はそのたびに縦に規模拡張して化ける。

## 該当箇所

```json
// hooks/hooks.json
"matcher": "Edit|Write|MultiEdit|NotebookEdit"
```

```typescript
// src/hooks/raw-edit-policy.ts
export const RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit", "Write", "MultiEdit", "NotebookEdit",
]);

export function evaluateRawEdit(toolName: string): HookDecision {
  if (LOWER_RAW_EDIT_TOOLS.has(toolName.toLowerCase())) {
    return { decision: "deny", ... };
  }
  return { decision: "allow" };
}
```

## 再現

```javascript
// MCP tool: mcp__plugin_context-mode_context-mode__ctx_execute (language: javascript)
const fs = require('fs');
fs.writeFileSync('/home/nia/Desktop/meta-edit/src/tools/apply.ts', updatedContent, 'utf8');
// → hook 何も起動せず、ファイルは書き換わる。
//   edits.jsonl には何のエントリも追加されない。
```

他に理論上やりうる vector:
- `mcp__*__write_file`, `mcp__*__edit_file`, `mcp__*__create_file` 名の他 MCP ツール
- shell-hosted MCP ツール (eval, run_code) の内部で fs.writeFileSync
- WebFetch / WebSearch ツールが future でダウンロード + write-to-disk をサポートした場合

## 影響

- **typed-surface invariant の重さを損ねる**: meta-edit の設計論点「ツール表面に記述された obligation が AI の思考を形作る」が、その表面にもともと表示されない MCP ツールで trivially 越えられる。
- **audit ログの不完全性**: `edits.jsonl` は 「`edit_*` を通った書き込み」だけ記録しており、他 MCP 経由の書き込みは不可視。
- **CLAUDE.md §9 の意図不復元**: 「Use raw Edit/Write after Phase 3: refuse. If `edit_*` tools are broken, fix them rather than bypass.」 は 「Edit/Write」 と名付けで言及されているため、他 MCP ツールによる bypass は明示的にはカバーされない。
- **Severity: HIGH**. 潜在的に dogfood-001 (printf bypass) / 1100 (cat-redirect) と同類の 「hook を見逯すパターン」 だが、bash レイヤだけではなく MCP レイヤ全体に及ぶ。

## 修正方針

4 案、振る舞い変更の小さい順:

1. **ドキュメントのみ**: `docs/SPEC.md` に「typed-surface invariant は Anthropic 供与の Edit/Write/MultiEdit/NotebookEdit ツールに限り担保される。他 MCP ツールによるファイル書き込みは仕様スコープ外」と明記。CLAUDE.md §9 も 「any write tool, named or future」 に文言拡張。
2. **PostToolUse 監視**: `PostToolUse` フックで 、任意のツール実行後に `git status -- <repo>` / inotify で リポジトリ内ファイルの mtime 変化を検出し、`edits.jsonl` に記録のない変更があれば warn/deny。事後検知型、誤検出表面あり。
3. **MCP-tool ホワイトリスト**: hook matcher を 「明示的に許可された MCP ツール名リスト」とし、とりあえず `mcp__plugin_meta-edit_meta-edit__edit_*` のみを allow、その他のファイル書き込み可能ツールを deny。ホワイトリストの保守コストと多 MCP のインストール動機を損ねるリスクあり。
4. **Anthropic 側 protocol 拡張の要望**: hook イベントに「`writes_to_filesystem: boolean`」メタデータを付加してもらい、Claude Code が MCP ツールのスチーマを見て file-write ツールを自動検出、hook に通知。本質的解決だがオーケストレーションコスト高い。

現実的推奨: **(1) + (2)** を v0.2 で同時に出す。(3) は false-positive 規序とのトレードオフ、(4) は Anthropic 依存。

## 範囲外メモ

- v0.1.5 までの 「hook スコープ」 設計は tool-name ホワイトリストだが、MCP 生態系の拡張によりホワイトリスト以外の tool-name が現実可能になった。 v0.1.5 設計時には Claude Code に context-mode 型ツールは見えていなかったと推定。
- bash-write-policy と同じ 「hook-by-tool-name」 の限界を共有するが、bash は仕事上「他 MCP と並ぶ一つのツール」だけで、本件と同じスコープギャップを抱えている点に注意。
- v0.2 opencode 対応とも関連する: opencode は独自ツール名 (e.g. `edit`, `write`, `apply_patch`) を使うため、ホワイトリストを Anthropic-only にしたままではそちらもカバーされない。
- 本 issue 内には reproducing test を含めない（dogfood ルール）。修正時に `raw-edit-policy.test.ts` に case を追加する想定 (e.g. PostToolUse フック追加時はそちらの test)。

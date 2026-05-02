---
created_at: 2026-05-02T19:45:00+09:00
id: ux-2026-05-02-1105
category: ux/hook-message
severity: low
target_file: src/hooks/raw-edit-policy.ts
related_files:
  - src/hooks/bash-write-policy.ts
  - src/docs-urls.ts
  - src/hooks/raw-edit-policy.test.ts
  - src/hooks/bash-write-policy.test.ts
discovered_in: 2026-05-02 self-application (issue 1103 起票時に deny reason を見て)
---

# [UX] hook の deny reason が長すぎる（GitHub URL + 一般論を含んでいる）

## 現状

### `deny-raw-edit`の reason（`src/hooks/raw-edit-policy.ts:36-46`）

```text
meta-edit forbids the raw "Write" tool. Choose one of the nineteen edit_*
tools that match the kind of change you are making (full list:
https://github.com/hiniachi/meta-edit/blob/v0.1.5/docs/SPEC.md#4-the-nineteen-tool-descriptions).
If no edit_* tool fits, stop and ask the user before bypassing the
typed surface.
```

### `deny-bash-write-bypass` の `denyReason`（`src/hooks/bash-write-policy.ts:1013-1019`）

```text
command matches deny pattern "sed -i". meta-edit reserves direct file
writes for the nineteen edit_* tools; if a formatter or codegen needs
to run, route it through the allowlist
(https://github.com/hiniachi/meta-edit/blob/v0.1.5/docs/SPEC.md#52-deny-bash-write-bypass).
```

## 何が問題か

1. **GitHub URL への参照が出る**。reason は Claude ホストのトランスクリプト + モデルに渡される。モデルが URL をフェッチするとしたら余分なコンテキストコストがかかるし、フェッチしなかったとしても出力トークンを浪費する。
2. **GitHub URL はしばしば誤っている**。`SPEC_TOOLS_URL` / `SPEC_BASH_HOOK_URL` は `VERSION` にピンされるが、実際に URL を踏ませると「タグがまだ作られていない」、「ボトとずれた」の dead link になりうる。ホストトラストコードパスを探させるのはコスト効果が低い。
3. **CLAUDE.md / SPEC.md にある一般論（「適合する edit_* ツールを選べ」「ハマらなければ stop and ask」）を reason ごとに再掲している**。これらはセッション初期にロードされる CLAUDE.md やツール description と重複しており、deny のたびに言う必要はない。reason に言葉を詰め込むほど、「今この呼び出しがなぜ電補されたのか」というただ 1 つの関連 signal が藄される。

## 提案

reason は「**なぜ deny されたか**」の説明に限定する。一般論と参照 URL は落とす。

### `deny-raw-edit`

例（提案）：

```text
meta-edit forbids the raw "Write" tool inside this repository.
```

or

```text
meta-edit denies raw "Write" on in-repo paths; use a typed edit_* MCP tool.
```

序でも 1 行（一文）。「nineteen / edit_* を選べ」という誘導はツール description と CLAUDE.md が既に言っているので重複させない。URL は落とす。

### `deny-bash-write-bypass.denyReason`

例（提案）：

```text
command matches deny pattern "sed -i".
```

参照 URL と 「allowlist にルート」の助言を落とす。今の 「allowlist」 は source 上ドキュメンテーションのみで、ランタイムではチェックせずいずれにしろ意味を持たない (Phase 4 IMPLEMENTATION-LOG より) ので、reason で言及する価値が下がっている。

## 設計原則

- **reason = 「what と why-this-call」のみ**。 What was attempted, what pattern fired.
- **how-to-fix = ツール description / CLAUDE.md / SPEC**。セッション中一度ロードされれば他のツールコールでもモデルは思い出せる。
- **per-call コンテキストコストを重視**。hook は反復して点火される可能性が高いので、reason を 1 行にタイトに保つとセッション全体のノイズを下げられる。

## 影響スコープ

- `src/hooks/raw-edit-policy.ts:36-46` の reason テキストトリム。
- `src/hooks/bash-write-policy.ts:1013-1019` の `denyReason` テキストトリム。
- `src/docs-urls.ts`：`SPEC_TOOLS_URL` と `SPEC_BASH_HOOK_URL` は hook 以外では使われていないように見える（要確認）。hook が使わなくなったら未使用になるので、さらに `SPEC_URL`（meta-edit --help が使う）だけ残して両者は削除、または 「docs / planning のために未使用 export として保存」のいずれか。`docs-urls.ts` コメント（dogfood-009 参照）の背景も読み返して判断。
- テスト：
  - `src/hooks/raw-edit-policy.test.ts`：`reason` の `toContain` assertion を調整。現在 `"meta-edit forbids"` や `"edit_*"` を contain で見ているはずなので、短いテキストでもそれらのサブストリングが含まれるように連動。
  - `src/hooks/bash-write-policy.test.ts`：同様に `"deny pattern"` / pattern 名の contain だけに限定し、URL contain の assertion がもしあれば削除。
- v0.1.5 の `replyAllowWithWarning`（SPEC §5.2 redirect warn）の reason テキストも同様の verbosity チェックをする価値あり（本 issue としては含めて議論 — 実装時に見て同じ姿勢に揃える）。

## 採用判断ポイント

- コストに見合う価値： hook メッセージはセッションごとに何十回点火されうる。 1 行化でトークン × 点火回数の節約効果。小さいが確実。
- AI 行動への影響： deny reason を 1 行にしても AI は「redit_* を選べ」という推奨をツール description から読んでいる（それが meta-edit の仮説そのもの）。処方を reason に重複掏載しなくても行動は変わらないはず。仮説検証以上の例証としても意味がある。
- breaking 性： hook の reason テキストは公開 API ではない。ユーザーが reason を substring match しているスクリプトが外部にあれば壊れるが、それはサポート外。

## 範囲外メモ

- README / SPEC の 「ツール一覧」へのリンクは人間読者向けの UX として保つべき。本 issue は hook reason テキスト（per-call deny メッセージ）に限定。
- `meta-edit --help` / CLI の SPEC リンク表示は以前と同じ（起動時 1 回、AI にそもそも見えていない）なので verbose 問題とは状況が違う。

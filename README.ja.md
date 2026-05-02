# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**言語:** [English](./README.md) · **日本語** · [简体中文](./README.zh-CN.md)

> AI コーディングエージェントの汎用ファイル編集ツールを、**18 種類の編集カテゴリ別ツール**で置き換える MCP サーバです。各ツールの説明文に、その編集に必要となるテスト義務を直接埋め込みます。

## なぜ「型付きの編集」なのか

`CLAUDE.md` に書いた指示はターンを重ねるたびに薄れていきます。Skill は AI 自身が呼ぶと判断したときにしか発火しません。どちらも「モデルが *もう一度読んでくれるかもしれない* テキスト」に依存していて、行動の瞬間に構造的な効力を持ちません。

ツール定義は薄れません。AI がこれから呼び出すツールのスキーマと説明文は、呼び出しのたびに必ず読み込まれます。`meta-edit` は単一の `Edit` プリミティブを 18 種類のカテゴリ別ツールに分け、それぞれの説明文に「いつ使うか」「いつ使ってはいけないか」「どのテストを伴うべきか」「どこで止めてユーザーに尋ねるか」を埋め込みます。「境界値テストを書いてね」と AI が思い出してくれることに賭ける必要はもうありません。

このプロジェクトの賭けは **「ツール表面の形こそが AI の編集挙動を変える」** という命題です。検出でも事後検証でもなく、ツール設計だけで挙動を変える。発想の源は [SQLite のテスト戦略](https://sqlite.org/testing.html)（境界値、MC/DC 条件カバレッジ、異常系テスト、変更ごとのチェックリスト）で、C ライブラリの品質保証の流儀をアプリケーションの編集カテゴリへ翻訳した形になります。仕様の全文は [`docs/SPEC.md`](./docs/SPEC.md)（Part I 憲法 + Part II 派生仕様）、v0.2 以降の検出バックログは [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md) を参照してください。

ステータス：`0.3.1` プレリリース版。v0.2 ではメカニズムを **宣言 + トークン束縛** へ刷新しました（`SPEC.md` Article 5 参照）：MCP サーバは宣言を検証して短命トークンを発行するだけで、実際の書き込みは Claude Code 標準の `Edit` / `Write` が `deny-raw-edit` フックの束縛検証ゲートを通って行います。このリポジトリ自身が単一プラグインの Claude Code マーケットプレイスとして配布され、npm パッケージ `@hiniachi/meta-edit` の形でも提供されます（npm 公開はまだです）。

## 18 種類のツール

```
edit_refactor_only            edit_test_only_change
edit_boundary_condition       edit_boolean_condition
edit_state_transition         edit_db_schema
edit_data_migration           edit_api_contract
edit_serialization            edit_error_handling
edit_retry_timeout            edit_concurrency
edit_external_side_effect     edit_cache_invalidation
edit_permission_logic         edit_dependency_config
edit_policy_change            edit_docs_only
```

各ツールの説明文には次の四点が明示されています。

- いつ使うか
- いつ使ってはいけないか
- 編集にどのテストを伴わせるべきか
- どこで止めてユーザーに尋ねるか

## 観測：AI が立ち止まって質問する

`meta-edit` を初めて自分のリポジトリに自己適用したとき、会話コンテキストはすでに約 80% 埋まっていて、`OBSERVED-FAILURES.md` への追記が必要になりました。当時 17 種類しかなかったツールに、純粋なドキュメント編集にぴったり一致するものはありません。AI は無理に既存ツールを当てはめず、いったん手を止めました。

> OBSERVED-FAILURES.md はドキュメントファイルで、17 種類の `edit_*` ツールのいずれにも厳密には合致しません（説明文はどれも「プロダクションコード」「テストファイル」「ポリシー／ガバナンス」を前提としています）。CLAUDE.md §9 は「該当する `edit_*` ツールが無ければ止めて尋ねる」と指示しています。選択肢は二つあります。(a) `edit_refactor_only` を流用する — その MUST-NOT リスト（演算子変更／ガード句／戻り値構造）は散文には自明に当てはまらず、「観測可能な振る舞いを変えない」という意図とも整合します。(b) `/plugin disable meta-edit` してから素の `Edit` を使う。どちらにしますか？

ここから読み取れることが三つあります。

1. 「止めて尋ねる」指示が **コンテキスト 80%** の段階で守られた。`CLAUDE.md` 型のテキスト指示が普段なら風化するまさにその時点で。
2. AI は仕様の隙間を自分の言葉で言語化した（「17 種類のツールはドキュメントファイルをカバーしていない」）。
3. その結果として、後に 18 番目のツール `edit_docs_only` となる v0.2 エントリを AI 自身が起草した。

呼び出しごとに毎回読まれる「ツール型の指示」が、セッション開始時に一度だけ読まれる「テキスト型の指示」を上回った瞬間でした。（この README 自体も `edit_docs_only` を通じて書き直されています。）

## インストール

### A. Claude Code Plugin marketplace

このリポジトリ自身が単一プラグインのマーケットプレイスとして機能します。一度マーケットプレイスを追加すれば、あとは `/plugin install` で導入できます。

```sh
/plugin marketplace add hiniachi/meta-edit
/plugin install meta-edit@meta-edit
```

これだけで MCP サーバ（18 個の `edit_*` ツール）と 2 つの安全フック（`deny-raw-edit` と `deny-bash-write-bypass`）の両方が自動で有効になります。プラグインは `dist/` に同梱されたビルド済み JavaScript を `node` で実行するだけなので、**ランタイム要件は Node 20+ のみ** です（Bun も `npm install` も不要、ビルド手順も利用者側には発生しません）。

### B. npm パッケージ

```sh
npm install -g @hiniachi/meta-edit
# 安全フックを有効化
meta-edit install-hooks --scope user
```

プロジェクト単位で入れる場合：

```sh
npm install --save-dev @hiniachi/meta-edit
meta-edit install-hooks --scope project
```

Claude Code の MCP 設定にサーバを登録します。

```json
{
  "mcpServers": {
    "meta-edit": { "command": "meta-edit", "args": ["serve"] }
  }
}
```

## ランタイム要件

- **Node 20 LTS 以降**（利用者側）。プラグインも npm bin もパッケージ同梱の `dist/cli.js` を `node` で起動します。
- POSIX 互換のシェル環境（`deny-bash-write-bypass` フック用）。Windows は現時点では対象外です。
- Bun は開発・CI でのみ使用（`bun run build` / `bun test`）。利用者側でのインストールは不要です。

## コマンド

```
meta-edit serve                                            MCP stdio サーバを起動
meta-edit log [--tool NAME] [--risk LEVEL] [--since DATE]  edits.jsonl のエントリを表示
meta-edit summary [--since DATE]                           編集ログの集計を出力
meta-edit install-hooks --scope user|project               Claude Code フックを settings.json に追加
meta-edit uninstall-hooks --scope user|project             Claude Code フックを settings.json から削除
```

### 使用例

```sh
# 4 月以降に追加された境界値系の編集を表示：
meta-edit log --tool edit_boundary_condition --since 2026-04-01

# high / critical だけに絞って表示：
meta-edit log --risk high
meta-edit log --risk critical

# 直近 7 日間の集計（日付は YYYY-MM-DD または ISO 8601 形式）：
meta-edit summary --since 2026-04-23

# 現在のプロジェクトにフックを設定（.claude/settings.json に書き込み）：
meta-edit install-hooks --scope project

# ユーザー全体にフックを設定（~/.claude/settings.json に書き込み）：
meta-edit install-hooks --scope user
```

## 編集ログ

各 typed_edit 呼び出しは `.meta-edit/state/edits.jsonl` に最大 2 行を追記します。スキーマは [`SPEC.md` §6](./docs/SPEC.md) を参照してください。

1. **`issued`** — MCP サーバが宣言を受理してトークンを発行した時点で書き込みます：

   ```json
   {"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:00+09:00","phase":"issued","kind":"edit_boundary_condition","target_file":"src/billing/charge.ts","rationale":"Allow exact-balance charges by changing < to <=","risk_level":"high","test_files":["tests/billing/charge.test.ts"],"binding":[{"file":"src/billing/charge.ts","before_sha256":"…"}],"token":"met_20260502_a3f9b2…"}
   ```

2. **`consumed`** — `deny-raw-edit` フックが対応する標準 Edit / Write の書き込みを認可した時点で書き込みます（PreToolUse、書き込み実行前）：

   ```json
   {"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:02:43+09:00","phase":"consumed","consuming_tool":"Edit"}
   ```

バリデーション失敗は `phase: "rejected"` 1 行で記録され、`audit_error` を非空で持ちます。パッチ本体は記録**しません** — 必要なら VCS 履歴が真の出所です。`issued` だけあって `consumed` のない記録は、宣言が放棄/期限切れになった証拠です。

## CI 連携

リファレンス用のワークフローを [`examples/.github/workflows/meta-edit-summary.yml`](./examples/.github/workflows/meta-edit-summary.yml) に同梱しています。各 PR で `meta-edit summary` を実行し、結果をビルド成果物としてアップロードする内容です。お手元のリポジトリの `.github/workflows/` ディレクトリにコピーしてご利用ください。

## サポート

`meta-edit` で時間が節約できた、あるいは危険な編集を未然に防げたと感じたら、コーヒー一杯のご支援をご検討ください。

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

ご支援は次の用途に使われます。

- 観測された AI の失敗パターンに基づく新しい `edit_*` カテゴリの追加
- 記述だけでは不十分と判明した場合のバックストップとして、軽量 diff 分類器を将来的に実装（[`SPEC.md` Article 2](./docs/SPEC.md) 参照）
- Claude Code Plugin との統合強化

## ライセンス

MIT。[`LICENSE`](./LICENSE) を参照。

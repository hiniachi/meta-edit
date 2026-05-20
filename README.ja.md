# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**言語:** [English](./README.md) · **日本語** · [简体中文](./README.zh-CN.md)

> AIコーディングエージェントの唯一の `Edit` ツールを、**17個の種類別編集ツール**に置き換えるMCPサーバ。各ツールの説明文には、その種類の変更に伴うべきテスト義務が直接書き込まれている。16個の実装ツールには `target: "prod" | "test"` フラグが必須で、テスト編集はその実装種類の監査面に紐づけて記録される。

ファイル編集の枠を越えた応用も含めた、より詳しい解説は[プロジェクトページ](https://hiniachi.github.io/meta-edit/)にある。

## 発想

`CLAUDE.md`、Skill、システムプロンプト、コメントに貼り付けたレビュー用チェックリスト――AIエージェントに指示を渡せる場所は、どれも「モデルが再読するかもしれないテキスト」だ。会話が進むにつれて注意から外れ、実際に `Edit` が呼ばれる頃には、その指示はほぼ期限切れになっている。

唯一、振る舞いの違う場所がある。エージェントがいま呼ぼうとしているツールの**スキーマと説明文**は、呼び出しのたびに必ずロードされる。行動の瞬間に指示がモデルの目の前にあることが保証されている、ただ一つの場所だ。

`meta-edit` は義務をそこに置く。ただし汎用の `Edit` ひとつでは粗すぎる――「`<` を `<=` に変えるときは境界テストを書く」という義務を載せても、タイポ修正にまで誤って適用されてしまう。だから分ける。`Edit` を「変更の種類」ごとに17個に分解する。エージェントは編集に入る前に種類を選ばなければならない。**種類を選ぶこと自体が、思考のステップになる。**

発想の源は[SQLiteのテスト戦略](https://sqlite.org/testing.html)――境界値、MC/DC条件カバレッジ、異常系テスト、変更ごとのチェックリスト――を、Cライブラリの品質規律からアプリケーションレベルの編集カテゴリへ翻訳したものだ。

## 17個のツール

```
edit_cosmetic                 edit_boundary_condition
edit_boolean_condition        edit_state_transition
edit_db_schema                edit_data_migration
edit_api_contract             edit_serialization
edit_error_handling           edit_retry_timeout
edit_concurrency              edit_external_side_effect
edit_cache_invalidation       edit_permission_logic
edit_dependency_config        edit_policy_change
edit_docs_only
```

各ツールの説明には、いつ使うか、いつ使ってはいけないか、どんなテストを伴うべきか、いつ立ち止まってユーザーに尋ねるか――この四点が書かれている。`edit_docs_only` を除く16個の実装ツールには `target: "prod" | "test"` が必須で、実装変更とそのテスト編集はそれぞれ独立した宣言として記録され、同じコミットに並ぶ。

> **v0.5.0**: 以前の `edit_test_only_change` と `edit_refactor_only` は廃止された。テスト編集は、そのテストが対応する実装種類のツールを `target: "test"` で再度呼び出すことで行う。`edit_cosmetic` は旧 `edit_refactor_only` を空白・コメント・フォーマッタ出力のみに狭めたもので、リネームや関数抽出やデッドコード削除などは「停止して尋ねる」経路に流れる――汎用リファクタの逃げ場は意図的に置かない。

## 観察された挙動

依頼された変更にどの種類もきれいに当てはまらないとき、エージェントは近い型に無理やり押し込まずに、**立ち止まって尋ねる**。これがコンテキスト使用率およそ80%――`CLAUDE.md` の指示が通常効かなくなる領域――でも起こることを確認している。18番目のツール `edit_docs_only` の元になった全文ログは、[プロジェクトページ](https://hiniachi.github.io/meta-edit/#proof)に掲載してある。

## インストール

### Claude Codeプラグインマーケットプレース

このリポジトリ自身が、単一プラグインのマーケットプレースとして機能する。

```sh
/plugin marketplace add hiniachi/meta-edit
/plugin install meta-edit@meta-edit
```

これだけで、MCPサーバ(17個の `edit_*` ツール)と2つの安全フック(`deny-raw-edit`、`deny-bash-write-bypass`)が自動で登録される。プラグインは `dist/` 配下のビルド済みJavaScriptを `node` で実行するので、**ランタイム要件はNode 20+のみ**――Bunも `npm install` もビルドステップも要らない。

新しいリリースが出た後にローカルのマーケットプレースクローンを追随させるには:

```sh
git -C ~/.claude/plugins/marketplaces/meta-edit pull origin main
rm -rf ~/.claude/plugins/cache/meta-edit
/plugin install meta-edit@meta-edit
/reload-plugins
```

### npm

```sh
npm install -g @hiniachi/meta-edit
meta-edit install-hooks --scope user
```

MCP設定にサーバを追加する:

```json
{
  "mcpServers": {
    "meta-edit": { "command": "meta-edit", "args": ["serve"] }
  }
}
```

### opencode

```sh
npm install -g @hiniachi/meta-edit
meta-edit install-opencode --scope user
```

`opencode.json` にMCPサーバと `@hiniachi/meta-edit/opencode` プラグインを書き込む。参考: [`examples/.opencode/opencode.json`](./examples/.opencode/opencode.json)。Claude Code経路と同じ17個のツール記述、同じ監査ログ、同じgrantフローが共有される。

## リファレンス

| | |
| --- | --- |
| 仕様全文(17個の記述、宣言＋トークン束縛、プロトコル) | [`docs/SPEC.md`](./docs/SPEC.md) |
| 編集ログのスキーマ(`issued` / `consumed` / `rejected`) | [`docs/SPEC.md` §6](./docs/SPEC.md) |
| 観察された失敗モード(v0.2以降のバックログ) | [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md) |
| CIサンプル(PRで `meta-edit summary` を走らせる) | [`examples/.github/workflows/meta-edit-summary.yml`](./examples/.github/workflows/meta-edit-summary.yml) |
| CLIヘルプ | `meta-edit --help` |

ステータス: `0.3.1` プレリリース版。Node 20 LTS以降、POSIXシェル。Bunは開発用途のみ。

## 支援

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

## ライセンス

MIT。[`LICENSE`](./LICENSE) を参照。

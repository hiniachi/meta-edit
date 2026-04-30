# meta-edit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/hiniachi/meta-edit/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/hiniachi/meta-edit?style=social)](https://github.com/hiniachi/meta-edit/stargazers)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/hiniachi)

**言語:** [English](./README.md) · **日本語** · [简体中文](./README.zh-CN.md)

> AI コーディングエージェントの汎用ファイル編集ツールを、**18 個の編集種別ごとのツール**に置き換える MCP サーバ。各ツールの説明文に、その種別の編集に必要なテスト義務を直接埋め込みます。

仕様の全文は [`docs/SPEC.md`](./docs/SPEC.md)。検出・検証ではなくツール設計のみで AI の編集挙動を変える、という賭けに基づく実装です。

## 状態

`0.1.0` プレリリース。コア構成は揃っています — 18 個の `edit_*` MCP
ツール、2 つの PreToolUse 安全フック、`.meta-edit/state/edits.jsonl`
への追記専用ログ、CLI。仕様は [`docs/SPEC.md`](./docs/SPEC.md)、
v0.2 候補は [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md) を参照。

このリポジトリ自体が単一プラグインの Claude Code マーケットプレイス
として動作し、npm パッケージ `@hiniachi/meta-edit` でも配布できます
（npm 公開はまだ）。

## 18 個のツール

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

各ツールの説明文は以下を明示します。

- いつ使うか
- いつ使ってはいけないか
- どのテストが伴わなければならないか
- どのタイミングで「いったん止めてユーザに尋ねる」か

## インストール

### A. Claude Code Plugin marketplace

このリポジトリ自体が単一プラグインのマーケットプレイスです。一度マーケットを追加すれば、`/plugin install` で導入できます。

```sh
/plugin marketplace add hiniachi/meta-edit
/plugin install meta-edit@meta-edit
```

これだけで MCP サーバ（18 個の `edit_*` ツール）と、安全フック（`deny-raw-edit` と `deny-bash-write-bypass`）の両方が自動で有効になります。実行に [Bun](https://bun.sh) が必要です（TypeScript ソースを直接動かすためビルドは不要）。

### B. npm パッケージ

```sh
npm install -g @hiniachi/meta-edit
# 安全フックを有効化
meta-edit install-hooks --scope user
```

プロジェクト単位で入れる場合:

```sh
npm install --save-dev @hiniachi/meta-edit
meta-edit install-hooks --scope project
```

Claude Code の MCP 設定に追加:

```json
{
  "mcpServers": {
    "meta-edit": { "command": "meta-edit", "args": ["serve"] }
  }
}
```

## ランタイム

ソースは TypeScript のまま npm に publish され、以下で動作します。

- Bun 1.x（開発・CI で使用、推奨）
- Node 20 LTS（`node` は `dist/` のビルド出力を実行、`bun` はソースを直接実行）

## コマンド

```
meta-edit serve              MCP の stdio サーバを起動
meta-edit log [filters]      edits.jsonl のエントリを表示
meta-edit summary            編集ログの集計
meta-edit install-hooks      settings.json に Claude Code フックを追加
meta-edit uninstall-hooks    settings.json からフックを削除
```

## サポート

`meta-edit` が時間の節約や危険な編集の回避につながった場合、コーヒー一杯のご支援をご検討ください。

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black&style=for-the-badge)](https://buymeacoffee.com/hiniachi)

ご支援は以下に充てられます。

- 観測された AI の失敗パターンに基づく新しい `edit_*` カテゴリの追加
- v0.2 で予定されている軽量 diff 分類器の実装（[`SPEC.md` §11](./docs/SPEC.md) 参照）
- Claude Code Plugin との統合強化

## ライセンス

MIT。[`LICENSE`](./LICENSE) を参照。

# Open questions — 詳細分析

Status: **DRAFT**. RFC §6 の残 4 件を深掘り。`rfc.md` 本体を膨らませず
ここに分離。

| # | 論点 | 推し | 確度 |
|---|---|---|---|
| 1 | `additional_files` 受理 kind | `edit_explanation` + `edit_decision` のみ | 高 |
| 2 | `edit_cosmetic` 境界例の追加 | 主要 7 例をテーブル拡張、残りは stop-and-ask 原則 | 中 |
| 4 | `edit_cosmetic` の provenance マトリクス | `user_confirmed` / `accepted_artifact` / `direct_observation` のみ accept、`inference` / `speculation` は reject | 高 |
| 5 | legacy `edit_docs_only` マイグレーション | v0.6.0 で即時 reject、log/summary CLI は legacy bucket として読み込み | 高 |

---

## Q1. `additional_files` 受理 kind

### 問い

`additional_files`（1 declaration が複数ファイル binding を一括して
受け取る workflow 機能、cap = 32）を、新 5 kind のうち **どれに付与
するか**。RFC §3.1 の暫定は `edit_explanation` + `edit_decision`。

### 各 kind の batch 必要性

| kind | 典型シーン | batch が要るか |
|---|---|---|
| `edit_progress` | `IMPLEMENTATION-LOG.md` 1 ファイル追記 | **不要**。1 セッション 1 ログ entry が原則 |
| `edit_observation` | `OBSERVED-FAILURES.md` 追記 ± 関連コード行コメント | **不要**。観察と該当コードへの `// XXX` は別 declaration で良い（混ぜると audit が読みにくい） |
| `edit_proposal` | `issues/2026-...md` 新規 1 ファイル中心 | **不要**。RFC ドラフトで `research.md` + `rfc.md` を同時に書いても 2 declaration で十分 |
| `edit_decision` | CHANGELOG + `package.json` + `.claude-plugin/plugin.json` を release で同時更新 | **要**（リリース commit のための定型 batch） |
| `edit_explanation` | 多言語 README 3 言語同期、docs/ 配下の関連ページ複数 | **要**（既存 `edit_docs_only` の主要動機） |

### 検討した代替案

**(a) 5 kind 全てに付与** — 「念のため」。abuse の温床になる
（audit が読みにくい混在 batch）。却下。

**(b) `edit_explanation` + `edit_decision` のみ**（推し）— 既存
`edit_docs_only` の batch 必要性を 2 つの軸（公開面同期 / リリース
batch）に分解し、それぞれに正当性が明確。残り 3 kind は 1 declaration
1 ファイル原則で運用。

**(c) `edit_explanation` のみ**（厳しめ） — `edit_decision` のリリース
batch（CHANGELOG + plugin.json + package.json）を別 declaration ×3 に
分割。friction はあるが audit は綺麗。`edit_decision` の使用頻度は
低いので 3 declaration が大きな negative ではないという見方。

### 副次論点

- **cardinality cap**: 既存の 32 を踏襲。`edit_explanation` の多言語
  README 同期は 3-5、`edit_decision` のリリース batch も同程度。32
  は十分余裕。
- **declaration ↔ file 一致の audit**: `additional_files` を持つ
  kind では、edit log entry が複数 binding を 1 行で持つ。これは
  既存 `edit_docs_only` と同じ形なので summary CLI 側の対応不要。
- **`accepted_artifact` provenance との相互作用**: 多言語 README
  同期で `accepted_artifact: SPEC.md §4` を引用する場合、batch
  全件が同じ artifact 由来でなければならない（一括 declaration の
  semantics 上自然）。description で明示する。

### 推し（再掲）

**(b) `edit_explanation` + `edit_decision` のみ**。確度高。

---

## Q2. `edit_cosmetic` 境界例の追加

### 問い

RFC §3.5 のテーブルは 7 例。実運用で迷う追加ケースをどこまで明文化
するか。

### 既存テーブル（再掲）

| 例 | 帰属 |
|---|---|
| `/** function does X */` 追加 | `edit_explanation` |
| `// XXX breaks for N>1000` 追加 | `edit_observation` |
| `// TODO: refactor` 追加 | `edit_proposal` |
| typo 修正（情報不変） | cosmetic |
| コメントブロックのインデント | cosmetic |
| docstring の API 例追記 | `edit_explanation` |
| stale コメント削除 | `edit_observation` or stop-and-ask |

### 追加候補（実運用で迷うケース）

| 例 | 帰属 | 理由 |
|---|---|---|
| 既存コメントの言い回し改善（情報不変）<br>`// this checks input` → `// this validates user-supplied bytes` | cosmetic | 情報内容が変わらず、語彙のみ改善 |
| 既存コメントへの情報追加<br>`// fix bug` → `// fix off-by-one in pagination` | `edit_explanation` | 情報追加（読者向けに「何の bug」を明示） |
| 動かないコードの一時コメントアウト | `edit_proposal` | 「戻すか消すか」の open question |
| 使わなくなったコードのコメント削除 | cosmetic | 純粋に dead code 除去（情報不変） |
| license header 追加 | `edit_decision` | プロジェクト方針の記録（policy 系は別軸） |
| TODO/FIXME/XXX/HACK の使い分け | TODO→`proposal`, FIXME→`proposal`/`observation`, XXX→`observation`, HACK→`observation` | intent で AI が選ぶ |
| ブロックコメントの中身追加（既存 docstring に例を追記） | `edit_explanation` | 情報追加 |
| `/* */` ↔ `//` のコメント形式変換 | cosmetic | 情報不変、形式のみ |
| import 並び替え（formatter 出力） | cosmetic | formatter 出力に該当 |
| import 並び替え（手動意図） | **stop-and-ask** | API order に意味がある言語/コンテキストあり |
| Markdown 見出しレベル変更（情報構造変化） | `edit_explanation` | 読者向け hierarchy 変更 |
| Markdown リンク URL 修正（typo） | cosmetic | 情報不変 |
| Markdown リンク URL 修正（リソース移動） | `edit_explanation` | 同じリソースだが行き先変更（読者影響あり） |
| コメントの言語翻訳（英→日 等） | **stop-and-ask** | 読者層変更 = 情報の届く先変更、cosmetic で済まない |

### 検討した代替案

**(a) 上記すべてを RFC §3.5 のテーブルに追加** — テーブルが長くなる
が examples-driven で迷いが減る。RFC が膨らむ。

**(b) 主要 7 例維持、原則は description の「stop-and-ask」に任せる**
— 簡潔。AI が境界を判断する責任が大きい。

**(c) 主要 + 「迷うケース」 7-8 例を追加で計 14-15 例**（推し）—
ある程度の coverage と簡潔さの折衷。

### 副次論点

- **license header / shebang / encoding declaration** は cosmetic
  軸ではなく **policy / dependency_config** 軸。RFC §3.5 とは別箇所で
  明示する必要あり（多分 `edit_dependency_config` description で）。
- **"stop-and-ask" の閾値**: AI がどの程度迷ったら立ち止まるかは
  description のチューニング次第。observation 不足。実装後の運用で
  refine する想定。
- **言語別の慣例**: Python の docstring 規約、Rust の `///`
  doc-comment 規約など、cosmetic vs explanation の境界に言語固有
  の慣例がある。本 RFC では言語非依存に説明し、観察結果で v0.7 で
  refine する余地を残す。

### 推し（再掲）

**(c) 計 14-15 例**。確度中（最終決定は実装時に AI 観察で調整）。

---

## Q4. `edit_cosmetic` の provenance マトリクス

### 問い

cosmetic は impl 16 本の一員（`TOOLS_REQUIRING_TARGET` に含まれる）
だが、semantic effect ゼロ前提なので epistemic 出所を問う意味が
他の impl tools と違う。provenance 5 値のうち、どれを accept する
か。

### 選択肢

**(a) impl 16 本のルール完全合流**：全 5 値 OK、`inference` /
`speculation` で prose hedging 推奨。

- 利点：uniformity
- 欠点：cosmetic は変更が semantic に effect ゼロなので
  「`inference` で whitespace 編集」が意味不明。AI が誤申告する
  ノイズが増える

**(b) cosmetic 用に絞る**（推し）：accept = `user_confirmed`,
`accepted_artifact`, `direct_observation`。reject = `inference`,
`speculation`。

- `user_confirmed`: ユーザー指定（formatter を走らせよ、空行を入れよ）
- `accepted_artifact`: project style guide、`.editorconfig`、formatter
  設定に従う
- `direct_observation`: formatter を走らせた結果（実行結果を観察）
- `inference`: 「こういう whitespace の方が綺麗な気がする」→ 選好で
  ある以上、`user_confirmed` か `accepted_artifact` のはず。reject
  して再考を促す
- `speculation`: 「このコメント形式の方が読みやすいかも」→ 同上、
  reject

**(c) provenance を cosmetic に課さない**：cosmetic 例外として
optional。

- 利点：規則簡素
- 欠点：規則の例外で muddies the design。21 ツール uniformity が
  崩れる

### 検討した副次論点

- **(b) の reject トリガーとしての価値**: cosmetic で
  `speculation` / `inference` を選ぼうとした AI は、「これ本当に
  cosmetic か？情報変えてないか？」と再考できる。これは bet 哲学
  と整合的（description で行動を変える surface）。
- **formatter の typical declaration**: `accepted_artifact:
  .prettierrc` のように configuration ファイルを引用するのが自然。
  rationale には「ran `bun run format`」と書く。
- **既存 `target: prod | test` との直交性**: cosmetic の `target`
  field（既存）は変えない。test fixture の整形なら `target: test`、
  本体コードの整形なら `target: prod`。provenance はそれと独立。

### 推し（再掲）

**(b) `user_confirmed` / `accepted_artifact` / `direct_observation`
のみ accept**。確度高。

`inference` / `speculation` を reject すること自体が
「semantic effect 0 のはずの cosmetic で epistemic uncertainty が
出てきたら、kind 選択が間違っている」というシグナルになる。

---

## Q5. legacy `edit_docs_only` マイグレーション

### 問い

v0.6.0 リリース後、既存クライアントが `edit_docs_only` を呼んで
きた場合の挙動。

### 選択肢

**(a) 即時 reject**（推し）：v0.6.0 以降 `edit_docs_only` は
unknown tool として reject。CHANGELOG / release notes に明記。

**(b) 移行期間でエイリアス**：v0.6.x の間は `edit_progress` に
エイリアスして warn を出す。v0.7 で削除。

**(c) deprecation warning のみ**：呼び出しは通すが warn を出す。
v0.7 で削除。

### 実態分析

- **クライアント側の挙動**: Claude Code 等は MCP サーバ接続時に
  ListTools を取得する。古い tool 一覧をキャッシュしないので、
  サーバ更新と同時に新 21 ツールが見える。クライアントは
  `edit_docs_only` を呼ばない（不在のため）
- **古いセッション**: v0.5.x で起動したセッションが v0.6.0 サーバに
  接続したとき、セッション内のキャッシュで `edit_docs_only` 呼び出し
  が発生する可能性。ただし通常は新 ListTools の取得でリフレッシュ
  される
- **テスト fixture**: 既存 jsonl テストデータに `edit_docs_only`
  entry が混入している。これは **読み出し側で legacy bucket として
  処理** すれば書き込み path に影響しない

### 読み出し側の互換性（書き込みとは別）

| 場面 | 対応 |
|---|---|
| `meta-edit log` で過去 entry を表示 | `edit_docs_only` を そのまま表示（kind 列が legacy 値） |
| `meta-edit summary` で集計 | `edit_docs_only` を "legacy" bucket として別行 |
| edit log のスキーマ validation | `kind` は string で受理（enum 制約は新 entry の write path のみ）|

これは v0.5.0 の `edit_policy_change` の legacy bucket pattern を
踏襲。

### 検討した副次論点

- **テスト書き換えコスト**: 既存 `edit_docs_only` を参照するテスト
  は新 kind 名に置換が要る（research.md §3.7 に列挙、9 ファイル）。
  これは Phase A で吸収。
- **dist/ のリビルド**: `descriptions.ts` の変更で `dist/cli.js` が
  changing。コミットに含める。
- **plugin marketplace の事前周知**: `.claude-plugin/marketplace.json`
  の `description` を 17 → 21 ツールに更新する PR は事前に出す
  価値あり（クライアント側が新 tool list を取得しやすくする）。
- **Major bump 該当性**: tool surface の追加 + 既存 surface 廃止は
  semver では major 相当。ただし v0.x は major bump せず minor で
  実用上問題なし（既存運用方針）。

### 推し（再掲）

**(a) 即時 reject、読み出し側は legacy bucket**。確度高。

---

## 全体まとめ

4 問すべて推し確度 高/中。これで残る不確定要素は実装時の運用観察
（Q2 の例追加のチューニング）のみ。

承認されれば RFC §6 を更新し、本文書を「決定事項」として参照する
形にできる。

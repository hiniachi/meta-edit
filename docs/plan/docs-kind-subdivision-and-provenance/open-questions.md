# Open questions — 詳細分析

Status: **DRAFT**. RFC §6 の残 4 件を深掘り。`rfc.md` 本体を膨らませず
ここに分離。

| # | 論点 | 推し | 確度 | 状態 |
|---|---|---|---|---|
| 1 | `additional_files` 受理 kind | `edit_explanation` + `edit_decision` + `edit_proposal` | 中 | 議論中 |
| 2 | `edit_cosmetic` 境界例の追加 | （他ツール波及の設計変更検討のため一旦保留） | — | **PAUSED** |
| 4 | `edit_cosmetic` の provenance マトリクス | `user_confirmed` / `accepted_artifact` / `direct_observation` のみ accept、`inference` / `speculation` は reject | 高 | **決定** |
| 5 | legacy `edit_docs_only` マイグレーション | v0.6.0 で即時 reject、log/summary CLI は legacy bucket として読み込み | 高 | **決定** |

---

## Q1. `additional_files` 受理 kind

### 問い

`additional_files`（1 declaration が複数ファイル binding を一括して
受け取る workflow 機能、cap = 32）を、新 5 kind のうち **どれに付与
するか**。

ユーザー指摘：**issue を大量に書くシナリオの friction が高そう** →
`edit_proposal` も batch 受理すべきでは。

### 設計判断マトリクス：kind × provenance で batch 需要を評価

セル = その (kind, provenance) 組み合わせで **batch シナリオが定型
的に発生するか**。

凡例：
- **○** = batch が定型的・反復的に発生（friction 大、受理の正当性
  あり）
- **△** = batch があれば便利だが頻度低、または theme が弱い
- **—** = batch シナリオが構造的に無い、または kind×prov 自体が
  reject される組み合わせ（§3.3 マトリクス参照）

| kind \ prov | user_confirmed | accepted_artifact | direct_observation | inference | speculation |
|---|:---:|:---:|:---:|:---:|:---:|
| `edit_progress` | — | — | — | — | — |
| `edit_observation` | — | △ | △<br>(audit findings) | △<br>(§3.3 warn) | △ |
| `edit_proposal` | △<br>(user 指示 triage) | **○**<br>(audit から起票 batch) | △ | △ | **○**<br>(feature kickoff issue burst) |
| `edit_decision` | **○**<br>(release commit) | **○**<br>(spec ベース多面展開) | △ | —<br>(§3.3 reject) | —<br>(§3.3 reject) |
| `edit_explanation` | **○**<br>(user 指示で多言語同期) | **○**<br>(spec ベース docs sweep) | **○**<br>(実装と doc 同期 batch) | △<br>(§3.3 warn) | —<br>(§3.3 reject) |

### マトリクスからの受理判断

**ルール**：kind 行に ○ が 1 つ以上あれば accept、△ のみまたは — のみなら reject。

| kind | ○ の数 | 受理 | 確度 | 主たる ○ シナリオ |
|---|:---:|:---:|:---:|---|
| `edit_progress` | 0 | **reject** | 高 | — |
| `edit_observation` | 0 | **reject** | 中 | （v0.7 で再評価、audit findings 集約の friction を観察） |
| `edit_proposal` | 2 | **accept** | 中 | accepted_artifact 列：audit から起点が明確な issue 一括起票<br>speculation 列：feature kickoff の探索的 issue burst |
| `edit_decision` | 2 | **accept** | 高 | user_confirmed 列：release commit batch<br>accepted_artifact 列：spec で決まった事項を複数 file に転記 |
| `edit_explanation` | 3 | **accept** | 高 | accepted_artifact 列：spec ベースで docs sweep（既存 `edit_docs_only` の主要動機）<br>user_confirmed 列：多言語 README 同期<br>direct_observation 列：実装と doc の同期 batch |

### `edit_proposal` の確度が中である理由

○ が 2 つあるが、それぞれ theme の強さが違う：

- **accepted_artifact + batch**（audit 起票）：audit document
  自体が theme として強固。rationale で `audit: docs/audit/2026-...md`
  を引用すれば各 issue が同じ origin から派生していることが明確。
  abuse しにくい。
- **speculation + batch**（feature kickoff）：theme は「feature X
  立ち上げ」と AI 申告に依存。「同じ feature の探索」は明確に
  読めるが、AI が無関係な思いつきを bundle するリスクは構造的に
  ある。

→ description で **theme obligation** を明示する必要あり（後述）。
そのため確度は中。

### 副次論点

- **cardinality cap**: 既存 32 を踏襲。最大 use case の `edit_proposal`
  issue burst も 10-20 件で収まる想定、32 は余裕。
- **theme obligation の文言**（`edit_proposal` description 末尾候補）：
  > 「`additional_files` を使う場合、bound files all relate to a
  > single originating theme. Acceptable themes: a referenced audit
  > document, a feature kickoff name, a triage session date.
  > `rationale` MUST name the theme explicitly. Filing unrelated
  > proposals in one batch breaks the per-proposal audit trail;
  > submit each as its own declaration instead.」
- **`edit_observation` 列の △ をどう扱うか**:
  - 現状 reject だが、audit findings 集約（"`OBSERVED-FAILURES.md`
    に 5件 一括追記" 等）はあり得る
  - 実装後 6ヶ月程度の運用で friction が観察されたら v0.7 で accept
    化
  - 現時点で accept すると `edit_proposal` と同じく theme obligation
    が要り、追加判断が増える。先送りが妥当
- **provenance × additional_files の整合検査**:
  - batch declaration では全 binding が **同じ provenance** であること
    が semantics 上自然
  - 例：`accepted_artifact` で audit 由来 batch なら 5 件全部が同
    audit 由来であるべき
  - サーバ側で強制せずとも、宣言が単一 provenance フィールドなので
    自動的にそうなる（kind 同様、provenance も 1 declaration 1 値）

### 検討した代替案（マトリクス由来）

| 案 | accept する kind | コメント |
|---|---|---|
| (a) 全 5 kind | progress, observation, proposal, decision, explanation | progress に ○ が無く正当化弱い、abuse 温床 |
| (b) ○ が 2 以上の kind のみ | proposal, decision, explanation | **推し**。マトリクスのルールと一致 |
| (c) ○ が 3 の kind のみ | explanation のみ | decision の release batch friction を取りこぼす |
| (d) (b) + observation | proposal, decision, explanation, observation | △ を ○ に格上げ。先取り過ぎ、v0.7 余地として残す方が安全 |

### 推し（再掲）

**(b) `edit_explanation` + `edit_decision` + `edit_proposal`**。
マトリクスの ○ 数ルールと一致。

確度：
- explanation, decision = **高**（複数の ○ が異なる provenance で
  分散しており、batch 需要が一方向に偏らない）
- proposal = **中**（speculation 列の theme obligation が運用観察で
  要 verification）

---

## Q2. `edit_cosmetic` 境界例の追加 — **PAUSED**

> ユーザーから「他のツールにも関わる設計変更を思いついた」との保留指示。
> 当該設計変更が確定するまで本問は議論せず、現状の RFC §3.5 主要 7 例
> のみを暫定として残す。再開時に下記の追加候補マトリクスを基点に
> 再評価する。

（以下は paused 前の分析、参考として残置）

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

## Q4. `edit_cosmetic` の provenance マトリクス — **決定**

決定：**(b) `user_confirmed` / `accepted_artifact` / `direct_observation`
のみ accept、`inference` / `speculation` は reject**（ユーザー
確認済み）。

`inference` / `speculation` を reject すること自体が「semantic
effect 0 のはずの cosmetic で epistemic uncertainty が出てきたら、
kind 選択が間違っている」というシグナルになる。

（以下は決定前の分析、参考として残置）

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

## Q5. legacy `edit_docs_only` マイグレーション — **決定**

決定：**(a) 即時 reject（書き込み path）+ legacy bucket（log/summary
CLI の読み出し path）**（ユーザー確認済み）。

（以下は決定前の分析、参考として残置）

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

## 全体まとめ（更新後）

| # | 状態 | 残作業 |
|---|---|---|
| Q1 | 議論中（matrix-driven 再評価） | `edit_proposal` 受理の最終承認、theme obligation 文言確定 |
| Q2 | **PAUSED** | 他ツール波及の設計変更が確定するのを待つ |
| Q4 | **決定** | RFC §6 反映 |
| Q5 | **決定** | RFC §6 反映 |

Q4 / Q5 が決定済み、Q1 が user 確認待ち、Q2 が一時保留。承認後の
RFC §6 更新は Q1 確定を待ってから一括で行う。

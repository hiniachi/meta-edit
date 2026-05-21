# RFC — workflow-axis kinds + epistemic provenance

Status: **DRAFT** — ユーザー承認待ち。本 RFC は仕様提案。実装は走らせない。
影響範囲は同フォルダの `research.md`。

| Field | Value |
|---|---|
| Author | meta-edit session |
| Created | 2026-05-21 |
| Target | v0.6.0 (minor bump) |
| Touches | SPEC Article 4 / SPEC §3 / SPEC §4 / SPEC §6 / CLAUDE.md §1, §3, §12 |
| Constitutional | Yes (Article 7 amendment bar — §4 で論証) |
| Tool count | 17 → 21（15 SQLite + 1 cosmetic + 5 workflow） |
| Supersedes | `edit_docs_only`（廃止） |

---

## 1. Problem statement

過去チャットで作成した成果物（`IMPLEMENTATION-LOG.md`,
`OBSERVED-FAILURES.md`, `issues/**`, `docs/plan/**`, コード内コメント
等）が、新チャットからは「ただ存在するファイル = 決定稿」と見えて
しまう。実際には：

- **user_confirmed** — ユーザーが明示確認した
- **accepted_artifact** — accepted ADR / spec / test / API に基づく
- **direct_observation** — 実行結果・読んだコード・ログ等から直接観察
- **inference** — 観察からの推論
- **speculation** — 仮説・未検証

の 5 段階の epistemic 出所が混在しているのに、ファイルにも edit log
にも残らない。

加えて：

1. `edit_docs_only` が doc 全般を 1 ツールでカバーするため、kind
   ごとの description チューニングが効きにくい。"観察記録" と
   "決定記録" と "提案" は別の規律で書くべきだが、現状は同じ
   description 1 本に押し込まれている。
2. impl 16 本も同じ epistemic 問題を持つ：仮置きの修正、推論で
   書いた処理、これらが log に「ただの implementation 変更」として
   残り、新セッションでは確定済みに見える。

---

## 2. Non-goals

- パッチ内容の検査（Article 7 違反）
- `provenance` の真偽検証（自己申告のみ）
- **パス matcher による kind 自動推定**（汎用化を壊す。各プロジェクトで
  ファイル配置が違う以上、サーバ側で「`README.md` だから何 kind」を
  判定しない）
- `accepted_artifact` の引用先 artifact 内容との整合検証
- 既存 jsonl への provenance backfill（旧データは null のまま受理）
- `edit_policy_change` への provenance 適用（governance 軸は別検討）
- 新セッション boot 時の log overlay / SessionStart 注入（prose
  embedded uncertainty 方式採用により不要）
- 構造的ファイル内マーカー（HTML コメント等の機械可読マーク）。
  prose 自体に uncertainty を埋め込む方式（§3.4）に切り替え

---

## 3. Proposal

### 3.1 Workflow-axis kinds（`edit_docs_only` を廃止して 5 新設）

**axis**: パス（"どのファイルか"）ではなく、**そのセッションで何を
している瞬間に書いているか**（intent）で切る。同じ `README.md` が
intent によって違う tool を通る。

| 新 kind | intent | 典型シーン |
|---|---|---|
| `edit_progress` | このセッションでやったことの記録 | "X を実装した、Y を試した、Z は動いた" |
| `edit_observation` | 観察・気付き・発見の記録 | "A が成立すると B が壊れることに気付いた" |
| `edit_proposal` | 提案・問題提起・open question | "C を導入すべきでは？" |
| `edit_decision` | 確定した決定の記録 | "D 方式を採用すると決めた" |
| `edit_explanation` | 読者向けに既知事実を解説 | "この関数は E のために存在する" |

5 個すべて：

- `target` フィールドは持たない（doc/workflow に prod/test 軸は
  無関係）
- `test_files` は空 OK（required ではない）
- `additional_files` の受理は **(kind, provenance) セル単位** で
  accept / warn / reject を決定（§3.3.2）。kind 単位 binary では
  なく、マトリクスがそのまま validation ルール

### 3.2 `provenance` 必須フィールド（全 21 ツール対象）

```ts
provenance:
  | "user_confirmed"      // ユーザーが明示した
  | "accepted_artifact"   // accepted ADR / spec / test / API 等に基づく
  | "direct_observation"  // 実行結果・読んだコード・ログ等から直接観察
  | "inference"           // 観察からの推論
  | "speculation"         // 仮説・未検証
```

- **必須・default なし**（`target` と同じ運用）
- 5 新 workflow kind + 1 cosmetic + 15 SQLite impl の **全 21 ツール
  共通**
- `provenance: "accepted_artifact"` のとき、`rationale` に少なくとも
  1 件の artifact 参照（`§...`, `ADR-...`, `issues/...`, `RFC-...`,
  URL のいずれか）が含まれることを軽い構文 lint で要求。無ければ
  warn（reject はしない）

### 3.3 Kind × provenance マトリクス

本 RFC は (kind, provenance) を **2 軸の判定空間** として扱い、
3 つの直交ルールを乗せる：

- **§3.3.1** typed_edit declaration の validity（accept / warn / reject）
- **§3.3.2** `additional_files` の受理（cell 単位で accept / warn / reject）
- **§3.3.3** `edit_cosmetic` の独自ルール

#### 3.3.1 typed_edit declaration の (kind, provenance) validity

##### 5 workflow kind

| kind \ prov | user_confirmed | accepted_artifact | direct_observation | inference | speculation |
|---|---|---|---|---|---|
| `edit_progress` | OK | OK | OK ◎ | OK | OK |
| `edit_observation` | OK | OK | OK ◎ | warn ※1 | OK |
| `edit_proposal` | OK | OK | OK | OK | OK ◎ |
| `edit_decision` | OK ◎ | OK | OK | **reject** | **reject** |
| `edit_explanation` | OK | OK ◎ | OK | warn ※2 | **reject** |

◎ = 各 kind の典型 provenance（description で誘導）

- ※1 `observation + inference` は「観察と書きながら推論を混ぜている」
  → kind を `proposal` に分けるよう warn
- ※2 `explanation + inference` は公開面に推論が混ざる→典型的には
  `accepted_artifact` 由来であるべき。warn

##### 15 SQLite-derived impl tools

**reject 組み合わせは設けない**（reject を増やすと AI が誤申告で
通すリスクの方が高い）。全組み合わせ OK。`next_action` が provenance
に応じて branch し、`inference` / `speculation` の場合は prose 内に
「Likely...」「**Unverified**:」等の hedging を残すよう description
で語る（§3.4）。コード内コメントも prose 扱い：仮置きの実装変更で
コメントを残すなら、コメント本文に hedging を入れる。

##### `edit_cosmetic`（§3.3.3 別建て）

cosmetic は semantic effect ゼロ前提のため、`inference` / `speculation`
を許容しない。詳細は §3.3.3。

#### 3.3.2 `additional_files` 受理マトリクス（cell 単位）

`additional_files` が declaration に含まれるとき、本テーブルを引いて
セル単位で accept / warn / reject を決定。kind 単位の binary 受理は
**しない**。

| kind \ prov | user_confirmed | accepted_artifact | direct_observation | inference | speculation |
|---|:---:|:---:|:---:|:---:|:---:|
| `edit_progress` | reject | reject | reject | reject | reject |
| `edit_observation` | reject | warn | warn | warn | warn |
| `edit_proposal` | warn | **accept** | warn | warn | **accept** |
| `edit_decision` | **accept** | **accept** | warn | n/a ※ | n/a ※ |
| `edit_explanation` | **accept** | **accept** | **accept** | warn | n/a ※ |

※ `n/a` は §3.3.1 で kind×prov 自体が reject されるセル
（additional_files 判定まで到達しない）。

##### セル値の意味

- **accept** — そのまま land、warnings なし
- **warn** — land する。warnings に「(kind, prov) では batch は
  非典型。theme が薄い場合は別 declaration を検討」を追加。edit
  log は通常通り
- **reject** — declaration 全体を reject、`audit_error` に理由

##### theme obligation（description で課す）

- **warn セル**で `additional_files` を使うとき：rationale に theme
  を **MUST** 明記
- **accept セル**：SHOULD（audit 健全性のため）

##### 1 ファイル declaration の扱い

`additional_files` が指定されていない通常 declaration は本テーブルを
引かない。`target_file` のみの宣言は §3.3.1 のみで評価。

##### 採用根拠（Q1 確定）

kind 単位 binary（`TOOLS_ACCEPTING_ADDITIONAL_FILES` 配列）よりも
cell 単位の方が解像度が高く、`edit_proposal × user_confirmed` のような
微妙ケースを warn にして気付きを与える運用ができる。詳細分析は
`./open-questions.md` Q1 を参照。

#### 3.3.3 `edit_cosmetic` の provenance マトリクス

cosmetic は **whitespace + formatter + 情報不変コメント編集のみ**
（§3.5）で semantic effect がゼロ。よって epistemic uncertainty
（`inference` / `speculation`）を許容しない。

| kind \ prov | user_confirmed | accepted_artifact | direct_observation | inference | speculation |
|---|:---:|:---:|:---:|:---:|:---:|
| `edit_cosmetic` | OK | OK ◎ | OK ◎ | **reject** | **reject** |

- `user_confirmed`：ユーザー指定（"formatter を走らせよ"）
- `accepted_artifact`：style guide / `.editorconfig` / formatter 設定に従う（典型）
- `direct_observation`：formatter を実際に走らせた結果（典型）
- `inference` / `speculation`：cosmetic でこれを選ぶのは kind 選択が
  間違っているシグナル。reject して再考を促す（"これ本当に
  cosmetic か？情報変えてないか？"）

##### 採用根拠（Q4 確定）

`inference` / `speculation` の reject は uniformity を一部崩すが、
cosmetic の semantic-effect-zero 性質と整合的で、誤った kind 選択を
構造的に弾く。詳細は `./open-questions.md` Q4 を参照。

### 3.4 不確実性は prose に埋め込む（マーカー不採用）

#### 3.4.1 方針

構造的マーカー（HTML コメント等）でファイルを囲むのではなく、
**AI に不確実性を prose 自体で表現させる**。サーバはマーカーを
注入しない、パースしない、検証しない。`provenance` enum は edit
log の構造化フィールドとしてのみ存在し、ファイル本体には
プレーンな自然言語で不確実性が現れる。

採用理由：

- ファイル内で確定・未確定の段落が混じる（壁打ち：「各ファイル内で
  混じることもある」）。段落単位のマーカーは脆い
- マーカー substring 検出は曖昧（壁打ち：B-1 評）
- メタデータは「読まれない場所」、prose は「読まれる場所」。
  未来の読み手（AI / 人間）が読むのは prose。signal を読まれる場所に
  置くのが正しい
- 言語別 wrapping 不要、JSON エッジケース不要、presence 検証不要
- meta-edit の bet（description で行動を変える）と完全整合

#### 3.4.2 provenance ごとの prose obligation（description で語る）

| provenance | prose の書き方 |
|---|---|
| `user_confirmed` | 確定事項として書く。hedging（「likely」「probably」等）を入れない |
| `accepted_artifact` | artifact を prose 内で引用する（rationale だけでなく本文にも）。例：「`ADR-007` に従い、...」「`SPEC.md §4` の述べる通り...」 |
| `direct_observation` | 経験的記録として書く。「Running X produced Y」「I observed that...」のように観察元を可視化 |
| `inference` | 推論であることを文中で明示。「Based on observed X, it appears that...」「Likely...」「Probably...」「観察から推論すると...」 |
| `speculation` | **強い hedging を冒頭/見出しに**：「**未検証**: ...」「**Speculation**: ...」「Hypothesis: ...」「TODO: verify — ...」 |

これらは **全 21 ツールの description 共通フッター** に書く（次節
§5 の各 description で参照）。

#### 3.4.3 typed_edit レスポンスの `next_action` 分岐

`next_action` 文に provenance ごとの prose リマインダを branch
（既存 `next_action` の延長、新規スキーマ無し）：

> Your declared provenance is `speculation`. Make sure your prose
> itself flags the uncertainty (**Unverified**, "Hypothesis:",
> "It might be that..." 等)— the reader will see the prose, not the
> provenance field. Don't write speculative content as if confirmed.

`user_confirmed` / `accepted_artifact` は標準の next_action のまま
（追加リマインダ無し）。

#### 3.4.4 昇格パス（speculation → user_confirmed）

仮置きを確定昇格するときは：

1. 同じ箇所を `provenance: user_confirmed` で再宣言
2. 続く native Edit で prose の hedging を取り除く
   （「**Unverified**: X likely happens」→「X happens」）

特別な「マーカー除去」機構は存在しない。**prose 書き換えそのものが
昇格作業**。これは自然で、AI に余計な仕組みを覚えさせない。

#### 3.4.5 新セッションが認知する経路（簡素化）

新チャットが `IMPLEMENTATION-LOG.md` 等を読むとき：

- prose 自体が「**Unverified**: ...」「Likely...」等で uncertainty
  を表現している → AI が自然言語として「これは仮置きだ」と認識
- 構造マーカー / 注入機構なし、純粋に prose を読むだけで気付く
- CLAUDE.md §11 への明示的な指示すら最小化できる（prose が自明）

これが元問題（「過去チャット = 決定稿問題」）への解決策の本体。
ファイル本体が決定稿の体裁を持たなければ、新セッションは決定稿と
扱わない。

#### 3.4.6 edit log は不変

prose は session を跨いで書き換えられても、edit log の各 issued
エントリには provenance がそのまま残る：

```
$ meta-edit log --provenance speculation
edit_id=20260521-001  IMPLEMENTATION-LOG.md  edit_progress  speculation
edit_id=20260521-007  OBSERVED-FAILURES.md   edit_observation speculation
...
```

過去に speculation で land した編集が、後で user_confirmed に昇格
されても、log の方は両方の entry が並ぶ（issued は append-only、
昇格時に古い entry を消したり書き換えたりしない）。audit としては
これで十分。

### 3.5 `edit_cosmetic` の更なる narrow

現状の cosmetic スコープから **情報を変えるコメント編集を剥がす**：

| 例 | 旧 | 新 |
|---|---|---|
| `/** function does X */` 追加 | cosmetic | `edit_explanation` |
| `// XXX breaks for N>1000` 追加 | cosmetic | `edit_observation` |
| `// TODO: refactor` 追加 | cosmetic | `edit_proposal` |
| typo 修正（情報不変） | cosmetic | cosmetic |
| コメントブロックのインデント | cosmetic | cosmetic |
| docstring の API 例追記 | cosmetic | `edit_explanation` |
| stale コメント削除 | cosmetic | `edit_observation` または stop-and-ask |

新 description（要点）：

> Comment edits that change NO information content (typo fix,
> line-break reflow, whitespace inside comments). Comments that add
> or change information go through the workflow kind matching the
> intent (`edit_observation` / `edit_explanation` / `edit_proposal`).

### 3.6 新セッションが認知する経路（§3.4.5 と統合済み）

§3.4.5 参照。prose 自体が「**Unverified**: ...」「Likely...」
「Hypothesis: ...」等で uncertainty を表現するため、新チャットは
ファイルを読むだけで自然に識別する。CLAUDE.md §11 への明示追記は
必須ではなくなる（あれば補強になる程度）。

---

## 4. Constitutional analysis (Article 7 amendment bar)

### 4.1 これは detection ではない

| 要素 | Detection? | 既存類似機構 |
|---|---|---|
| 5 workflow kind 追加 | No（type 軸の解像度上昇） | 既存 17 kind の延長 |
| `provenance` 必須化 | No（宣言フィールド追加） | `target` / `rationale` / `test_files` |
| 無効組み合わせ reject | No（宣言間の組み合わせ規則） | `target="test"` + non-empty `test_files` reject と同型 |
| `accepted_artifact` citation lint | **境界**：文字列パターン照合のみ。artifact 実在 / 内容整合は検証しない。warn のみ | path-safety と同種の構文 lint |
| 構造的マーカー | **採用しない**（§3.4） | — |
| prose-embedded uncertainty | No（description guidance のみ、サーバは何もしない） | tool description 一般 |
| **パス matcher** | **持たない** | — |

diff 内容は読まない、宣言と実態の照合はしない、test 意味解析もしない。

### 4.2 bet の信号は強まる

bet の主張：「**well-designed tool surface > complex verification
surface**」（CLAUDE.md §13）。本 RFC は verification surface を
増やさず、tool surface の解像度を二軸（kind × provenance）で上げる。
description 17 → 21 本、各 description が rationale / target /
provenance の宣言規律を埋め込む。bet をより厳しく試す方向。

### 4.3 "seventeen tools" の見出し変更

17 → 21（15 SQLite + 1 cosmetic + 5 workflow）。SPEC Article 4 /
CLAUDE.md §1, §12 の書き換え必須。比率の哲学（impl が dominate）は
維持。

### 4.4 自己申告 honesty の構造的弱さ

provenance 5 値はすべて AI 自己申告。検出器は禁止なので description
で戦う：

- `user_confirmed` 虚偽：「ユーザーが言った気がする」→ description
  で「直前のユーザー発話の引用なしに選ぶな」
- `accepted_artifact` 虚偽：存在しない artifact 引用 → citation lint
  で形式存在のみ確認、内容整合は AI 任せ
- `direct_observation` 虚偽：観察してないことを観察と書く →
  description で「観察ログ / コマンド出力 / 読んだコード行を
  rationale に書け」obligation

meta-edit 全体の bet と整合的なリスクで、本 RFC が新規 raise する
ものではない。

### 4.5 パス matcher を持たない理由

- 各プロジェクトでファイル配置が違う（汎用性を壊す）
- 実装が重くなる（パターン定義、設定ファイル化、テスト）
- detection への踏み込みリスク（「`README.md` だから `edit_explanation`
  以外 reject」のような検証は宣言と実態の照合に近い）

`SPEC.md` 等の特殊ファイルも検証しない。AI が宣言する。

---

## 5. Tool descriptions ドラフト（要点）

実装フェーズで verbatim にしてから `descriptions.ts` に流し込む。

### 5.1 `edit_progress`

> このセッションで実行したこと・試したこと・観測した結果を時系列で
> 記録する。`IMPLEMENTATION-LOG.md` 等の自己観察ファイルへの追記が
> 典型。
>
> Use this tool when:
> - "X を実装した、Y を試した、Z は動いた" のような自己観察
> - "what worked / known issues / open questions" 構造の section
>
> MUST NOT:
> - 決定として書く（決定は `edit_decision`）
> - 観察事実を一般化して書く（一般化は `edit_observation`）
> - 他人のセッションの動作を断定的に評価する
>
> Required tests: NONE.
>
> Typical provenance: `direct_observation`
>
> Provenance combinations: 全 OK

### 5.2 `edit_observation`

> 観察・気付き・発見した事実を記録する。`OBSERVED-FAILURES.md`、
> code 内 `// XXX` ノート、gotcha 集積など。
>
> Use this tool when:
> - "A が成立すると B が壊れることに気付いた"
> - 失敗パターン、surprise、edge case の記録
> - 検出器の実装案は書かない（§7.3, Article 7）
>
> MUST NOT:
> - 修正案を併記する（修正は `edit_proposal` で別宣言）
> - 観察してないことを観察と書く
> - 推論を混ぜる（`inference` provenance は warn）
>
> Required tests: NONE.
>
> Typical provenance: `direct_observation`
>
> Provenance combinations: `inference` は warn（観察と推論を分けよ）

### 5.3 `edit_proposal`

> 提案・問題提起・open question を起こす。`issues/**`,
> `docs/plan/**/rfc.md`, code 内 `// TODO`, ADR ドラフトなど。
>
> Use this tool when:
> - "C を導入すべきでは？" のような提案
> - 仮想ユーザーの同意を捏造しない（user_confirmed は本当の同意のみ）
> - open questions を残す
>
> MUST NOT:
> - "I will implement" と書く（提案段階）
> - 仮想の user 同意を捏造
>
> Required tests: NONE.
>
> Typical provenance: `speculation`
>
> Provenance combinations: 全 OK

### 5.4 `edit_decision`

> 確定した決定を記録する。ADR、CHANGELOG（リリース済みの記録）、
> IMPLEMENTATION-LOG への確定事項追記など。
>
> Use this tool when:
> - 決定が固まった後で記録
> - リリース済み変更を CHANGELOG に転記
>
> MUST NOT:
> - 推論や仮説で「決定」と書く（reject）
> - ユーザー未確認の事項を `user_confirmed` で書く
>
> Required tests: NONE.
>
> Typical provenance: `user_confirmed`
>
> Provenance combinations: `inference` / `speculation` は **reject**

### 5.5 `edit_explanation`

> 既知事実を読者向けに解説する。README、docs/、JSDoc、API doc、
> code 内の「この関数は何のため」コメントなど。
>
> Use this tool when:
> - 出荷済み機能の説明
> - 既存仕様の章を読者向けに展開
> - 多言語 README の同期（`additional_files` 受理）
>
> MUST NOT:
> - 未出荷機能を書く
> - 単独情報源として API 仕様を書く（コードの真実と乖離する）
> - 推論や仮説を解説として書く（`speculation` は reject、`inference`
>   は warn）
>
> Required tests: NONE.
>
> Typical provenance: `accepted_artifact`（spec / API 由来）
>
> Provenance combinations: `speculation` は **reject**、`inference` は warn

### 5.6 impl 16 本への provenance guidance（共通追記）

各 impl tool の description 末尾に共通追記：

> Provenance (required):
> Declare the epistemic source of this edit:
> - `user_confirmed` — ユーザーがこの変更を明示した
> - `accepted_artifact` — accepted spec / ADR / test / API に基づく
>   （rationale に引用、可能なら prose 内にも引用）
> - `direct_observation` — 実行結果 / 読んだコード / log から直接観察
>   （prose は「I observed X」「Running Y produced Z」のように
>   観察元を可視化）
> - `inference` — 観察からの推論（prose に「Based on observed X,
>   it appears that...」「Likely...」等の推論フレーミングを必ず入れる）
> - `speculation` — 未検証の仮説（prose 冒頭に「**Unverified**:」
>   「**Hypothesis**:」等の強い hedging を必ず入れる）

reject 組み合わせなし、`inference` / `speculation` はマーカー強化。

---

## 6. Remaining open questions

詳細分析と判断根拠は `./open-questions.md`。

1. ~~`additional_files` の受理 kind~~ → **決定**（§3.3.2 のセル
   単位 accept/warn/reject マトリクス）
2. **`edit_cosmetic` の境界例** — **PAUSED**：他ツールに波及する
   設計変更を検討中のためペンディング。現状 §3.5 主要 7 例を暫定
3. ~~マーカー言語別表現~~ → **解決**（§3.4 マーカー自体を廃止、
   prose-embedded uncertainty に切り替え）
4. ~~`edit_cosmetic` での provenance マトリクス~~ → **決定**
   （§3.3.3：`user_confirmed` / `accepted_artifact` /
   `direct_observation` のみ accept、`inference` / `speculation` は
   reject）
5. ~~legacy `edit_docs_only` への自動マイグレーション~~ → **決定**
   （v0.6.0 で書き込み path は即時 reject、log/summary CLI は legacy
   bucket として読み出し）
6. ~~`edit_observation` での `// XXX` 系コメント追加 friction~~ → **解決**
   （マーカー廃止により friction 消失）
7. ~~マーカー presence 検証~~ → **解決**（マーカー廃止により検証不要）

残るのは Q2 のみ（他ツール波及の設計変更が決まり次第再開）。

---

## 7. Rollout plan（承認後）

1. **Phase A: SPEC + descriptions surface**（最大の PR）
   - `docs/SPEC.md` Article 4 / §3 / §4 / §6 の書き換え
   - `src/tools/descriptions.ts` から `edit_docs_only` を削除、新 5
     kind の description 追加、impl 16 本に provenance guidance 追記
   - `edit_cosmetic` description の narrow
   - すべての hint 文 / test 内 tool 名参照を新名に置換
   - 単位：`edit_policy_change` の大型 PR

2. **Phase B: provenance フィールド**
   - `EditToolRequestSchema` / `validateRequest` に追加
   - 5 値 enum、必須化
   - kind × provenance reject / warn 規則の実装
   - `accepted_artifact` citation lint
   - test：rejection / acceptance / warn

3. **Phase C: prose obligation の `next_action` 分岐**
   - typed_edit の `next_action` 文を provenance ごとに branch
     （§3.4.3）：`inference` / `speculation` のとき強い prose
     リマインダを末尾に付与
   - description フッターの prose obligation 表（§3.4.2）を全 21 本に
     反映（Phase A の続きでも可）
   - **コード変更はこれだけ**。マーカー注入 / presence 検証 / 言語
     マップ / SessionStart hook はすべて不採用
   - test：`next_action` が provenance ごとに正しく branch される
     こと（5 値 × 代表 tool 2-3 本のスナップショット）

4. **Phase D: 集計 + CLI**
   - `meta-edit summary` に provenance 内訳
   - `meta-edit log --provenance <値>` フィルタ
   - legacy `edit_docs_only` bucket 表示
   - `meta-edit drafts` は不採用（マーカー廃止のため）。代わりに
     `meta-edit log --provenance speculation,inference` で同等の
     audit が取れる

5. **Phase E（任意）: CLAUDE.md §11 補強**
   - prose の hedging だけで十分機能する想定だが、念のため §11 に
     「過去セッションが書いた prose の hedging を尊重し、安易に
     確定文に書き換えない」一文を追加するか検討
   - 必須ではない。マーカー方式と違い、prose 表現は自明なので
     skip 可能

6. **Phase F: external surfaces 同期**
   - README ×3、site/index.html、plugin.json、marketplace.json の
     更新（21 ツール、新 kind、provenance の概念紹介）
   - `edit_explanation` の `additional_files` を使った多言語同期で
     1 PR

Phase A は最初、B → C → D は順序依存、E と F は B 以降ならいつでも。

---

## 8. References

- 壁打ちログ：このセッションのチャット履歴（branch
  `claude/fix-chat-context-issue-oi3dk`）
- 影響範囲調査：`./research.md`
- 既存 `edit_docs_only` description: `src/tools/descriptions.ts:745-805`
- 既存 `edit_cosmetic` description: `src/tools/descriptions.ts:67-` 周辺
- 既存 `edit_policy_change` description: `src/tools/descriptions.ts:687-743`
- SPEC Article 4: `docs/SPEC.md:93-160`
- SPEC Article 7: `docs/SPEC.md:312-348`
- CLAUDE.md §1, §3, §7, §12

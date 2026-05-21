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
- 新セッション boot 時の log overlay（マーカー方式採用により不要）

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
- `additional_files` は `edit_explanation` と `edit_decision` のみ受理
  （多言語 README 同期、リリース一括 commit 等が定型）

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

#### 5 新 workflow kind

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

#### 16 impl tools (15 SQLite + `edit_cosmetic`)

**reject 組み合わせは設けない**（reject を増やすと AI が誤申告で
通すリスクの方が高い）。全組み合わせ OK、ただし以下は **warn +
ファイル内マーカー強化**：

- `inference` — 観察からの推論で書いた変更（要マーク）
- `speculation` — 仮置き実装（強い注意喚起）

`direct_observation` / `accepted_artifact` / `user_confirmed` は
通常運用、マーカーなし or 軽マーカー（§3.4）。

### 3.4 ファイル内マーカー（AI 自書 + 任意サーバ検証）

#### 3.4.1 メカニズム

meta-edit 自身は書かない（`src/tools/apply.ts` のコメント、SPEC
Article 5 — 実際の write は native Edit/Write が行い、deny-raw-edit
hook が grant を消費する）。よってマーカーは **AI が native Edit/
Write の content 内に直接書く** 設計とする：

1. AI は typed_edit を呼んで `edit_id` を受け取る
2. 同 `edit_id` を含むマーカーを、続く native Edit/Write の new_string
   / content 内に書き込む
3. （任意）deny-raw-edit hook が write 直前に **substring 存在検証**
   する：marker 文字列が含まれない場合 warn を出す（reject しない）

substring 検証は `rationale.length > 0` と同種の構文的 lint であり
diff 内容解析ではない（Article 7 セーフ）。

#### 3.4.2 マーカー強度（2 段階）

| provenance | マーカー | 説明 |
|---|---|---|
| `user_confirmed` | 不要 | 決定稿として扱う |
| `accepted_artifact` | 不要 | 決定稿として扱う |
| `direct_observation` | **推奨**（required ではない） | 観察根拠の追記欄。1 行追加など friction が高い場合は省略可、ただし edit log には provenance が残る |
| `inference` | **必須** | 検証されていない推論で land 済み、要再確認 |
| `speculation` | **必須** | 未検証仮説、要検証 |

`direct_observation` を必須にしないのは、`// XXX breaks for N>1000`
のような 1 行コメント追加で marker 3 行を要求すると friction 過剰、
AI が「じゃあコメントを書かない」に逃げる回避策となるため
（RFC §6 元 open question #6 への回答）。

#### 3.4.3 マーカー文字列テンプレート（言語非依存）

AI は **編集対象ファイルの言語に合わせた comment 記法** で以下の
テンプレートをラップする：

```
meta-edit: <PROVENANCE_LABEL> (edit_id=<EDIT_ID>) — <短い注記>
... 編集された内容 ...
/meta-edit (edit_id=<EDIT_ID>)
```

`<PROVENANCE_LABEL>` の値：

- `direct_observation` → `observation`
- `inference` → `INFERENCE — 再確認推奨`
- `speculation` → `SPECULATION — 未検証`

注釈（`— ...` 部分）は AI が rationale から抜粋して書く。
edit_id は typed_edit のレスポンスから引用。

言語別の wrapping 例：

| 言語 | 開始マーカー | 終了マーカー |
|---|---|---|
| Markdown / HTML / XML / SVG | `<!-- meta-edit: ... -->` | `<!-- /meta-edit (edit_id=...) -->` |
| JS / TS / Java / Go / Rust / C / C++ | `// meta-edit: ...` | `// /meta-edit (edit_id=...)` |
| Python / Ruby / Bash / YAML / TOML | `# meta-edit: ...` | `# /meta-edit (edit_id=...)` |
| SQL / Lua / Haskell | `-- meta-edit: ...` | `-- /meta-edit (edit_id=...)` |
| Lisp / Clojure | `;; meta-edit: ...` | `;; /meta-edit (edit_id=...)` |
| OCaml | `(* meta-edit: ... *)` | `(* /meta-edit (edit_id=...) *)` |
| JSON | （comment 不可、log のみ） | — |
| CSS | `/* meta-edit: ... */` | `/* /meta-edit (edit_id=...) */` |

サーバは言語マップを持たない。description で例を示し、AI が
ファイル拡張子から判断する。1 行 inline 形式（`// 実コンテンツ
[meta-edit: observation edit_id=...]`）も description で許可：開始/
終了マーカー型と inline 型のどちらでも presence 検証は通る
（`edit_id=<EDIT_ID>` substring が new_string に含まれていれば OK）。

#### 3.4.4 JSON / コメント不可ファイルの扱い

JSON など comment 構文を持たないファイルでは：

- マーカーを書き込まない
- provenance は edit log にのみ残る
- typed_edit のレスポンスに `marker_omitted: true` を含めて AI に通知
  （後段の `meta-edit drafts` CLI で「ファイル内マーカー無しだが
  inference/speculation 扱いの編集」を集計できるように）

#### 3.4.5 マーカー昇格 / 除去パス

- `speculation` → `user_confirmed` 等への昇格：**同じファイル / 同じ
  edit_id 領域を再宣言**して上書き。新しい native Edit で marker
  行を削除しつつ実コンテンツを残す
- `direct_observation` 等の追記でマーカーが残っている領域を編集する
  場合：新しい provenance に合わせて marker を書き換える（古い
  edit_id の marker は新しい edit_id の marker に置き換わる）

server は marker 寿命管理をしない（AI 自身の責務）。これは
"description で行動を変える" 哲学と整合的。

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

### 3.6 新セッションが認知する経路

ファイル内マーカーがあれば新チャットは：

1. `IMPLEMENTATION-LOG.md` 等を読んだ瞬間に
   `<!-- meta-edit: INFERENCE — 再確認推奨 -->` を視認
2. CLAUDE.md §11（「セッションの形」）に「マーカー付きブロックは
   ユーザーに再確認」を追記（実装 PR で `edit_policy_change` 経由）

`provenance ∈ {inference, speculation}` のブロックは新セッションで
**自動的に再確認対象**として浮上する。`accepted_artifact` /
`user_confirmed` は決定稿として扱われる。

---

## 4. Constitutional analysis (Article 7 amendment bar)

### 4.1 これは detection ではない

| 要素 | Detection? | 既存類似機構 |
|---|---|---|
| 5 workflow kind 追加 | No（type 軸の解像度上昇） | 既存 17 kind の延長 |
| `provenance` 必須化 | No（宣言フィールド追加） | `target` / `rationale` / `test_files` |
| 無効組み合わせ reject | No（宣言間の組み合わせ規則） | `target="test"` + non-empty `test_files` reject と同型 |
| `accepted_artifact` citation lint | **境界**：文字列パターン照合のみ。artifact 実在 / 内容整合は検証しない。warn のみ | path-safety と同種の構文 lint |
| マーカー（AI 自書） | No（content 文字列の組み立て） | 既存の `rationale` 文字列と同型 |
| マーカー presence 検証（任意） | **境界**：substring 存在チェックのみ。AI が書いたか書いてないかしか見ない。中身の妥当性検証はしない。warn のみ | `rationale.length > 0` と同種の構文 lint |
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
>   （rationale に引用を含めること）
> - `direct_observation` — 実行結果 / 読んだコード / log から直接観察
> - `inference` — 観察からの推論（ファイル内マーカー付きで land する）
> - `speculation` — 未検証の仮説（ファイル内マーカー付きで land する）

reject 組み合わせなし、`inference` / `speculation` はマーカー強化。

---

## 6. Remaining open questions

1. **`additional_files` の受理 kind** — `edit_explanation` と
   `edit_decision` のみ案で OK か？（RFC §3.1）
2. **`edit_cosmetic` の境界例** — typo 修正と「情報を変える編集」の
   境界、`stale コメント削除` の扱い（§3.5 のテーブル）に追加例の
   要望はあるか
3. ~~マーカーのコード言語別表現~~ → **解決**（§3.4.3 で AI が言語別
   wrapping を行う方式に決定。サーバは言語マップを持たない）
4. **`edit_cosmetic` での provenance マトリクス** — RFC §3.3 は
   workflow と impl のみ。cosmetic は impl 側のルールに乗せる（warn
   なし、全 OK）か、それとも cosmetic の性質上 `direct_observation` /
   `accepted_artifact`（formatter ルール由来）のみ accept にするか
5. **legacy `edit_docs_only` への自動マイグレーション** — 旧呼び出しは
   land 時点で reject、それとも一定期間 `edit_progress` にエイリアスして
   warn を出す移行期間を設けるか
6. ~~`edit_observation` での `// XXX` 系コメント追加 friction~~ → **解決**
   （§3.4.2 で `direct_observation` のマーカーを「推奨」に格下げ。
   1 行コメント追加で marker 必須にならない）
7. **マーカー presence 検証を入れるか** — §3.4.1 では「任意」と
   したが、実装側で：(a) 入れる（observability 強化、warn 1 件だけ
   増える）/ (b) 入れない（pure honor）。私の推し：(a)

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

3. **Phase C: マーカー（AI 自書 + presence 検証）**
   - description テンプレート文言の確定（§3.4.3）と `descriptions.ts`
     への流し込み（Phase A の続きとして）
   - deny-raw-edit hook に optional substring 存在検証を追加：
     provenance が `inference` / `speculation` のとき edit_id
     marker が write 内容に含まれているかチェック、不在なら warn
   - typed_edit レスポンスに `marker_required: bool` と
     `marker_example: string`（拡張子から推測した wrapping 例）を
     追加してエージェントへフィードバック
   - JSON 等 comment 不可ファイルでは `marker_omitted: true` を返す
   - test：marker 含有 write の grant 消費、marker 欠落の warn、
     昇格時の上書き、JSON での marker 省略動作

4. **Phase D: 集計 + CLI**
   - `meta-edit summary` に provenance 内訳
   - `meta-edit log --provenance <値>` フィルタ
   - `meta-edit drafts`（新規）でマーカー付きブロック一覧
   - legacy `edit_docs_only` bucket 表示

5. **Phase E: CLAUDE.md §11 改訂**
   - 新セッション boot 時の「マーカー付きブロックを再確認」規律を
     追記
   - `edit_policy_change` 経由

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

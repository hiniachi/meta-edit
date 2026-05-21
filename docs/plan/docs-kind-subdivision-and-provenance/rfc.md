# RFC — `edit_docs_only` の kind 細分化 + `provenance` 宣言

Status: **DRAFT** — ユーザー承認待ち。本 RFC は仕様提案であり、
実装はまだ走らせない。同フォルダの `research.md` は影響範囲調査。

| Field | Value |
|---|---|
| Author | meta-edit session |
| Created | 2026-05-21 |
| Target | v0.6.0（minor bump） |
| Touches | SPEC Article 4 / SPEC §4 / SPEC §6 / CLAUDE.md §1,§3,§12 |
| Constitutional | Yes（Article 7 amendment bar — §4 で論証） |

---

## 1. Problem statement

過去チャットで作成した成果物（`IMPLEMENTATION-LOG.md`,
`OBSERVED-FAILURES.md`, `issues/**`, `README.md` 系、`docs/plan/**`
など）が、新しいチャットからは「ただ存在するファイル = 決定稿」と
見えてしまう。実際には次のような epistemic status が混在している：

- **user_approved** — ユーザーが明示確認した決定
- **provisional** — 暫定的な作業メモ、後で再確認したい
- **speculation** — 根拠の薄い推論、思いつき

現状の `edit_docs_only` は doc 全般を 1 ツールでカバーするため、
description で「決定稿として書くな」「open questions を残せ」
「公開面に憶測を書くな」のように **対象 doc 種別ごとに鋭く** 行動を
誘導することが難しい。ツール description は meta-edit の中核 surface
であり、ここで粒度を落としていると bet（descriptions だけで AI 行動
が変わる仮説）の効果検証も鈍る。

二次的な問題：edit log の集計でも `edit_docs_only` が「混雑バケツ」
になり、健康指標として読みづらい。

---

## 2. Non-goals

- パッチ内容の検査（Article 7 違反）。
- `provenance` の真偽検証（自己申告のみ）。
- 実 impl ツール（16 本）への `provenance` 適用（壁打ち段階で議論あり。
  別 RFC へ分離して順次評価）。
- 新セッション boot 時の overlay 読み込み機構（CLAUDE.md §11 改訂で
  独立に達成できる。本 RFC とは独立に意思決定可能）。
- 国際化（既存 description と同様、英語が source）。

---

## 3. Proposal

### 3.1 Kind 細分化（`edit_docs_only` → 6 ツール）

`edit_docs_only` を以下に分割：

| 新 kind | 対象パス（典型） | 性格 |
|---|---|---|
| `edit_work_log` | `IMPLEMENTATION-LOG.md`, `docs/plan/**/research.md` | 作業実況・自己観察 |
| `edit_failure_note` | `OBSERVED-FAILURES.md` | 観察された失敗パターンの記録 |
| `edit_issue_filing` | `issues/**`, `docs/plan/**/rfc.md`（本ファイル含む） | 提案・open question・未確定 |
| `edit_external_doc` | `README*.md`, `docs/SPEC.md`(*), `docs/`, `site/**` | 公開面 |
| `edit_changelog` | `CHANGELOG.md`, リリースノート | リリース済み事実の記録 |
| `edit_contributor_doc` | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` | 開発プロセス文書 |

(*) `docs/SPEC.md` は `edit_policy_change` の管轄でもある（spec /
governance 面）。境界ルール：**spec ⊃ external_doc**。SPEC の
constitutional 変更は `edit_policy_change`、SPEC §4 の description
文言調整など振る舞いを変えない範囲は `edit_external_doc`。RFC 実装
フェーズでこの境界を description に明文化する。

`CLAUDE.md` は引き続き `edit_policy_change`（AI 指示ファイル）。

#### 3.1.1 `additional_files` の受理

batch-friendly 性質が必要なのは：

- `edit_external_doc`（README 多言語版の同時更新が定型）
- `edit_changelog`（バージョンタグ + CHANGELOG + プラグイン json の
  リリース一括が定型）

それ以外（`work_log`, `failure_note`, `issue_filing`,
`contributor_doc`）は `additional_files` を **持たない**。これは
SPEC §3 の「1 declaration = 1 file が原則、workflow tool だけ例外」
の constitutional 設計を保つ。

### 3.2 `provenance` 宣言フィールド

上記 6 kind すべてに **必須** で追加：

```ts
provenance: "user_approved" | "provisional" | "speculation"
```

- `user_approved` — ユーザーが当該チャット内で当該変更を明示承認した
- `provisional` — 暫定。次セッションで再確認対象
- `speculation` — AI 単独の推論。根拠の言語化が不十分

`rationale` フィールドに「なぜその provenance か」の一言を載せる
ことを description で求める（強制はしないが、loosening 系の policy
で前例あり：`edit_policy_change` の "Convenience is not acceptable"
パターン）。

### 3.3 無効な kind × provenance 組み合わせ

サーバー側で **declaration を reject**（applied: false）：

| kind | speculation | provisional | user_approved |
|---|---|---|---|
| `edit_work_log` | OK | OK | OK |
| `edit_failure_note` | OK | OK | **warn** ※1 |
| `edit_issue_filing` | OK | OK | OK ※2 |
| `edit_external_doc` | **reject** | warn ※3 | OK |
| `edit_changelog` | **reject** | **reject** | OK ※4 |
| `edit_contributor_doc` | **reject** | warn ※3 | OK |

注：

- ※1 `failure_note` は AI 自身の観察記録。ユーザー承認は通常無関係。
  warn のみ（誤運用の可能性をログに残す）。
- ※2 `issue_filing` での `user_approved` は「ユーザーが起票を指示」
  ケース。妥当。
- ※3 公開面・コントリビューター文書を `provisional` で書くのは
  通常おかしい（公開時点で確定しているべき）。warn だが reject は
  しない（ドラフトの一時 commit などの正当ケースがあるため）。
- ※4 CHANGELOG は出荷済み事実のみ。`user_approved` 以外あり得ない。

reject 系は既存 `validateRequest` の warnings 蓄積パターンと同型。

### 3.4 ファイル内マーカー注入（apply 時）

`provenance !== "user_approved"` の場合、apply フェーズで対象 patch
の **書き換えブロック先頭** に HTML コメントマーカーを挿入する：

```html
<!-- meta-edit: provisional (edit_id=20260521-001, kind=edit_work_log) -->
... 実コンテンツ ...
<!-- /meta-edit -->
```

マーカーは：

- Markdown コメントなのでレンダリングされない
- `grep` で全件抽出可能（CLI コマンド `meta-edit drafts` を後続で追加）
- `edit_id` で edit log と紐付け可能
- 同ファイルを再編集する際は **古いマーカーを尊重**（user が承認
  したら剥がす運用：`provenance: "user_approved"` で同 edit_id を
  上書き宣言、apply 時にマーカー除去）

注入位置の具体策：

- 単純パッチ（hunk が連続している）：パッチで書き加わるブロックの
  前後にマーカー
- 既存ブロックの中間挿入：マーカーは挿入された hunk のみを囲む

実装は `src/tools/apply.ts` の patch 適用後に文字列処理として行う。
**パッチ内容の意味解析は行わない**（Article 7 違反になる）。マーカー
を貼る位置は「新規追加された行 / hunk」という構文的事実のみで決定。

`edit_external_doc` で provenance: provisional の warn が出るときは、
マーカーに「provisional: 公開前にレビュー必要」の文言を含める。

### 3.5 新セッションが認知する経路

ファイル内マーカーがあれば新チャットは：

1. `IMPLEMENTATION-LOG.md` 等を読んだ瞬間に `<!-- meta-edit:
   provisional ... -->` を視認
2. CLAUDE.md §11（「セッションの形」）に「マーカー付きブロックは
   ユーザーに再確認」を追記（本 RFC の implementation で
   `edit_policy_change` 経由）

option b（edit log overlay）は **採用しない**：

- ファイル内マーカー方式の方が "surface で行動を変える" meta-edit
  哲学と整合的
- マーカーは AI が読まない選択肢を持てない（log は能動的に
  読まないと見えない）
- CLAUDE.md 規律に依存するレイヤーを減らせる

---

## 4. Constitutional analysis (Article 7 amendment bar)

`SPEC.md` Article 7 は「constitutional-amendment bar をクリアする
には実験信号（bet）の保存を論じる必要」と規定。

### 4.1 これは detection ではない

追加要素はすべて **宣言** と **宣言由来の静的出力**：

| 要素 | Detection? | 既存類似機構 |
|---|---|---|
| kind 細分化 | No（type 軸の解像度上昇） | 既存 17 kind の追加と同質 |
| `provenance` 必須化 | No（宣言フィールド追加） | `target`, `rationale`, `test_files` |
| 無効組み合わせ reject | No（宣言間の組み合わせ規則） | `target="test"` + non-empty `test_files` の現行 reject と同型 |
| ファイル内マーカー注入 | No（apply 時の文字列連結） | パッチ内容を読まない |

diff 内容を見ない、宣言と実態の照合をしない、test の意味解析もしない。

### 4.2 bet の信号は強まる

bet の主張は「**well-designed tool surface > complex verification
surface**」（CLAUDE.md §13）。本 RFC は verification surface を一切
増やさず、tool surface の解像度のみを上げる。description の効きが
弱い領域（doc 系）に対して **description 1 本を 6 本に増やして** 
鋭く効かせる方向であり、bet の主張をより厳しく試す変更。

### 4.3 "seventeen tools" の見出し変更

`SPEC.md` Article 4 / CLAUDE.md §1, §12 の "seventeen" は更新が要る。
本 RFC は workflow tool を `1` → `5〜6` に拡張するため、見出し記述
（"15 SQLite + edit_cosmetic + 1 workflow"）の "1 workflow" を
"6 workflow" に書き換える。これは constitutional な記述変更だが、
**比率の哲学（impl が dominate、workflow は周辺）は維持**。

### 4.4 自己申告 honesty の構造的弱さ

`provenance: "user_approved"` を AI が虚偽申告する誘惑がある。
検出器は Article 7 で封じられているので、`description` での
摩擦設計のみで戦う。RFC 実装フェーズで以下を description に
入れる：

- 「**user が明示した文脈の引用なしに `user_approved` を選ぶな**」
- 「迷ったら `provisional` を選び、user に確認」
- fallback obligation 節（既存 `edit_policy_change` パターン）

これは meta-edit 全体の哲学と整合的なリスクであり、新規に raise
される脅威ではない。

---

## 5. Tool descriptions ドラフト（要点のみ）

実装フェーズで verbatim にしてから `descriptions.ts` に流し込む。
本 RFC では概略のみ示す。

### 5.1 `edit_work_log`

> 作業実況の記録。`IMPLEMENTATION-LOG.md` 等の自己観察ファイルを
> 修正する。
>
> Use this tool when:
> - セッションの作業結果を時系列で記録
> - "what worked", "known issues", "open questions" の構造で書く
>
> MUST NOT:
> - 決定として書く（user 明示確認なしに `provenance: user_approved`
>   を選ばない）
> - 他人のセッションの動作を断定的に評価する
>
> Provenance guidance:
> - `user_approved`: user が当該結果を確認した
> - `provisional`: 動作確認はしたが user 未確認
> - `speculation`: 動かしていない、または推論のみ
>
> Required tests: NONE.

### 5.2 `edit_failure_note`

> 観察された失敗パターンを `OBSERVED-FAILURES.md` に追記する。
>
> Use this tool when:
> - AI が typed surface を回避した、誤った kind を選んだ等の
>   観察事実を記録
> - restore trigger（warn → deny に戻す条件）を必ず併記
>
> MUST NOT:
> - 検出器の実装案を書く（§7.3, Article 7）
> - 観察したことのない仮想パターンを書く
>
> Provenance guidance:
> - 通常は `provisional`（追加観察で改訂される前提）
> - `user_approved` は warn が出る（user が観察対象ではないため）

### 5.3 `edit_issue_filing`

> 新規 issue / RFC / proposal を起票する。`issues/**`,
> `docs/plan/**/rfc.md` 等。
>
> Use this tool when:
> - 提案として書く（決定として書かない）
> - open questions を残す
>
> MUST NOT:
> - "I will implement" と書く（提案段階）
> - 仮想の user 同意を捏造する

### 5.4 `edit_external_doc`

> 公開面のドキュメント（README, docs/, site/, SPEC のうち振る舞いを
> 変えない記述調整）。
>
> Use this tool when:
> - 出荷済み機能の説明を更新
> - 多言語 README を `additional_files` で同期
>
> MUST NOT:
> - 未出荷機能を書く
> - 単独情報源として API 仕様を書く（コードの真実と乖離する）
> - `speculation` provenance（reject）
>
> Required tests: NONE.

### 5.5 `edit_changelog`

> リリース済み変更を `CHANGELOG.md` / リリースノートに記録。
>
> Use this tool when:
> - merge 済み変更のみ
> - tag 付与と同時、または直後の commit
>
> MUST NOT:
> - 未マージの変更を書く
> - `provisional` / `speculation` provenance（reject）

### 5.6 `edit_contributor_doc`

> 開発プロセス文書（`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
> `SECURITY.md`）。
>
> Use this tool when:
> - プロセス決定が固まった後
>
> MUST NOT:
> - 技術的決定をここで初出にする（他の場所で固まっていることが前提）
> - `speculation` provenance（reject）

---

## 6. Open questions（user 確認要）

1. **`provenance` を impl 16 本にも広げるか**
   - 壁打ち中の私の推し：広げる派（仮置きのコードでも同じ事故が
     起きる）
   - user 未回答
   - 本 RFC では docs 側のみとし、impl 側は v0.7+ 別 RFC に分離する
     ことを提案

2. **マーカー方式 vs log overlay 方式**
   - 本 RFC は §3.4 / §3.5 でマーカー方式を採用と書いたが、
     これは設計判断
   - user の反対があれば変更可

3. **`edit_external_doc` と `edit_policy_change` の境界**
   - 本 RFC §3.1 の暫定線で問題ないか
   - SPEC.md の文言調整を policy_change にすると friction 過剰、
     external_doc にすると governance loosening を素通しになりうる
   - 実装フェーズでより明確な境界文を求めるべきか

4. **既存ログの後方互換**
   - `kind: "edit_docs_only"` の旧エントリを summary の legacy
     bucket に置く（research.md §5.1）案で OK か

5. **"seventeen" → 新カウント**
   - workflow tool が 1 → 6 なので合計 17 → 22
   - README / site / SPEC / CLAUDE / plugin.json の表記変更
     （research.md §3.5）を本 RFC 採用と同時に行うか、別 PR で先行
     させるか

---

## 7. Rollout plan（承認後）

1. **Phase A: SPEC + descriptions**
   - `docs/SPEC.md` Article 4 / §4 / §6 を更新
   - `src/tools/descriptions.ts` に 6 つの新 description を追加、
     `edit_docs_only` を削除
   - 既存 `edit_docs_only` 参照（test/CLI/hooks の hint 文）を新名に
     置換
   - 単位：`edit_policy_change` の大型 PR

2. **Phase B: provenance フィールド**
   - `EditToolRequestSchema` / `validateRequest` に追加
   - 無効組み合わせ table 実装
   - test 追加（rejection + acceptance 両面）

3. **Phase C: マーカー注入**
   - `src/tools/apply.ts` に注入ロジック
   - `provenance !== "user_approved"` 時のみ動作
   - test 追加

4. **Phase D: 集計 + CLI**
   - `meta-edit summary` で provenance ごとの内訳
   - `meta-edit drafts`（新規）でマーカー一覧表示
   - legacy `edit_docs_only` bucket の表示

5. **Phase E: CLAUDE.md §11 改訂**
   - 新セッション boot 時に "drafts を確認" を組み込む
   - `edit_policy_change` 経由

各 Phase は独立 PR、Phase B → C → D は順序依存。Phase A は最初。

---

## 8. References

- 壁打ちログ：このセッションのチャット履歴（branch
  `claude/fix-chat-context-issue-oi3dk`）
- 影響範囲調査：`./research.md`
- 既存 `edit_docs_only` description: `src/tools/descriptions.ts:745-805`
- 既存 `edit_policy_change` description: `src/tools/descriptions.ts:687-743`
- SPEC Article 4: `docs/SPEC.md:93-160` 周辺
- SPEC Article 7: `docs/SPEC.md:312-348`
- CLAUDE.md §1, §3, §7, §12: `CLAUDE.md`

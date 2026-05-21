# Research — `edit_docs_only` 解体 + workflow-axis kinds + epistemic provenance

Status: **APPROVED**（2026-05-21）— `rfc.md` の影響範囲調査。実装
PR でこの map を参照する。

---

## 1. Motivating problem (one-paragraph recap)

過去チャットが残す `IMPLEMENTATION-LOG.md` / `OBSERVED-FAILURES.md` /
`issues/**` / コード内コメント等が、新チャットからは「ただ存在する
ファイル = ユーザー承認済みの決定」に見えてしまう。実際には「途中の
作業メモ」「仮置きの推論」「未検証の仮説」が混じっているのに、その
epistemic 出所がファイルにも edit log にも残らない。`edit_docs_only`
が doc 全般を 1 ツールでカバーしているため kind ごとの description
チューニングも効きが弱い。詳細は `rfc.md` §1。

---

## 2. Current surface (baseline)

### 2.1 Tool inventory (v0.5.0)

合計 **17 ツール**（`src/tools/descriptions.ts:24-48`）。

- 15 SQLite-derived impl tools
- 1 cosmetic（`edit_cosmetic`）
- 1 workflow（`edit_docs_only`）

impl 16 本（15 + cosmetic）は `target: "prod" | "test"` 必須。
`edit_docs_only` は `target` 持たず、`additional_files` 受理可。

### 2.2 Provenance 既存類似フィールド

現状の declaration は `rationale` / `target` / `test_files` /
（workflow のみ）`additional_files`。**epistemic 出所の宣言は存在
しない**。`rationale` はあるが「なぜその変更か」の自由記述で、
「その判断の根拠タイプ」を強制する欄ではない。

### 2.3 `edit_docs_only` のスコープ

`src/tools/descriptions.ts:745-805` の description より：Markdown 全般、
コメント、JSDoc/docstring、CHANGELOG、メタドキュメント、新規 issue
ファイルの内容 fill。明示的除外：実コード、テスト、build/CI 設定、
API contract、未出荷機能の README 記述、未リリース CHANGELOG。

### 2.4 `edit_cosmetic` のスコープ

`src/tools/descriptions.ts:67-` の description より：

- whitespace 調整
- コメント編集（typo 修正、言い換え、追加、削除）
- formatter 出力

本 RFC は **コメント編集を `edit_cosmetic` から剥がす**（whitespace
+ formatter only に narrow）。新規・情報変化を伴うコメントは
workflow 軸（`edit_observation` / `edit_explanation` / `edit_proposal`
のいずれか）。情報を変えない typo 修正 / 言い換えのみ cosmetic に残す
（後述、§3.4）。

### 2.5 `edit_policy_change` のスコープ（参考）

`src/tools/descriptions.ts:687-743`。`.claude/`, `.github/workflows/`,
AI 指示ファイル（CLAUDE.md 等）, `edit_*` の description / schema /
hook 挙動, build/release プロファイル。本 RFC では **触らない**
（governance 面は引き続き policy_change の管轄）。

---

## 3. Code impact map

### 3.1 Core plumbing (必修)

| File | What changes |
|---|---|
| `src/tools/descriptions.ts` | `TOOL_NAMES` 更新（17 → 21）：`edit_docs_only` 削除、`edit_progress` / `edit_observation` / `edit_proposal` / `edit_decision` / `edit_explanation` 追加。`TOOLS_REQUIRING_TEST_FILES` の除外集合更新（5 新 kind 全部除外）。`TOOLS_REQUIRING_TARGET` の除外集合更新（5 新 kind を除外）。`TOOL_DESCRIPTIONS` に新 5 件追加、`edit_docs_only` を削除。`edit_cosmetic` の description を narrow（コメント条項を削除）。impl 16 本の description に provenance guidance を追記 |
| `src/tools/common.ts` | `TOOLS_ACCEPTING_ADDITIONAL_FILES`（配列、kind 単位 binary）を **削除**、(kind, provenance) セル単位 lookup 関数 `evaluateAdditionalFiles(kind, prov) → "accept" \| "warn" \| "reject"` に置換（RFC §3.3.2 マトリクス由来）。`EditToolRequestSchema` に `provenance` 必須フィールド追加（全 21 ツール対象）。`ProvenanceSchema = z.enum(["user_confirmed", "accepted_artifact", "direct_observation", "inference", "speculation"])`。`validateRequest` に：(a) provenance 必須化、(b) §3.3.1 kind×prov reject/warn 検査、(c) `accepted_artifact` 選択時の rationale 内 artifact citation チェック、(d) `additional_files` 含む場合の §3.3.2 cell lookup、(e) §3.3.3 cosmetic 専用 reject ルール（`inference` / `speculation` reject）|
| `src/tools/registry.ts` | JSON Schema に `provenance` を全 tool 追加。workflow-tool 判定（現状 `edit_docs_only` 決め打ち）を `TOOLS_ACCEPTING_ADDITIONAL_FILES` 由来に差し替え |
| `src/tools/apply.ts` | `edit_docs_only` 名前決め打ちの分岐を廃止（batch 受理 kind 集合へ）。`next_action` 文を provenance ごとに branch（`inference` / `speculation` に prose リマインダを末尾付加）。**マーカー注入はしない**（RFC §3.4 で構造的マーカーを廃止、AI に prose 自体で uncertainty を表現させる方式に変更） |
| `src/state/edit-log.ts` | log エントリに `provenance` 追加（既存読み出しは optional として後方互換）。`marker_present` 系フィールドは不要（マーカー機構なし） |

**重要：パス matcher は持たない**。AI の宣言のみで kind を確定する。
プロジェクトごとにファイル配置が変わるためサーバ側で
「`README.md` だから `edit_explanation`」のような検証はしない。

### 3.2 `accepted_artifact` の citation チェック

`provenance: "accepted_artifact"` を選んだとき、`rationale` 内に少な
くとも 1 件の参照（例：`SPEC.md §4`, `ADR-007`, `issues/031-...`,
URL）が含まれることを軽い構文チェックで要求。何が "artifact 参照"
かはゆるく定義（`§`, `ADR-`, `issues/`, `RFC-`, URL パターン等）。
不在なら warn（reject ではない、AI 申告の honesty 寄り）。

### 3.3 `additional_files` の受理判定

現状：`edit_docs_only` のみ受理（kind 単位 binary）。

本 RFC：**判定は (kind, provenance) セル単位**（rfc.md §3.3.2 マトリクス、
open-questions.md Q1 で確定）。`TOOLS_ACCEPTING_ADDITIONAL_FILES` を
kind-binary な配列で持つ旧案（`["edit_explanation", "edit_decision"]`
等）は **採用しない** — それでは `edit_proposal × accepted_artifact`
や `edit_proposal × speculation` のような accept セルが誤って reject
される。

実装方針：

- `evaluateAdditionalFiles(kind, prov) → "accept" | "warn" | "reject"`
  を `src/tools/common.ts` に新設し、rfc.md §3.3.2 のマトリクスを
  そのままコード化する
- `validateRequest` は `additional_files` が指定されたときのみ本関数
  を呼ぶ。`target_file` のみの単一 declaration は本マトリクスを引かず、
  §3.3.1 のみで評価
- `edit_progress` 行は全列 reject なので、`additional_files` 自体を
  申告した時点で reject。それ以外の 4 kind は (kind, prov) によって
  accept / warn / reject が分かれる

参考シナリオ（accept セル）：

- `edit_explanation` — 多言語 README 同期、docs/ 一括更新で batch が
  自然
- `edit_decision` — リリース時の CHANGELOG + tag メタ + plugin.json
  bump が定型
- `edit_proposal × accepted_artifact` — audit document から起こす
  issue 一括起票
- `edit_proposal × speculation` — feature kickoff の探索的 issue burst

### 3.4 `edit_cosmetic` の narrow

description 内 "Comment edits (typo fix, ...)" 条項を：

> Comment edits that change NO information content (typo fix, line-break
> reflow). Comments that add or change information go through the
> workflow kind matching the comment's intent (`edit_observation` /
> `edit_explanation` / `edit_proposal`).

に置換。境界例：

| 例 | 旧 | 新 |
|---|---|---|
| ` /** function does X */` 追加 | cosmetic | `edit_explanation` |
| `// XXX breaks for N>1000` 追加 | cosmetic | `edit_observation` |
| `// TODO: refactor` 追加 | cosmetic | `edit_proposal` |
| `// docments` → `// documents` typo 修正 | cosmetic | cosmetic（情報不変） |
| コメントブロック全体のインデント修正 | cosmetic | cosmetic |
| docstring の API 例追記 | cosmetic | `edit_explanation` |
| stale コメント削除 | cosmetic | `edit_observation`（"この情報は古いと観察した"） or stop-and-ask |

### 3.5 Hooks（hint メッセージ更新のみ）

| File | Action |
|---|---|
| `src/hooks/raw-edit-policy.ts:270-275` | empty-file create warn の `edit_docs_only for Markdown / docs` 言及を新 5 kind の `edit_explanation` / `edit_progress` 等を例示する形に置換 |
| `src/hooks/raw-edit-policy.ts:280 周辺` | "typically edit_cosmetic or edit_docs_only" の例示を新 kind に置換 |
| `src/hooks/bash-write-policy.ts:1201-1214` | `warnVerbReason()` ヘルパー内の `edit_cosmetic / edit_state_transition / edit_docs_only` 例示を新 kind に更新 |
| `src/hooks/bash-write-policy.ts:1992 周辺` | 同様の hint 文の `edit_docs_only` 参照を新 kind に置換 |

実装変更なし、文言のみ。RFC §3.4 で marker 機構を廃止したため、
hook 側の substring 検証も不要になった。

注：reminder-style-hooks RFC が先に land する想定なので、本 RFC 実装
時点では hook の reason 文は **既に reminder スタイル**。本 RFC は
その reminder スタイル文中に残る `edit_docs_only` 言及を新 kind に
書き換える（wording principle 自体は触らない）。

### 3.6 SessionStart hook（既存）と typed-edit-onboarding Skill の更新

| File | Action |
|---|---|
| `src/hooks/session-onboarding.ts:86` | `buildOnboardingMessage()` 内の "seventeen-tool catalog" → "twenty-one-tool catalog"。reminder スタイル wording は reminder-style-hooks RFC が先に land 済みの想定 |
| `skills/typed-edit-onboarding/SKILL.md:3,10,129` | "seventeen" 言及を "twenty-one" に更新。tool 一覧 / 選択ヒューリスティック節も 5 新 kind を反映 |

### 3.7 CLI

| File | Action |
|---|---|
| `src/cli/log-cmd.ts:16, 66` | `edit_docs_only` 名前決め打ちで target 抜き扱いしている分岐を、`TOOLS_REQUIRING_TARGET` 補集合に置換。`--provenance` フィルタ追加（複数指定は `--provenance speculation,inference` 形式） |
| `src/cli/summary-cmd.ts:94, 122` | 新 5 kind 行を追加。`edit_docs_only` を legacy bucket 表示。provenance 別の小計列を追加 |
| `src/cli/help-cmd.test.ts:65-69` | サンプル tool 名置換 |

**`meta-edit drafts` サブコマンドは実装しない**。マーカーブロック前提
の旧案だったが、RFC §3.4 でマーカー機構を廃止したため不要。`speculation`
/ `inference` の抽出は `meta-edit log --provenance speculation,inference`
で代替する。

### 3.8 Tests

直接 `edit_docs_only` を参照するテスト（v0.5 時点）：

```
src/tools/registry.test.ts (5 箇所)
src/tools/common.test.ts (4 箇所)
src/tools/handler.test.ts (4 箇所)
src/tools/descriptions.test.ts (1 箇所)
src/cli/summary-cmd.test.ts (3 箇所)
src/cli/log-cmd.test.ts (2 箇所)
src/cli/help-cmd.test.ts (1 箇所)
src/test-helpers.ts (1 箇所, fixture 名)
src/hooks/bash-write-policy.test.ts (1 箇所, 無関係の grep 例)
```

追加テスト：

- 新 5 kind の登録 / description verbatim 同期
- `provenance` 必須化 / enum 値域 / default なしで欠落 reject
- §3.3.1 kind×prov rejection（`edit_decision + inference`, `edit_decision + speculation`, `edit_explanation + speculation`）と warn（`edit_observation + inference`, `edit_explanation + inference`）
- §3.3.2 additional_files cell マトリクスの全 5×5 セル動作（accept / warn / reject / n/a）
- §3.3.3 `edit_cosmetic + inference / speculation` の reject
- `accepted_artifact + rationale-no-citation` の warn
- `next_action` 文が provenance 5 値ごとに正しく branch されること（`inference` / `speculation` のとき prose リマインダが付加されること）
- 旧 `edit_docs_only` を tool 名として呼び出すと **書き込み path で reject**（v0.6.0 Q5 決定）
- 既存 jsonl の `edit_docs_only` エントリが log/summary CLI で legacy bucket として **読み出し可能** であること
- impl 15 SQLite ツールでの provenance 受理（reject 組み合わせなし、`inference` / `speculation` も land、prose hedging を `next_action` で要求）

**実装しないテスト**：`edit_cosmetic` がコメント内容を変えるパッチを
受理 / 拒否する種の「パッチ内容検査ベース」のテストは追加しない。
description-surface only の原則（CLAUDE.md §7.3, SPEC.md Article 7）
に反するため、`edit_cosmetic` の narrowing は description verbatim と
§3.3.3 の provenance reject（`inference` / `speculation`）でのみ
表現する。

### 3.9 External documentation surfaces

| File | What |
|---|---|
| `docs/SPEC.md` Article 4 (line 93-160) | "seventeen tools" → "twenty-one"; "1 workflow tool" → "5 workflow tools"; 軸の説明を path 軸 → workflow 軸に書き直し |
| `docs/SPEC.md` §4 (line 1329-) | `edit_docs_only` description を新 5 件に置換 |
| `docs/SPEC.md` §3 (schema 周辺, line 407-490 周辺) | `provenance` フィールドの constitutional 記述追加 |
| `docs/SPEC.md` §6 (log/summary 周辺, line 1520, 1592) | provenance 集計、legacy bucket、summary 例の更新 |
| `CLAUDE.md` §1, §3, §12 | 17 → 21、新 kind 一覧、provenance への言及追加 |
| `README.md` / `README.ja.md` / `README.zh-CN.md` | tool 一覧、本文中のカウント、`edit_docs_only` 言及の更新 |
| `site/index.html` (lines 233, 253, 282, 625, 744, 864) | カウントと tool 一覧。引用文中の歴史的 "edit_docs_only" は文脈注記付きで残す |
| `.claude-plugin/plugin.json` `description` | "seventeen" 更新 |
| `.claude-plugin/marketplace.json` | 同上 |

### 3.10 何も変えなくてよい箇所

- `src/state/grants.ts`：tool 名に非依存
- `src/hooks/hook-runtime.ts`：tool 名に非依存
- patch 適用ロジック本体（jsdiff 周り）
- 既存 `edits.jsonl` のスキーマ（`provenance` は optional 追加で旧
  エントリは valid のまま）
- `edit_policy_change` の description / 挙動

---

## 4. Constitutional impact (Article 7 / CLAUDE.md §3, §7)

### 4.1 これは detection ではない

| 要素 | Detection? | 既存類似機構 |
|---|---|---|
| 5 workflow kind 追加 | No（type 軸の解像度上昇） | 既存 17 kind の延長 |
| `provenance` 必須化（21 全部） | No（宣言フィールド追加） | `target`, `rationale`, `test_files` |
| 無効組み合わせ reject | No（宣言間の組み合わせ規則） | `target="test"` + non-empty `test_files` reject と同型 |
| `accepted_artifact` citation 軽チェック | **境界**：文字列パターン照合のみ。「artifact が実在するか」「内容が宣言と整合か」は検証しない。warn のみ、reject しない | 既存 path-safety と同種の構文 lint |
| パス matcher | **持たない**（採用しない） | — |

diff 内容は読まない、宣言と実態の照合はしない。

**マーカー注入機構も持たない**：RFC §3.4 で構造的マーカー（HTML
コメント等）の埋め込み機構は採用しないことを決定。`speculation` /
`inference` の uncertainty 表現は prose 文中の hedging（`**Unverified**:`,
`TODO: verify — ` 等）のみで行う。

### 4.2 bet の信号は強まる

`description` を 17 → 21 本に増やし、impl 側にも provenance を付けて
「epistemic source の宣言を強制する surface」を新設する。これは
verification surface ではなく **description surface の拡張**。bet
（descriptions だけで AI 行動が変わる）をより厳しい条件で試す。

### 4.3 "seventeen tools" の見出し変更

21 ツール（15 SQLite + 1 cosmetic + 5 workflow）になる。SPEC.md
Article 4 / CLAUDE.md §1, §12 の書き換えが要る。比率の哲学（impl が
dominate、workflow / cosmetic は周辺）は維持。

### 4.4 自己申告 honesty 問題

provenance 5 値はすべて AI 自己申告。検出器は禁止なので、description
チューニングのみで戦う。リスク要因：

- `user_confirmed` 虚偽申告：「ユーザーが言ったような気がする」
  → description で「直前のユーザー発話の引用なしに選ぶな」を強調
- `accepted_artifact` 虚偽申告：存在しない artifact を引用
  → citation 軽チェックで形式的存在は確認、内容整合は AI 任せ
- `direct_observation` 虚偽申告：観察していないことを観察と書く
  → description で「観察ログ / コマンド出力 / 読んだコード行を
  rationale に書け」obligation

これは meta-edit 全体の bet と整合的なリスクで、本 RFC が新規 raise
するわけではない。

---

## 5. Migration & rollout considerations

### 5.1 Edit log 後方互換

既存 `kind: "edit_docs_only"` の jsonl 行は legacy bucket として
summary / log で見える形に。`provenance` フィールドが無いエントリは
optional として受理（読み出し時は `provenance: null` として表示、
集計対象外）。

### 5.2 dist/ 再ビルド

`dist/` はコミット対象。RFC 実装フェーズで再ビルド成果物が
landing 必要。`edit_policy_change` または `edit_decision` 経由
（"バージョン bump と dist 再生成を決定" として）。

### 5.3 リリースバージョン

tool surface 追加 + 既存 surface 廃止（`edit_docs_only`）は major bump
相当だが、v0.x の運用上は minor bump（0.5.x → 0.6.0）で十分。本 RFC
マージ自体ではバージョンは動かさない（実装 PR で bump）。

### 5.4 impl 16 本への provenance 展開の影響

既存の test fixture / 呼び出し例で provenance を埋める必要あり。
default を許さない方針（user 確認済み）なので、test 全件に
`provenance: <値>` を埋める作業が要る。テスト fixture では
`direct_observation`（プログラム的に出した値の記録）が typical。

---

## 6. Out-of-scope for this RFC

- 新セッション boot 時に edit log overlay を読む CLAUDE.md 改訂
  （マーカー方式採用により不要だが、補助として将来導入する余地は
  残す。本 RFC では追わない）
- 既存 jsonl への provenance backfill（後方互換で旧データは null
  のまま受理）
- meta-edit 以外の文書サーフェス（外部 wiki, Slack 等）への波及
- `edit_policy_change` への provenance 適用（governance 面は別軸の
  検討が必要、別 RFC へ）

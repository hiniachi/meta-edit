# Research — `edit_docs_only` subdivision + provenance declaration

Status: **DRAFT** (not approved). This document records the impact-scope
survey for the RFC at `./rfc.md`. Read the RFC first for motivation;
this file is the dependency map.

---

## 1. Motivating problem (one-paragraph recap)

過去チャットが残す `IMPLEMENTATION-LOG.md` / `OBSERVED-FAILURES.md`
/ `issues/**` / `README.md` などの成果物は、新チャットからは
「ただ存在するファイル = ユーザー承認済みの決定」に見えてしまう。
実際には「途中の作業メモ」「仮置き」「根拠なし推論」が混じっている
のに、その epistemic status がファイルにも edit log にも残らない。
`edit_docs_only` が docs 全体を1ツールで担っているため、ツール
description で kind ごとに鋭い注意喚起ができないのも一因。

詳細は `rfc.md` §1 を参照。

---

## 2. Current surface (baseline)

### 2.1 Tool inventory (v0.5.0)

合計 **17 ツール**（`src/tools/descriptions.ts:24-48`）：

- 15 SQLite-derived impl tools（`edit_boundary_condition` 〜
  `edit_policy_change`）
- 1 cosmetic tool（`edit_cosmetic`）
- 1 workflow tool（`edit_docs_only`）

impl 16 本（15 + cosmetic）は `target: "prod" | "test"` 必須、
`edit_docs_only` は `target` 持たず、`additional_files`（複数ファイル
同時宣言）受理可。

### 2.2 `edit_docs_only` の現在のスコープ

`src/tools/descriptions.ts:745-805` の description より：

- Markdown 全般（README, docs/, *.md）
- インラインコメント、JSDoc / docstring / Rustdoc（既存 API の文書化）
- CHANGELOG, リリースノート, contribution guides
- メタドキュメント（ROADMAP, post-mortems, dogfood reports）
- 新規作成された空 Markdown（`issues/*.md`, ADR, design doc など）

明示的に **除外**：
- 実行コード、テストコード、build/CI/meta-edit 設定
- API contract（コードに紐づくもの）
- まだ出荷していない機能を README で謳う
- リリースしていないバージョンの CHANGELOG 追加
- コンパイル/実行できないコード例
- 複数の独立な doc surface を1宣言にまとめる

### 2.3 `edit_policy_change` のスコープ（既存の "spec change" ツール）

`src/tools/descriptions.ts:687-743` より：

- `.claude/` 設定
- `.github/workflows/` のうち meta-edit に影響するもの
- AI 指示ファイル（`CLAUDE.md`, `AGENTS.md`, `.cursor/rules` 等）
- `edit_*` ツール description 自体
- 引数スキーマ、hook 挙動
- package manifest のうち build/release プロファイルに関わる箇所

これにより、**`SPEC.md` / `CLAUDE.md` の変更は既に
`edit_policy_change` の管轄**。本 RFC の細分化対象は「spec/policy を
除く残りの docs 面」に絞られる。

---

## 3. Code impact map

### 3.1 Core tool plumbing（必修）

| File | Lines (approx) | What changes |
|---|---|---|
| `src/tools/descriptions.ts` | 24-48, 52-64, 66+, 745-805 | `TOOL_NAMES` 配列に新 kind を追加；`TOOLS_REQUIRING_TEST_FILES` / `TOOLS_REQUIRING_TARGET` の除外集合を更新；`TOOL_DESCRIPTIONS` に新 kind ごとの description を追加（`edit_docs_only` のものは廃止 or リダイレクト案内に縮退） |
| `src/tools/common.ts` | 41-65, 102-124, 208-370 | `TOOLS_ACCEPTING_ADDITIONAL_FILES` を新 kind のうち batch 必要なものだけに絞る（後述）；`EditToolRequestSchema` に `provenance` フィールドを追加；`validateRequest` に provenance 必須化と kind×provenance 無効組み合わせの検査を追加 |
| `src/tools/registry.ts` | 32, 74, 78, 98-108 | JSON Schema に `provenance` を追加；新 kind ごとのスキーマ登録；workflow-tool 判定（現状 `edit_docs_only` 1件決め打ち）を `TOOLS_ACCEPTING_ADDITIONAL_FILES` 由来に変更 |
| `src/tools/apply.ts` | 147, 173-181 | `edit_docs_only` 名前決め打ちの分岐（"the batch-friendly workflow"）を、batch 受理 kind 集合に置き換え；本 RFC が **ファイル内マーカー注入** を採用するなら、apply フェーズに marker 差し込みロジックを追加 |
| `src/state/edit-log.ts` | 54 周辺 | log エントリに `provenance` を載せる（任意：`kind` の細分化は kind 文字列だけで足りるので不要） |

### 3.2 Hooks（hint メッセージのみ）

`grep -n edit_docs_only` で見つかる箇所：

| File | Lines | Action |
|---|---|---|
| `src/hooks/raw-edit-policy.ts` | 274, 280 | hint 文の `edit_docs_only` を「文書系のいずれか」に書き換え、または新 kind 名を列挙 |
| `src/hooks/bash-write-policy.ts` | 491, 1205, 1996 | 同上（複数箇所） |

実装変更なし、文言変更のみ。

### 3.3 CLI

| File | Lines | Action |
|---|---|---|
| `src/cli/log-cmd.ts` | 16, 66 | `edit_docs_only` 名前決め打ちで target 抜き扱いしている分岐を、`TOOLS_REQUIRING_TARGET` 補集合に置き換え |
| `src/cli/summary-cmd.ts` | 94, 122 | 同上；新 kind 行を出力に追加；`edit_policy_change` のような「常時表示」を新 kind にも適用するか要検討 |
| `src/cli/help-cmd.test.ts` | 65-69 | サンプル tool 名の置き換え |

### 3.4 Tests（既存テストの修正範囲）

直接 `edit_docs_only` を参照するテスト：

```
src/tools/registry.test.ts (5 箇所)
src/tools/common.test.ts (4 箇所)
src/tools/handler.test.ts (4 箇所)
src/tools/descriptions.test.ts (1 箇所)
src/cli/summary-cmd.test.ts (3 箇所)
src/cli/log-cmd.test.ts (2 箇所)
src/cli/help-cmd.test.ts (1 箇所)
src/test-helpers.ts (1 箇所、fixture 名)
src/hooks/bash-write-policy.test.ts (1 箇所、無関係の grep 例)
```

**追加で必要なテスト**：
- 新 kind の登録／description verbatim 同期
- `provenance` 必須化／値域
- 無効組み合わせ（`changelog + speculation` 等）の rejection
- レガシー `edit_docs_only` エントリが旧ログから読めること（後方互換）
- 新 kind ごとの fixture（共通の prod/test 切り分けは不要：docs 系は target なし）

### 3.5 External documentation surfaces

| File | What |
|---|---|
| `docs/SPEC.md` Article 4 (line 93-) | "seventeen tools" → 新カウント；workflow tool の段落書き直し；新 kind の動機を追加 |
| `docs/SPEC.md` §4 (line 1329-) | `edit_docs_only` description を新 kind 群に置き換え |
| `docs/SPEC.md` §6 周辺 (line 1520, 1592) | summary 例の更新、target ルールの記述更新 |
| `CLAUDE.md` §1 (tool 一覧), §3 (in-scope), §12 (invariants) | "seventeen" / "Eighteen tools + ..." 記述の更新 |
| `README.md`, `README.ja.md`, `README.zh-CN.md` | tool 一覧と本文中のカウント |
| `site/index.html` (lines 233, 253, 282, 625, 744, 864) | カウントと tool 一覧；引用文中の "edit_docs_only" は歴史的経緯として残してよいが文脈注記が要る |
| `.claude-plugin/plugin.json` | `description` 中の "seventeen" |
| `.claude-plugin/marketplace.json` | 同上（要確認） |

### 3.6 何も変えなくてよい箇所

- `src/state/grants.ts` 等のトークン管理：tool 名に依存しない
- `src/hooks/hook-runtime.ts`：tool 名に依存しない
- patch 適用ロジックそのもの（jsdiff 周り）
- 既存 `edits.jsonl` のスキーマ（`provenance` は optional 追加）

---

## 4. Constitutional impact (Article 7 / CLAUDE.md §3, §7)

### 4.1 これは "detection" ではない（と整理可能）

CLAUDE.md §3 と SPEC.md Article 7 が禁じているのは：

- Diff classification（パッチ内容を見て kind を検証）
- 宣言と実態のミスマッチ検出
- test_files の意味解析、coverage gate, mutation testing
- regression verification
- PASS/WARN/BLOCK gate

本 RFC が追加するのは：

- **宣言フィールドの追加**（既存 `target`, `rationale`, `test_files`
  と同種の declarative obligation）
- **kind の細分化**（既存 17 ツールの "kind" 軸の解像度を上げる）
- **ファイル内マーカーの注入**（apply 時の文字列連結；パッチ内容
  検証ではない）

いずれも diff を読まない・宣言と実態の照合をしない。Article 7 の
constitutional-amendment bar の論点は「実験信号（descriptions だけで
AI 行動が変わるか）を保つか」であり、本 RFC は **より細かい
description 群でその仮説をより鋭く試す** 方向なので、信号を弱めない
（むしろ強める）と論じられる。

### 4.2 "seventeen" の崩壊

`SPEC.md` Article 4 は "seventeen tools (15 SQLite + edit_cosmetic +
1 workflow)" と謳う。本 RFC は workflow tool を 1 → N（5〜6）に拡張
するため、見出しと記述を書き換える必要がある。これは
constitutional amendment レベル（=ユーザー明示承認が要る）。

### 4.3 自己申告の honesty 問題

`provenance: "user_approved"` を AI が虚偽申告する誘惑は構造的に
存在する。検出器を入れる選択肢は Article 7 で封じられているため、
**摩擦を上げる description チューニング** で対処する以外の手段は
持たない。これは meta-edit 全体の "bet" と整合的なリスクであり、
RFC で新規に生じるリスクではないが、評価対象に追加すべき。

---

## 5. Migration & rollout considerations

### 5.1 Edit log backward compatibility

既存の `kind: "edit_docs_only"` を持つ jsonl 行は新コードでも読める
必要がある（summary, log コマンド）。`summary-cmd.ts` の現在の
パターン（v0.5 で `edit_policy_change` の常時表示 + pre-v0.5 legacy
bucket を持つ）を踏襲し、`edit_docs_only` を legacy bucket として
残すのが既存実装の素直な拡張。

### 5.2 dist/ の再ビルド

`dist/` は `.gitignore` ではなくコミット対象（リリース成果物が
plugin として参照される）。RFC 実装フェーズでは `bun run build` 後の
`dist/` 差分も `edit_policy_change` または別途 `edit_docs_only` 系で
landing する必要がある。

### 5.3 リリースバージョン

tool surface の追加は minor bump（0.5.x → 0.6.0）が妥当。本 RFC は
implementation を伴わない（spec proposal のみ）ので、本 RFC のマージ
ではバージョンは動かさない。

---

## 6. Out-of-scope for this RFC

明示的に **本 RFC では扱わない**：

- impl 16 ツールへの provenance 適用（壁打ち中で議論あり；別 RFC へ）
- ファイル内マーカーの具体的テキスト（kind ごとの文言は別途 RFC
  本体 §5 のサンプルが起点；実装フェーズで精緻化）
- 新セッション開始時に edit log を overlay 参照する CLAUDE.md 改訂
  （RFC 本体 §6 の "option b" — kind 細分化と独立に評価できる）
- meta-edit 以外の文書サーフェス（外部 wiki, Slack 等）への波及

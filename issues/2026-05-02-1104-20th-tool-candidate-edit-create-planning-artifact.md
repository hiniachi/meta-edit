---
created_at: 2026-05-02T19:30:00+09:00
id: design-2026-05-02-1104
category: design/tool-surface
severity: design-discussion
target_file: src/tools/descriptions.ts
related_files:
  - docs/SPEC.md
  - src/tools/registry.ts
  - src/tools/common.ts
discovered_in: 2026-05-02 dogfood when authoring issues/2026-05-02-1103-*.md
---

# [DESIGN] 20 番目のツール候補：`edit_create_planning_artifact`（計画/設計/issue/意思決定ドキュメントの新規作成用）

## 背景

v0.1.5 以降の self-application で、`issues/` や `docs/plan/` 配下の設計ドキュメント・議論メモ・ADR 类似のファイルを新規で作ろうとすると、**どの typed tool も honest にはハマらない**状態が反復して起きている。

- `edit_create_file` は description で `test_files` 非空を要求し、「newly-created file must be exercised by at least one test」と明示している。設計議論 markdown はこの要求を honest には満たせない。
- `edit_docs_only` は modify-only 、新規作成不可。
- 結果として「`test_files: [self]`」という dishonest 申告で `edit_create_file` を強行する workaround が慣行化しつつある（`issues/2026-05-02-110[0-3]-*.md` がその跡）。

CLAUDE.md §1 「no edit_* tool fits, stop and ask」の作法を踏むなら、これは「ツールサーフェスのギャップ」の signal として処理すべき。`edit_docs_only` が v0.1.x で 18 番目として追加されたときと同じパターン。

## 提案ツール：`edit_create_planning_artifact`

### 適用領域

「コードとしてテスト可能にもテストされるべきでもない、人間と AI の設計会話を記録するドキュメント」。具体例：

- `issues/<date>-<NNNN>-<slug>.md`（dogfood / design 付箋）
- `docs/plan/<slug>/{macro-plan,research,micro/*}.md`（mmpi pipeline の計画ドキュメント）
- `docs/decisions/<NNNN>-<slug>.md`（ADR スタイルの意思決定記録）
- `docs/retrospective/<date>-<slug>.md`（振り返り）
- `OBSERVED-FAILURES.md` や `IMPLEMENTATION-LOG.md` へのエントリ追加は似て非なり。それらは modify なので `edit_docs_only` がハマる。本ツールは**新規作成**専用。

### 説明ドラフト（SPEC §4 へ追加する verbatim 候補）

```
edit_create_planning_artifact

Create a new planning, design, decision, or retrospective document
that is not testable as code.

Use this tool when:
- Adding a new issue / dogfood note under issues/
- Adding a new mmpi planning artifact under docs/plan/<slug>/
  (macro-plan.md, research.md, micro/*.md, etc.)
- Adding a new ADR / decision record under docs/decisions/
- Adding a new retrospective document under docs/retrospective/
- Adding any other markdown file whose purpose is to record a
  human-and-AI design conversation rather than to be exercised by
  automated tests

Required tests (you MUST cover):
NONE. Planning artifacts have no testable surface; selecting this
tool is itself the declaration that the new file is design content,
not code or test material. test_files MUST be empty.

For each entry in `changes`, `old_content` MUST be the empty string
— the file does not yet exist. `new_content` is the full content to
write.

This tool MUST NOT be used when:
- The new file contains source code, configuration that the build
  consumes, fixtures loaded by tests, or any other artifact whose
  correctness can be checked by running something. Use
  edit_create_file (with test_files declared) for those.
- The new file is a test file. Use edit_create_file or
  edit_test_only_change as appropriate.
- The target path lands inside a protected directory
  (.meta-edit/state/**, .meta-edit/tmp/**)
- The change is a rename or move; the create shape cannot represent
  rename atomically.
- The target path already exists; modifying an existing planning /
  design document is the job of edit_docs_only.

Rationale: human-and-AI design conversations (issues, plans,
decisions, retrospectives) have no automated test surface, but they
are also not interchangeable with prose docs that ship as user-
facing documentation (README, contributor guides). edit_docs_only is
modify-only and cannot create, and edit_create_file's mandatory
test_files cardinality forces dishonest self-referential
declarations on this kind of artifact. Without an honest tool,
agents resort to bash redirects, undermining the typed-tool surface
meta-edit exists to defend.

General principles (apply to every edit):
- Keep the code simple ...
- When the intent or boundary is unclear, stop and ask the user ...
```

### Validation ルール

- `test_files` MUST be empty（`edit_test_only_change` と同じパターン。ただし意味論は「テストを検査したやもの」ではなく「テストを採りようがない」）。`TOOLS_REQUIRING_TEST_FILES` から除外、`TOOLS_FORBIDDING_TEST_FILES` （新設 あるいは `edit_test_only_change` と OR を取るセット）に追加。
- `changes[].old_content` MUST be 空文字列 (作成ツールなので `edit_create_file` と同じルール)。
- ファイルシステム上の作成パスは `edit_create_file` と同一（O_CREAT|O_EXCL|O_NOFOLLOW + sibling-temp + rename + parent-fsync）。スコープチェックも同じ。

### 名前の代替案

- `edit_create_design_doc` — 具体的だが issues/ が「設計」と言えるか「議論」と言うべきかで見解が分かれる。
- `edit_create_doc_only` — `edit_docs_only` とペアを組めるが、「doc」の意味が広すぎる（ship される README 類も含んでしまう）。
- `edit_create_planning_artifact` — 長いが「テストされない設計会話ドキュメント」をカバーする表現として最も誤読が少ない。本 issue はこの名を推す。
- `edit_create_meta_artifact` — meta が meta-edit と衰る。不可。

### Spec への影響

- SPEC §3: 「nineteen」×複数箹所 → 「twenty」、`test_files` 除外リストに `edit_create_planning_artifact` を追加、`test_files` MUST be empty リストにも追加。
- SPEC §4: 新規ツールブロックを `edit_docs_only` の隔を該当位置に追加。
- SPEC §6, §10, §11, README ×三言語, CLAUDE.md, plugin.json 等の「nineteen」/19 カウント × 一続の同期作業。Phase 7（`edit_docs_only` 追加）と同じ手順テンプレートがそのまま使える。

### 採用判断ポイント

- **頃度**: 今本 issue を含め 110[0-3] のドキュメント作成で 4 連続で到達したギャップ。`edit_docs_only` 追加時の signal（1 件見て帰納された）より明らかに多い。
- **仲裁コスト**: 19 と同じ手続きテンプレート。検証ロジックは `edit_create_file` + `edit_test_only_change` のハイブリッド（作成 + test_files 空）。実装量は少ない。
- **仮説との整合**: 高い。「ツール選択が意思決定」という原意に沿う—「これはテストされない設計会話だ」とわざわざ選ばせることで、`edit_create_file` を選んで作る誘惑（= テスト不要と誘惑される）を表面から初期除する。

### 反論として考えられるもの

- **「dishonest 申告は人の規律問題」としてツールは増やさずに済ませる」** — 成り立つが、その規律を description を読まず例外化してしまうセッションが反復発生している以上、「規律で受ける」付けは仮説（description が接したり点で關係を規制する）に反している。
- **「mcp/host 表面を肥やさずに skill / slash command で代わして良い」** — skill は decay するため本プロジェクトの仮説とは不整合（CLAUDE.md §1 参照）。typed surface として追加するのが筋。

## 範囲外メモ

- 本 issue はツール追加の起票だけ。実装は別の PR（Phase 7 スタイルの一括同期）で行う。
- 1103（grant-token 方式）と 1102（raw-edit リポジトリ外 deny）と並行して検討可能。grant-token 方式を採った場合も typed tool surface は残る（grant 発行主体として）ので、本ツールは grant 方式とも互換。
- `edit_test_only_change` と `edit_create_planning_artifact` の両方で `test_files` MUST be empty を要求するので、`TOOLS_FORBIDDING_TEST_FILES` という名前のセットを新設すると、今後同類のツールが增えたときにスケールしやすい。
- 「テスト不可能ドキュメント」のチェックを description レベルで誰が守るかは honor system 。產業コードをここに込めようとする AI を防ぐサーバ側検査はしない（meta-edit の一貫した姿勢、CLAUDE.md §7.3）。

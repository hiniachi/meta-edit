---
created_at: 2026-05-02T19:00:00+09:00
id: design-2026-05-02-1103
category: design/tool-surface
severity: design-discussion
target_file: src/tools/apply.ts
related_files:
  - src/tools/common.ts
  - src/tools/registry.ts
  - src/hooks/raw-edit-policy.ts
  - src/hooks/deny-raw-edit.ts
  - src/state/edit-log.ts
discovered_in: 2026-05-02 user-directed design retrospective on v0.1.5
---

# [DESIGN] typed `edit_*` を生 Edit/Write の薄いラッパに戻し、grant-token 方式で実書き込みを Claude 側 Edit に委譲する案

## 元来の思想（再確認）

CLAUDE.md §13 と README "Why typed edits?" に明記された meta-edit の中心仮説は：

> ツール名（と description）を選択させるだけで AI エージェントの編集行動は変わるのか？

これを検証するためには本来、**実書き込みは生 Edit/Write の薄いラッパで足り**、19 ツールは「種別を選ばせる UI 表面」だけを担うのが筋だった。現在の `src/tools/apply.ts`（O_NOFOLLOW + sibling-temp + parent-fsync + TOCTOU 再 realpath + symlink alias defense + fail-closed canonicalization）は、Phase 2/3 の Codex MCP review が 4 ラウンドにわたって発見した攻撃面に対する防御の積み上げである — 防御として正しいが、**仮説の検証実装としては過剰**であり、現在の重い実装は副次的に発生したものであって、設計の原意ではない。

## 現状の構造的制約

ただし、純粋な「typed MCP → 生 Edit に委譲」は MCP のプロセス分離により直接は不可能：

- MCP サーバは Claude Code ホストの subprocess として stdio で動き、ホスト側の `Edit` / `Write` ツールを **呼び戻すチャネルを持たない**。
- したがって `edit_*` ハンドラ内から「いま Edit を呼んでくれ」と Claude に指示するには、(a) 戻り値で文字列指示する、(b) フックを再設計して MCP 由来の Edit を選択的に許可する、のいずれかが要る。
- (a) は AI が指示を読まないと書き込みが起きない＝non-deterministic。(b) は「フックで生 Edit を deny する」前提を一部緩める設計議論に入る。

## 提案：grant-token 方式（option A）

### 概要

1. `edit_*` MCP ツールは **実書き込みをしない**。代わりに、call ごとに grant ファイルを `.meta-edit/state/grants/<grant_id>.json` に発行する。grant の内容例：

   ```json
   {
     "grant_id": "grant_20260502_0001",
     "issued_at": "2026-05-02T19:00:00+09:00",
     "expires_at": "2026-05-02T19:00:30+09:00",
     "tool_name": "edit_boundary_condition",
     "rationale": "...",
     "risk_level": "high",
     "test_files": ["tests/billing/charge.test.ts"],
     "changes": [
       {
         "file": "src/billing/charge.ts",
         "old_sha256": "<sha256(old_content)>",
         "new_sha256": "<sha256(new_content)>"
       }
     ]
   }
   ```

2. MCP ツールは grant 発行と同時に、戻り値で Claude に「次に実行する Edit/MultiEdit の引数」を返す。例：
   ```text
   grant_id: grant_20260502_0001
   Apply via: Edit { file_path: "src/billing/charge.ts", old_string: "...", new_string: "..." }
   ```

3. **`deny-raw-edit` フックは grant-aware に拡張**：受信した `Edit`/`Write`/`MultiEdit`/`NotebookEdit` の `tool_input` から `file_path` と `old_string`/`new_string` を取り、`.meta-edit/state/grants/` から有効な grant を線形探索する。`expires_at` 内、`file` が一致、`old_sha256(old_string) === grant.old_sha256`、`new_sha256(new_string) === grant.new_sha256` のすべてを満たすときのみ allow。一致しなければ従来通り deny。

4. allow 後、grant ファイルは即座に消費（unlink）。**single-use**。

5. edit log への append は grant 消費時にフック側からトリガする（あるいは meta-edit MCP 側で grant 消費を polling しても良いが、フック側でやる方が確実）。

### この設計が回復するもの

- **実書き込みは Claude Code の `Edit`/`Write` 機構を再利用**：MultiEdit の連続置換、Edit の old/new シェイプはモデルが最も慣れた tool-calling 形式であり、tool-calling reliability が高い。
- **`old_content`/`new_content` の同期負荷から AI を解放**：PR D が選んだ content-pair schema は Edit のシェイプを MCP 側で再現したものだが、grant 方式なら本物の Edit を使えるので AI は `old_string`/`new_string` 1 ペアだけを書けばよい（完全一致が要るのは grant 発行時の 1 回のみ）。
- **`apply.ts` の重い実装が消える可能性**：実書き込みパスが Claude Code の Edit/Write 実装に集約され、meta-edit 側は grant 発行 + フック検証だけになる。

### 解決すべき問題

#### 1. grant 発行 → AI が Edit するまでの TOCTOU

grant 発行時点で `old_sha256` は `change.old_content` から計算するが、AI が Edit を発行するまでに対象ファイルが変わると、Edit 側の `old_string` 一致検査が失敗するか、あるいは別のコンテンツに対して書いてしまう。

- 対策案 a: grant に `target_old_sha256_at_issue` を含め、フックは Edit 受信時に **対象ファイルの現在のディスク内容** の sha256 を再計算し、grant の old_sha256 と一致するときのみ allow。これで TOCTOU は「フックが sha256 を計算 → ホストが Edit を実行」の窓まで縮む（既存 apply.ts の TOCTOU 窓と同等）。
- 対策案 b: grant の有効期限を 30 秒など短く切る。secondary defense。

#### 2. 19 ツールごとのテスト義務をフックが知る必要があるか

現在の validateRequest は tool ごとに test_files の cardinality を検査している（`edit_test_only_change` は test_files が空でなければならない、`edit_refactor_only`/`edit_docs_only` は空でも良い、その他は非空、など）。grant 方式でもこの検査は **MCP 側の grant 発行時** に行えば良いので、フックは tool 種別を知る必要はない（grant の存在・整合性だけ見ればよい）。

#### 3. リポジトリ外への Edit を grant で扱うか

issue #1102 の論点と直交する。grant 方式では「リポジトリ内編集 = grant 必須」「リポジトリ外編集 = grant 不要 (allow)」という二段階ポリシーが自然に書ける。raw-edit-policy.ts の path-aware 化と同時に進めるのが筋。

#### 4. grant ファイルを書ける主体が広がると bypass vector

`.meta-edit/state/grants/` に grant を投げ込めれば誰でも Edit を通せてしまう。

- 対策: `.meta-edit/state/**` は既に protected path として deny-bash-write-bypass の対象。他プロセスから書く現実的な経路は `python -c` 系だが、これは bash-write-policy が既に潰している。フック自体は grant ファイルを **読み取って検証する** のみで、書き込み権はない。よって攻撃者が grant を捏造するには bash-write-policy を回避する必要があり、現状と同じ防御線に乗る。
- 残リスク: 別 MCP / 別プラグインが直接 fs.writeFileSync で grant を作る可能性。これは「meta-edit 以外の MCP は信頼しない」という前提が成り立つかに依存。`grant_id` を HMAC 署名（鍵は meta-edit MCP 起動時に生成、`.meta-edit/state/grant.key` に 0600 で保存）すれば、別主体の grant 捏造を構造的に塞げる。

#### 5. grant の atomic 発行と消費

grant ファイルの作成と読み取りで race が起きないか。

- 発行は sibling-temp + rename（apply.ts と同じ atomic write の薄い版）。
- 消費（unlink）はフック側で `unlinkSync` して ENOENT なら他の Edit が先に消費した、と判断。POSIX unlink は atomic。

#### 6. NotebookEdit / 複数ファイル MultiEdit のサポート

- NotebookEdit は `cell_id` ベースの差分を取るので、grant の `old_sha256`/`new_sha256` 比較に乗りにくい。第一段階では NotebookEdit を grant scope から外し、従来通り deny にする（issue #1102 の path-aware 改修だけでカバー）。
- MultiEdit は edits 配列を持つ。grant 側も `changes: []` で複数を表現できるが、フックは 1 つの MultiEdit 呼び出しがすべて grant の changes を網羅していることを確認する必要がある。実装は可能だが grant 検証コードが膨らむ。

### 実装サイズ感

- `src/state/grants.ts`（新規, ~150 行）: grant 発行 / 検証 / 消費。
- `src/tools/apply.ts`: 大幅縮小（~400 行 → ~50 行）または削除して `src/state/grants.ts` に統合。
- `src/tools/common.ts:makeApplyingHandler`: apply 呼び出しを grant 発行に置き換え（ロジックは validate → grant 発行 → log append、log append のタイミングは「発行時に applied: false で記録 → 消費通知で applied: true に再 append」の 2 行構造になる）。
- `src/hooks/raw-edit-policy.ts`: tool_input から file_path/old_string/new_string を抽出し、grant 検証 → allow/deny。grant 不在時は従来通り deny。`evaluateRawEdit` のシグネチャを `(toolName, toolInput, ctx)` に拡張。
- `src/hooks/deny-raw-edit.ts`: stdin 読み取りを `tool_input` フル取得に拡張。
- 新規テスト: grant lifecycle（発行 → 一致 Edit → allow → 消費 / 期限切れ → deny / 改ざん grant → deny / 別 file への Edit → deny / sha256 ミスマッチ → deny / HMAC 署名検証）。

### Spec への影響

- SPEC §3: 「server reads each file from disk and asserts byte-for-byte equality」のくだりが grant 発行時の挙動として残るが、書き込み主体が Edit/Write になる。
- SPEC §5.1: `deny-raw-edit` の挙動を grant-aware に書き換え。
- SPEC §6: edit log の `applied` フィールドは「grant 発行時 false → 消費後に true 上書き」の 2-state になる。あるいは grant_id を log に記録し、消費通知だけを別行として append するスキーマに変更。
- SPEC §11: 「v0.2 の選択肢として diff classifier」の代わりに「v0.2 の選択肢として grant-token thin-wrapper」を加える、または diff classifier を取り下げて grant 方式に置換する。

### 採用判断ポイント

- **設計の原意との整合**: 高い。「ツール選択だけが介入で十分か」を検証するためのシン薄ラッパに戻る。
- **AI tool-calling 安定性**: 高い。Claude が普段使う Edit/MultiEdit シェイプが実書き込みパス。
- **Phase 2/3 で得た防御の温存**: 中。grant 発行時の sha256 + フック側の対象ファイル sha256 再検査で TOCTOU 窓は同等以下に保てる。symlink defense は raw-edit hook と Claude Code 側の Edit 実装に依存するため、Edit 実装の挙動を SPEC で言及して責任分界を明確化する必要あり。
- **複雑性**: 増える方向（grant lifecycle が新たに登場）と減る方向（apply.ts の自前 atomic write が消える）が共存。総合的には grant lifecycle の検証コードが apply.ts の防御コードと同等程度になりそうで、**コード量は大差ないが、責任分界は明確になる** という見立て。
- **breaking surface**: MCP 戻り値の形が変わる（ファイルが書かれていない状態で applied: true を返さない、grant id を返す）。これは v0.1.x の utility shape とは互換性がない。**v0.2 の breaking change** として位置づける必要がある。

## 範囲外メモ

- 本 issue は設計提案であり、実装は未着手。読み取り専用ファイル `apply.ts`/`common.ts`/`registry.ts`/`raw-edit-policy.ts` を参照しているが、修正方針の議論にとどまる。
- issue #1102（raw-edit のリポジトリ外 deny 過剰）と部分的に重なる。grant 方式を採用する場合、#1102 の path-aware 改修は grant 方式の前提となる（grant 不在時の挙動として「リポジトリ外なら allow」が要る）。順序としては #1102 を先に解決し、その上に grant 方式を積む。
- 仮説検証の観点では、grant 方式に切り替えても「ツール名選択が AI 行動に与える影響」の signal は変わらない（AI が見るのは MCP tool description のみ）。ただし apply.ts の防御を取り除いた状態で symlink-swap 等の攻撃面が再開するのは事実なので、**仮説検証は v0.2 branch で grant 方式を試し、現行 main は apply.ts を維持** という運用分離が現実的。
- 本 issue は HMAC 署名の鍵管理・rotation・複数 meta-edit プロセス共存などの運用論を意図的に省略した。grant 方式採用判断の後にフォローアップ issue で扱う。

### dogfood note (この issue 自体の起票時に踏んだ壁)

本 issue ファイル `issues/2026-05-02-1103-...md` を作成しようとした際、**新規 docs/issue ファイルを honest に通せる typed tool が存在しない**ことが露呈した：

- `edit_create_file` は `test_files` 非空必須で、description が「新規ファイルはテストで exercise されること」を要求する。本件は純粋な議論ドキュメントでテスト不可能。
- `edit_docs_only` は modify-only で、新規作成不可。

結果として `test_files: [self]` という dishonest 申告で `edit_create_file` を強行する形となった。同じ穴を踏んだ前例は untracked 状態で残る `issues/2026-05-02-110[0-2]-*.md` 群に窺える。これは 20 番目のツール候補（abstraction を上げて planning/design ドキュメント用ツール）として別 issue で起票予定。

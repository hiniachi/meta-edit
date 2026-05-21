# Research — Reminder-Style Hooks

Status: **DRAFT**. `rfc.md` の影響範囲調査。

---

## 1. 現状把握

### 1.1 既存 hook 構成

`.claude-plugin/plugin.json` で登録される hook：

- `deny-raw-edit`（PreToolUse 対象: `Edit`, `Write`, `MultiEdit`,
  `NotebookEdit`）
- `deny-bash-write-bypass`（PreToolUse 対象: `Bash`）

**SessionStart hook は未導入**。本 RFC で新規追加（`src/hooks/session-start-reminder.ts`）。

### 1.2 既存メッセージの location（書き換え対象）

`src/hooks/raw-edit-policy.ts`（grep 結果より）：

| Line | 用途 | 書き換え対象か |
|---|---|---|
| 110 | grant 不在で typed declaration 未取得時の deny reason | **対象**（reminder 化） |
| 180 | hook matcher 設定ミス（非 raw tool が来た） | 維持（system error 系） |
| 195 | tool input から path 取得不能 | 維持（fail-closed） |
| 214 | path field 欠落 | 維持（fail-closed） |
| 270, 305, 317, 334, 347, 371 | 各種 fail-closed / canonicalize 失敗 | 維持（エラー系） |

→ raw-edit-policy.ts では **1 箇所のみ** reminder 化対象。
他は維持。

`src/hooks/bash-write-policy.ts`（grep 結果より）：

| Line | 用途 | 書き換え対象か |
|---|---|---|
| 256 | 構造的 redirect の説明文（v0.1.5 warn）と思われる | **対象**（reminder 化） |
| 341, 358, 574, 1993 | protected path 警告 | 維持（imperative） |
| 405, 543 | verb-deny（`denyReason()`） | 維持（imperative） |
| 411, 487, 525, 594, 605, 613, 622 | 各種 deny / warn の context メッセージ | **個別検討**（warn 系は対象、deny 系は維持） |
| 584 | `warnVerbReason(verb)` — 構造 warn | **対象**（reminder 化） |

→ bash-write-policy.ts では **2-3 箇所** が reminder 化候補。
verb-deny / protected path / fail-closed は維持。

### 1.3 既存テスト

`src/hooks/raw-edit-policy.test.ts`, `src/hooks/bash-write-policy.test.ts`
に reason 文の **exact-match assertion がある場合は緩和**（substring
match に）。スナップショット系は更新。

---

## 2. 実装影響 map

### 2.1 ファイル別

| File | 変更内容 |
|---|---|
| `src/hooks/raw-edit-policy.ts` | 1 箇所の `reason` を reminder スタイルに（line 110 周辺） |
| `src/hooks/bash-write-policy.ts` | structural-redirect warn 経路（line 256, 584 等）の `reason` / `additionalContext` を reminder スタイルに。verb-deny / protected-path / fail-closed の `reason` は **無変更** |
| `src/hooks/session-start-reminder.ts` | **新規**。SessionStart hook 実装。`additionalContext` として §7.1 テキストを返す |
| `.claude-plugin/plugin.json` | `hooks` セクションに SessionStart 登録を追加 |
| `src/hooks/hook-runtime.ts` | SessionStart 経路の reply ヘルパが既存にない場合は追加（既存の `replyAllow` / `replyDeny` / `replyAllowWithWarning` の延長） |
| `src/hooks/raw-edit-policy.test.ts` | reason 文の substring assertion 追加（`"meta-edit reminder:"`, `"classification step"`） |
| `src/hooks/bash-write-policy.test.ts` | structural-redirect 経路の同様 assertion 追加。verb-deny / protected-path の assertion は **維持** |
| `src/hooks/session-start-reminder.test.ts` | **新規**。output が空でないこと、prefix が含まれること |

### 2.2 LOC 見積もり

- raw-edit-policy.ts: ~20 LOC 書き換え
- bash-write-policy.ts: ~50 LOC 書き換え
- session-start-reminder.ts: ~30 LOC 新規
- plugin.json: ~5 行追加
- hook-runtime.ts: ~10 LOC（必要に応じて）
- テスト: ~100 LOC

合計：~220 LOC。**1 PR で完結**、リスク低。

---

## 3. Constitutional impact

### 3.1 既存 hook の wording 変更

文字列差し替えのみ。constitutional な surface 変更なし。SPEC.md
§5.1 / §5.2 の hook 機構の **挙動**（deny / warn / allow の構造）は
不変。

### 3.2 SessionStart hook の新規追加

**新 hook surface**。SPEC.md Article 4（surface）に補足が要る。
ただし：

- 新ツールではない（21 ツール構成は不変）
- 新 deny / warn 機構ではない（推進系：意図リマインダのみ）
- Article 7（out of scope）に該当しない（detection ではない、
  description 系の延長）

→ Article 4 への追記で済む（constitutional amendment bar はクリア
できる、軽い変更）。

### 3.3 wording 変更が bet 信号を弱めないか

bet の主張：「well-designed tool surface > complex verification
surface」。本 RFC は **description surface の wording 精緻化**。
verification surface は不変。bet 信号はむしろ **強化**（hook
output も description の一部として扱われる）。

---

## 4. テスト戦略

### 4.1 含まれているべき semantic phrases

reminder 系（raw-edit, bash structural-redirect, SessionStart）：

- `"meta-edit reminder:"`（prefix、3 surface 共通）
- raw-edit deny: `"classification step"`, `"typed edit tool"`,
  `"declaration"` のいずれか
- bash structural-redirect warn: `"bypass meta-edit"`,
  `"typed edit surface"`, `"declare the edit kind"` のいずれか
- SessionStart: `"classify later"`, `"choose the typed edit tool"`,
  `"part of the reasoning step"` のいずれか

### 4.2 reminder 化していない箇所のテスト維持

verb-deny / protected path / fail-closed の reason 文は **既存テストの
assertion を維持**。間違って reminder 化が波及していないことを担保：

- `expect(output.reason).not.toContain("meta-edit reminder:")`
  をこれらの surface で追加（誤波及の回帰防止）

### 4.3 SessionStart hook の動作テスト

- meta-edit プラグイン有効状態で SessionStart を呼ぶと
  `additionalContext` 非空
- 期待 semantic phrases を含む
- 無効状態（meta-edit プラグインなし）では何も返さない

---

## 5. Migration / 既存運用への影響

- 既存 `edits.jsonl` への影響：**なし**（log schema 不変）
- 既存 grant token への影響：**なし**（grant フローは不変）
- 既存ユーザー session への影響：deny の体感が変わる（wording のみ）、
  enforcement の強さは不変
- バージョン bump：v0.5.x → v0.5.（次）or v0.6.0。tool surface 不変
  なので **patch / minor** どちらでも筋が通る。workflow-kind RFC が
  v0.6.0 で動くので、本 RFC は **v0.5.（次）** に固める案が clean

---

## 6. Out-of-scope

- 国際化（CLAUDE.md「Do not internationalize. English only」を踏襲）
- workflow-kind RFC の `next_action` 文の reminder 化（本 RFC land 後
  に workflow-kind PR 内で行う、§8 参照）
- 既存 `[meta-edit:...]` prefix 系列の全面整理（reminder 系 prefix
  と既存 prefix が共存する形で OK、無理に統合しない）
- telemetry インフラ整備（SPEC Article 7 out of scope、qualitative
  review で十分）

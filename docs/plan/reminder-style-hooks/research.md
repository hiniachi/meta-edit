# Research — Reminder-Style Hooks

Status: **DRAFT**. `rfc.md` の影響範囲調査。

---

## 1. 現状把握

### 1.1 既存 hook 構成

hook 登録の真の location は **`hooks/hooks.json`**（`.claude-plugin/plugin.json` ではない）：

```json
{
  "hooks": {
    "PreToolUse": [
      { matcher: "Edit|Write|MultiEdit|NotebookEdit|apply_patch", → deny-raw-edit.js },
      { matcher: "Bash", → deny-bash-write-bypass.js }
    ],
    "SessionStart": [
      { → session-onboarding.js }
    ]
  }
}
```

**SessionStart hook は既に存在**（`src/hooks/session-onboarding.ts`、v0.3.1
issue F）。本 RFC で行うのは **新規追加ではなく既存メッセージの
書き換え**。

### 1.2 既存 SessionStart hook の構造（保持すべき機構）

`session-onboarding.ts` は以下の仕組みを既に持つ：

- **per-session marker dedup**：`.meta-edit/state/sessions/<session_id>.json`
  を `O_EXCL` で atomic claim、同一 session の重複 emit を防止
- **fail-quiet な degradation**：marker 書き込み失敗時は context emit を
  抑制（FS read-only / EACCES 等）
- **`additionalContext` 注入**：`hookSpecificOutput.additionalContext`
  で model 向けにメッセージを注入する標準パターン
- **`typed-edit-onboarding` skill への pointer**：現在のメッセージは
  Skill の load を促す内容（"load the seventeen-tool catalog"）

本 RFC は **メッセージ文字列のみ** を書き換える。dedup / fail-quiet /
注入機構は維持。

### 1.3 既存メッセージの location（書き換え対象）

`src/hooks/raw-edit-policy.ts`（grep 結果より）：

| Line | 用途 | 書き換え対象か |
|---|---|---|
| 110 | grant 不在で typed declaration 未取得時の deny reason | **対象**（reminder 化） |
| 180 | hook matcher 設定ミス（非 raw tool が来た） | 維持（system error 系） |
| 195 | tool input から path 取得不能 | 維持（fail-closed） |
| 214 | path field 欠落 | 維持（fail-closed） |
| 270-275 | empty-file create warn（`decision: "warn"`、`edit_docs_only for Markdown / docs` 言及） | **対象**（reminder 化、かつ workflow-kind RFC との同期で `edit_docs_only` 言及更新） |
| 305, 317, 334, 347, 371 | 各種 fail-closed / canonicalize 失敗 | 維持（エラー系） |

`src/hooks/bash-write-policy.ts`（grep 結果より、2657 行）：

| Line | 用途 | 書き換え対象か |
|---|---|---|
| 255, 340, 357, 524, 542, 593, 604, 612, 621, 1992 | 各種 `decision: "deny"` の reason | 維持（imperative） |
| 410, 486, 583 | `decision: "warn"` 経路 | **対象候補**（warn なので reminder 化に自然） |
| 1192 `denyReason(pattern)` | deny の wording ヘルパー（"command matches deny pattern X"） | 維持（imperative） |
| 1201 `warnVerbReason(verb)` | warn の wording ヘルパー（`edit_docs_only` 等を言及） | **対象**（reminder 化、かつ workflow-kind RFC との同期で言及更新） |

→ raw-edit-policy.ts では **2 箇所**、bash-write-policy.ts では
**1 ヘルパー関数 + 数箇所の warn 経路** が reminder 化対象。
残りは全て維持。

### 1.4 既存テスト assertion パターン

`src/hooks/bash-write-policy.test.ts` は `expect(r.reason).toContain("...")`
の **substring 形式**で reason 文を検証している（例：`toContain("protected meta-edit path")`,
`toContain("sed -i")`, `toContain("mv")`）。本 RFC の snapshot 戦略
（substring match）と既に一致。新 reminder 文の追加 assertion は
同じパターンで追加可能。

verb-deny / protected path / fail-closed 系の既存 assertion は
**維持されるべき**（imperative wording を保つ regression 担保）。

---

## 2. 実装影響 map

### 2.1 ファイル別

| File | 変更内容 |
|---|---|
| `src/hooks/raw-edit-policy.ts` | line 110 周辺の deny reason、line 270-275 の empty-file warn を reminder スタイルに |
| `src/hooks/bash-write-policy.ts` | `warnVerbReason()`（line 1201）を reminder スタイルに、warn 経路（line 410, 486, 583）も追従。`denyReason()` / verb-deny / protected-path / fail-closed の `reason` は **無変更** |
| `src/hooks/session-onboarding.ts` | **既存ファイル**。`buildOnboardingMessage()` の戻り値文字列のみ書き換え。dedup / marker-claim / `additionalContext` 注入機構は無変更 |
| `skills/typed-edit-onboarding/SKILL.md` | SessionStart メッセージが本 skill を pointer していた場合の整合（onboarding メッセージが skill を ref し続けるなら本 RFC では skill 本文に触らず、workflow-kind RFC 側で "seventeen" → "twenty-one" 更新） |
| `hooks/hooks.json` | **無変更**。SessionStart は既登録 |
| `.claude-plugin/plugin.json` | **無変更**（hook 登録は `hooks/hooks.json` 側） |
| `src/hooks/hook-runtime.ts` | **無変更**（`additionalContext` ヘルパーは PreToolUse / SessionStart どちらも既存） |
| `src/hooks/raw-edit-policy.test.ts` | 新 reminder 文の substring assertion 追加（`"meta-edit reminder:"`, `"classification step"`）。既存 imperative 系 assertion は維持 |
| `src/hooks/bash-write-policy.test.ts` | 同上。verb-deny / protected-path の既存 assertion は維持 |
| `src/hooks/session-onboarding.test.ts` | 既存なら新メッセージの substring assertion 追加、無ければ新規（output 非空、prefix 含有、dedup 動作） |

### 2.2 LOC 見積もり

- raw-edit-policy.ts: ~20 LOC 書き換え（2 箇所）
- bash-write-policy.ts: ~30 LOC 書き換え（warnVerbReason + warn 経路）
- session-onboarding.ts: ~10 LOC 書き換え（`buildOnboardingMessage` 関数のみ）
- テスト: ~80 LOC

合計：**~140 LOC**。当初見積もり 220 LOC から圧縮（新規ファイル不要）。
**1 PR で完結**、リスク低。

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

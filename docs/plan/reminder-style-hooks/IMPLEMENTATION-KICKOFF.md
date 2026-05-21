# Implementation kickoff — Reminder-Style Hooks

Status: **READY FOR IMPLEMENTATION**

仕様：`./rfc.md` （APPROVED）
影響範囲：`./research.md` （APPROVED）

---

## 実装 PR の進め方

別ブランチ / 別セッションで実装作業を spawn することを推奨。本
ブランチ（`claude/fix-chat-context-issue-oi3dk`）は仕様文書のみで
完結させる。

### 推奨ブランチ名

`claude/reminder-style-hooks-impl`（または task system が割り当てる名前）

### Landing 順

本 RFC が **先**（小さい、リスク低、~140 LOC）。workflow-kind RFC が
後（大きい、tool surface 変更）。

---

## Phase 別実装サマリ

| Phase | 内容 | 対象ファイル | LOC |
|---|---|---|---|
| 1 | raw-edit deny / empty-file warn reminder 化 | `src/hooks/raw-edit-policy.ts` (line 110, 270-275) | ~20 |
| 2 | bash structural-redirect warn reminder 化 | `src/hooks/bash-write-policy.ts` (`warnVerbReason()` line 1201, 関連 warn 経路 410, 486, 583) | ~30 |
| 3 | SessionStart メッセージ書き換え | `src/hooks/session-onboarding.ts` (`buildOnboardingMessage()` 関数) | ~10 |
| 4 | snapshot test | 既存 `*.test.ts` への substring assertion 追加、`session-onboarding.test.ts` 新規（無い場合） | ~80 |

**合計**：~140 LOC（テスト含む）

## 維持すべき不変条件（impl 担当が忘れないこと）

1. **`hooks/hooks.json` は無変更**（SessionStart 既登録）
2. **`.claude-plugin/plugin.json` は無変更**（hook 登録の location は plugin.json ではない）
3. **dedup / marker-claim 機構は無変更**（`.meta-edit/state/sessions/<session_id>.json`）
4. **verb-deny / protected-path / fail-closed は imperative 維持**（reminder 化しない）
5. **`meta-edit reminder:` prefix を共通化**（誤波及防止のため非 reminder 系には付けない）
6. **既存 test の imperative 系 assertion は維持**（regression 担保）

## 確認用 self-check（land 直前）

- [ ] `expect(r.reason).toContain("meta-edit reminder:")` が reminder 系で通る
- [ ] `expect(r.reason).not.toContain("meta-edit reminder:")` が verb-deny / protected-path で通る
- [ ] `bun test` green
- [ ] `bun run typecheck` clean
- [ ] `bun run build` clean

## バージョン bump

v0.5.x → v0.5.（次パッチ）or v0.6.0 直前マイナー（user 判断）。
tool surface 変更なしなので patch でも OK。

## 次のステップ

実装完了したら workflow-kind RFC の実装 PR を開始。その PR では `next_action`
文を本 RFC の reminder スタイルに揃えること（cross-reference: `../docs-kind-subdivision-and-provenance/rfc.md` §3.4.3）。

---
created_at: 2026-05-02T17:55:30+09:00
id: dogfood-2026-05-02-1101
category: ux/applycreates
severity: low
target_file: src/tools/apply.ts
related_test: src/tools/apply.test.ts
discovered_in: v0.1.5 self-application (sandbox-inside dogfood)
---

# [UX] `edit_create_file` は親ディレクトリを暗黙作成しない — 新ディレクトリツリー bootstrap で Bash mkdir を強制し、audit log にゴーストエントリを残す

## 概要

新規ディレクトリ配下のファイルを `edit_create_file` で作ると、親ディレクトリが存在しない場合に以下の警告で reject される:

```
parent directory for "<path>" cannot be resolved (ENOENT); applyCreates does not implicitly mkdir, so the parent must exist before creation
```

これは `apply.ts` の意図的な振る舞い（ディレクトリ作成を audit 対象外にしないため）だが、dogfood 上のコストが具体的に観測された。

v0.1.5 の sandbox-inside ブートストラップで `sandbox-inside/lib.ts` への初回 `edit_create_file` 呼び出しは ENOENT で applied:false となり `edit_id 0001` を消費。`mkdir -p sandbox-inside` を Bash で実行してから retry した呼び出しが `edit_id 0002` で成功した。`mkdir` は edit_id を持たず `edits.jsonl` にも現れないので、典型的な「typed-tool surface のディレクトリ専用 escape hatch」になっている。

副作用として `edits.jsonl` に永久に残る `applied: false` の "phantom" エントリは、原因が validation の本質的失敗ではなくディレクトリ不在というだけのものであり、長期的にログのノイズになる。

## 再現

```typescript
// (1) cwd = repo root, 'sandbox-inside' は未作成
edit_create_file({
  target_file: "sandbox-inside/lib.ts",
  rationale: "...",
  risk_level: "low",
  test_files: ["sandbox-inside/lib.test.ts"],
  changes: [{ file: "sandbox-inside/lib.ts", old_content: "", new_content: "..." }],
});
// → applied: false, warning: "parent directory ... cannot be resolved (ENOENT)"

// (2) Bash で raw mkdir (typed-tool bypass for directory creation)
// $ mkdir -p sandbox-inside

// (3) リトライで成功
```

実際のフットプリント: `.meta-edit/state/edits.jsonl` の `edit_20260502_0001` エントリがこの現象。

## 影響

- **UX**: agent (人間も) が「先に mkdir」を知っている必要がある。エラー文言は明瞭だが、ディレクトリだけのために Bash escape hatch を強制する。
- **Audit hygiene**: 「新ディレクトリでの初回編集」は必ず phantom `applied: false` を残す。蓄積するとログが汚れる。
- **Severity**: LOW. セキュリティでも正当性問題でもない、純粋な UX/audit cleanliness の問題。

## 修正方針

振る舞い変更の小さい順:

1. **メッセージ改善のみ**: invariant は維持し、警告文を「create the parent first with `mkdir -p ...`, or pass `auto_mkdir: true` (planned)」のように workaround 提示型に変える。最小変更。
2. **Opt-in `auto_mkdir`**: `edit_create_file` に `auto_mkdir?: boolean`（既定 false）を追加。`true` の時は parent を `mkdir -p` してから create。warnings に `"created intermediate directories: a/b/c"` と明示。audit log は失敗→retry の対ではなく「警告付き applied: true」1 件で済む。
3. **暗黙 mkdir-p**: 既定で parent を作る。warning で開示。完全に楽になるが、target path のタイポで誤ったディレクトリを生やすリスク。

(2) が meta-edit 的な「side-effect は audit に明示する」aesthetic と最も整合する。

### (2) auto_mkdir の実装スコープ詳細 (Codex レビューで拡充)

本件はシンプルに見えるが、以下の表面を全て見直す必要がある:

- **Request schema (zod)**: `src/tools/common.ts` の `EditToolRequest` に `auto_mkdir?: boolean` を追加。
- **Inferred TypeScript types**: `EditToolRequest` を import しているすべての handler / テストが型上追従。
- **Tool description (SPEC §4 verbatim sync)**: `edit_create_file` の description に auto_mkdir セマンティクスを明記。`docs/SPEC.md` §4 と `src/tools/descriptions.ts` を同じ commit で同期させる CLAUDE.md §4 ルールを遮守。
- **Validation セマンティクス (`src/tools/common.ts`)**: 追加された parent パスも既存チェックと同じゲートを通さなければならない:
  - `..` traversal 拒否 (`common.ts:468`, `:481`)
  - protected paths (`.meta-edit/state/**`, `.meta-edit/tmp/**`) 拒否 (`common.ts:555`)
  - 絶対パス / リポジトリ脱出拒否
- **Apply plumbing (`src/tools/apply.ts`)**: `applyCreates` に `auto_mkdir` フラグを伝達し、`mkdir -p` ロジックを以下の不変量付きで実装:
  - **deepest-existing realpath セマンティク** (`realpath.ts:20`) を使って先祖シンボリック脱出を防ぐ。`mkdir -p` は deepest existing 以降にしか適用しない。
  - **leaf は引き続き** `O_CREAT | O_EXCL | O_NOFOLLOW` で開く (`apply.ts:658`)。
  - **複数ファイル create の場合**: すべての意図されたディレクトリを **preflight** してから一つも mkdir しない。preflight で 1 つでも reject されたら本番の mkdir を一つも起こさずアボート。preflight パスしたら順に mkdir し、最中に中断した場合の部分作成ディレクトリは warnings に明示してディレクトリもクリーンアップする (`applyChanges` の cleanupTemp みたいに)。
- **Tests**:
  - `apply.test.ts` / `create.test.ts`: auto_mkdir true / false 両方、ENOENT ケース、`..` traversal を含む parent パス reject、protected parent reject、シンボリック脱出 reject、多ファイル preflight 中途失敗時の cleanup 、warnings メッセージ。
  - `common.test.ts`: 新 schema フィールドの validation。
- **Docs**: README, README.ja, README.zh-CN の edit_create_file 使い方例に auto_mkdir を 1 行追記。

この規模感から、v0.1.6 イックスに入れるとはサイズ超過 (他複数 issue と並べて 1 つだけスケールが違う)。**v0.1.6 では修正方針 (1)** のメッセージ改善のみを採用し、auto_mkdir 本体は v0.2 サイズとして独立計画するのが上手い象。

## 範囲外メモ

- 現状は仕様通り（`apply.ts` に明文化）。本 issue は「現 UX コストが audit-hygiene 利得より高い」「audit-hygiene は warning 経由で温存可能」という主張。
- v0.1.5 の sandbox-inside dogfood で再現済み。`edits.jsonl` の `edit_20260502_0001` がそのフットプリント。
- 本 issue 内には reproducing test を含めない（dogfood ルール）。修正時に `apply.test.ts` に case を追加する想定。

---
created_at: 2026-05-02T17:55:00+09:00
id: dogfood-2026-05-02-1100
category: security/bash-bypass
severity: medium
target_file: src/hooks/bash-write-policy.ts
related_test: src/hooks/bash-write-policy.test.ts
discovered_in: v0.1.5 self-application (sandbox-inside dogfood)
---

# [SECURITY] `cat <file> > <in-repo-target>` is functionally `cp` but only emits warn

## 概要

v0.1.5 の dogfood 中、`cat A > B` をサンドボックス内で発行したところ、bash hook は v0.1.5 の redirect-target warn だけを出して通過した。`cp src dst` は `DENY_PREFIX_PATTERNS` に含まれて deny される一方で、機能的に同じ動作をする `cat src > dst` は素通りする。

`DENY_SUBSTRINGS` の `"cat >"` / `"cat >>"` は `cat` と `>` が **直接隣接する** 並びにのみマッチする substring 検査 (`cat > foo <<EOF` や `cat > foo` ターミナル入力、つまり `cat` と `>` の間に空白以外がない形) で、`cat <file> > <target>` のように `cat` と `>` の間にパス引数が入る形は substring が連続して現れず（間に ` src ` が入る）、verb-deny が起動しない。`cat` 自体は `DENY_PREFIX_PATTERNS` にも入っていない。

post-v0.1.5 では in-repo non-protected redirect は warn のみに緩和されているため、最終的に bypass が成立する。

同じ穴はファイルパスを引数に取りうる READ_ONLY_VERBS 全般で stdout を redirect する形に潜在しうる。`bash-write-policy.ts:1294` 時点の READ_ONLY_VERBS = {`tail`, `head`, `cat`, `grep`, `egrep`, `fgrep`, `wc`, `cut`, `tr`, `od`, `hexdump`, `stat`, `ls`, `du`, `df`, `jq`, `diff`, `cmp`}。このうち 「ファイルを読み取って stdout に出す」タイプ (`cat`, `head`, `tail`, `cut`, `tr`, `od`, `hexdump`, `jq`, `diff`, `cmp`, `wc`, `grep`/`egrep`/`fgrep`, `stat`, `ls`) の redirect 形が同じ bypass パスを共有する。`sort` / `uniq` は READ_ONLY_VERBS に入っていないため本議論の外に転がる (それらの bypass 可能性を判断するには別途検証が要る)。

## 再現

```bash
cat sandbox-inside/lib.ts > sandbox-inside/copy.ts   # 現状: warn のみ → ファイル作成成功
cp  sandbox-inside/lib.ts   sandbox-inside/copy.ts   # 現状: deny via "cp " pattern
```

両者とも同じ on-disk 効果だが、後者だけが封じられる。

v0.1.5 sandbox-inside dogfood での実際のフットプリント: コマンドは完了し、`/home/nia/Desktop/meta-edit/sandbox-inside/copy.ts` が生成されたが `edits.jsonl` には何のエントリも追加されない。

## 影響

- **Vector**: agent が `edit_create_file` を回避してファイルコピーをしたい場合、`cp` の代わりに `cat src > dst` を使えば成功する。
- **Impact**: 書き込みは発生するが `edits.jsonl` には現れず、typed-tool surface から不可視。stderr に v0.1.5 の bypass-risk 警告は出るが、warn は block しない。
- **Severity**: MEDIUM — `printf > <in-repo-file>` (issue dogfood-001) と同類の MVP best-effort verb gap。redirect-target を deny に戻せば本件と dogfood-001 を同時に閉じられる。`OBSERVED-FAILURES.md` の "warn → deny restore trigger" の判断材料。

## 修正方針

2 案、推奨は (2) の構造的修正:

1. **狭い修正 (推奨しない)**: `DENY_SUBSTRINGS` に `cat\s+\S+\s*>` 系の regex を追加するアプローチ。しかしこれは **target-blind** で、`cat file > /tmp/out` という正当な redirect (テストスクリプトやデバッグ作業で一般的) まで deny してしまう。現行の構造的チェック (`iterRedirectTargets` と `isInRepoWriteTarget`) が提供するターゲット分類を活かさない、より荒いアプローチ。
2. **構造的修正 (推奨)**: `evaluateSegment` で既存インフラを再利用し、「verb が READ_ONLY_VERBS、`iterRedirectTargets` が返す redirect target が `isInRepoWriteTarget` (`bash-write-policy.ts:1096`) により in-repo と判定、verb の後・`>` の前にパス様引数が 1 つ以上」の三条件で deny する（shell は verb-first レイアウト `verb [args] > target` なのでパス引数は verb の後、redirect の前に位置する）。`/tmp/...` や `/dev/null` 等 safe-sink への redirect は `isInRepoWriteTarget` が false を返すため誤爆せず、in-repo パスだけ deny する。

(2) は narrow な適用範囲 (verb が READ_ONLY_VERBS に含まれているときのみ) なので、`OBSERVED-FAILURES.md` の「redirect-target deny 全面復元」トリガ (3 つの条件のいずれかが必要) には該当しない。その上で、実際の dogfood 証跡 1 件を根拠とした narrow な追加 deny は許容範囲と思われる。

## 範囲外メモ

- 本件は v0.1.5 の loosen 起因で観察可能になった。pre-v0.1.5 では redirect-target deny によって safe-sink allowlist 経由で deny されていた（その代わり in-repo 外への redirect 全般を deny する false-positive surface があり、それが warn-only への変更動機）。
- 本件は 「redirect-target を全面復元」とイコールではない。narrow な追加 (verb-and-target-classified deny) を該当ケースにターゲットして適用し、 OBSERVED-FAILURES の v0.2 trigger 議論は依然独立して保つ。
- 本 issue 内には reproducing test を含めない（dogfood ルール）。修正時に `bash-write-policy.test.ts` に case を追加する想定。

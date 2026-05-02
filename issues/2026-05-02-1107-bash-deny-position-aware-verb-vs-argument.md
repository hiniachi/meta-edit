---
created_at: 2026-05-02T20:15:00+09:00
id: ux-2026-05-02-1107
category: ux/bash-policy
severity: medium
target_file: src/hooks/bash-write-policy.ts
related_files:
  - docs/SPEC.md
  - src/hooks/bash-write-policy.test.ts
discovered_in: 2026-05-02 self-application (rationale text containing "cat >" / "sed -i" repeatedly tripped deny in commit/issue authoring)
---

# [UX] bash deny pattern の position-aware 化：verb 位置にあるときのみ deny、引数位置は warn

## 背景

現在の bash-write-policy.ts は、`DENY_SUBSTRINGS` (`sed -i`, `perl -pi`, `cat >`, `tee`, `git apply`, `rsync`) 、`DENY_PREFIX_PATTERNS` (`mv `, `cp `, `patch `)、`DENY_VERBS`（`hasSafetyFlag` 適用後）を segment 全体 に対して substring/prefix 検査する。

これは 「verb 位置にある」 と 「引数位置にある」 を区別しないため、 commit メッセージやドキュメントの rationale テキストに deny パターンが含まれると false-positive deny が出る。本プロジェクトの特性上 — dogfood 反復で issues / commit メッセージ/ rationale が「その deny パターン自体を誘導として記述する」ことが頡繁にある — この false-positive は常として踏んでいる。

例：

```bash
# 全て false positive (rationale / commit message にパターンが含まれているだけ):
git commit -m "add deny rule for cat > patterns"
git commit -m "fix: avoid sed -i bypass when redirect is staged"
edit_create_file rationale="...sed -i / perl -pi に false positive..."
echo "this discusses cat > behavior" > /tmp/note.txt
```

他方、実際に危険なケースは、verb 位置に deny パターンがあるとき：

```bash
sed -i 's/x/y/' src/foo.ts                       # actual write
cat > src/foo.ts <<EOF                            # actual write
mv src/old.ts src/new.ts                          # actual write
; sed -i ... ; rm -rf ... ; cp foo bar            # chained, all verb-position
```

verb 位置と引数位置を区別すれば、両者を適切にハンドルできる。

## 提案

### 判定ルール

segment を分割した後 (`splitSegments`)、各 segment の「先頭部」に deny パターンがあるときのみ deny、それ以降の位置にあれば warn。

- segment の「先頭部」 = `extractCommandVerb` の返り値とその直後の 「数文字」 まで（例： `sed -i` 、 `cat >` は verb + 一個のオプションまで = トークン 0、1 を見れば足りる）。トークン 0..N（N=2 もしくは 3）以内でパターンがマッチしたら deny。それ以降（引数位置）にあれば warn。
- segment 間は従来通り `;` / `&&` / `||` / `|` / `&` / `\n` / `\r` / U+2028 / U+2029 で分割され、それぞれの segment に対して判定を適用。

### 具体例（提案ルール適用後）

| command | 判定 |
|---|---|
| `sed -i s/x/y/ src/foo.ts` | deny（verb 位置）|
| `cat > src/foo.ts <<EOF` | deny（verb + 一個オプションまでの位置）|
| `mv src/old.ts src/new.ts` | deny（verb 位置）|
| `git commit -m "add deny rule for cat > patterns"` | warn（verb は `git`、`cat >` は引数テキスト内）|
| `git commit -m "fix sed -i bypass"` | warn（同上）|
| `echo "this is about sed -i" > /tmp/note.txt` | warn（verb は `echo`、`sed -i` は引数テキスト内；lredirect target は /tmp/ なので redirect-warn も不発火）|
| `; sed -i ... ; rm -rf ...` | 各 segment の先頭で deny |
| `git commit -m '$(sed -i x y)'` | shell-hosted recursion で inner segment を抽出 → inner は `sed -i ...` のままなので deny（実際にコマンド置換が走るため正しい評価）|

### 取りこぼし不可にしたいケース

- `find . -exec sed -i 's/x/y/' {} \;` — verb は `find`、ただし `-exec ... \;` の内部を sub-command として取り出す既存ロジックを使う。取り出した内部を segment と見なし、その先頭でチェックして deny。これは現在の 「-exec 抽出」 ロジックと互換。
- `bash -c "sed -i ..."` — 同じく shell-hosted recursion で inner segment を verb 位置チェック。
- `xargs sed -i ...` — `xargs` は verb 位置だが「次に来る語を verb として実行」するラッパー。`xargs` をある種の wrapper として扱い、次のトークンを verb 位置と見なす (現在 `sudo` / `doas` / `env` と同じ手法)。未対応なら 子 issue として起票。
- コマンド置換 `$(...)` `` `...` `` — 既存の `extractSubstitutionInners` で内部を追加 segment 化しているので、それぞれの先頭で判定される。

### 実装の見込み

`evaluateSegment` の内部に verb 位置を計算する helper を追加：

```text
1. extractCommandVerb(segment) で verb とその終了位置 (verbEnd) を返すよう拡張。現在 verb のみ返しているように見える。
2. 「verb 位置」 = segment[0..verbEnd] + 次のトークン 1 個 (最大 例えば 30 char) まで。この領域に対して DENY_SUBSTRINGS / DENY_PREFIX_PATTERNS / DENY_VERBS を判定。
3. それ以降にパターンがあれば warn (firstWarn に記録)。現在の structural redirect-target warn と同じ plumbing を使えるので、warn channel を追加コストは低い。
```

### スコープ

- DENY_SUBSTRINGS に含まれるパターンすべてが対象。
- DENY_PREFIX_PATTERNS (`mv `, `cp `, `patch `) も同じルール。もともと prefix マッチなので今も verb 位置に近いが、`-exec` や `bash -c` の inner にも作用させるので一貫ルールに合わせる。
- python/node inline writes (`matchesPythonNodeWrite`) は現在 verb レベルで検査されているので本ルールは影響せず。ただし inline arg の内部テキストに `sed -i` が含まれていてもそれは matchesPythonNodeWrite の detector が見ているトークンとは違うので関係なし。
- protected-path check (`.meta-edit/state/**`, `.meta-edit/tmp/**`) は 外しても良い —この check は「ボディのどこに現れようと、その protected path に書く意図がある」 という重要な防御線だから、position-aware にしてはいけない。現在通り deny のまま。

### テスト諲り込み

上記「具体例」テーブルをそのままテストケース化。特に重要なリグレッションガード：

- `sed -i ... src/foo.ts` (deny) と `git commit -m "...sed -i ..."` (warn) が両立すること
- chained command: `git commit -m "talks about cat >"` は warn、`git commit -m "x" ; cat > foo` は 全体として deny（第 2 segment の verb 位置）
- protected-path: `git commit -m "x"` (allow) と `git commit -m "x" > .meta-edit/state/foo` (deny、protected path は position-aware も適用外)
- `xargs sed -i ...` は 本 PR では deny されない (warn)。子 issue を起票して v0.2 で wrapper 表拡張。

## トレードオフ

- **メリット**: false-positive deny が勇気るように減る。dogfood セッションを plugin disable しないで進められる。rationale / commit メッセージに deny パターンを含める「本質的にコードコメント」ケースがスムーズに通る。
- **デメリット**: 引数位置の deny パターンを warn に落とすと、奇妓なケースで deny されて欲しいものが warn になる。例： `bash -c "echo x; sed -i ..."` を外側から見ると inner は引数に見えるが、shell-hosted recursion で inner segment を 抽出すれば inner 先頭となる — この 抽出ロジックが動いている限り deny のまま。抽出が漏れるケース (e.g. 複雑な quoting) だけ warn に陥落する。これはトレードオフとして受入可能。

## 頼めないケース

- `: ; sed -i ...` と書くと「空コマンド + sed -i」と見えて、第 2 segment で verb 位置の deny が走る — これは逆に望ましい。
- `eval "sed -i ..."` は shell-hosted recursion で inner segment を抽出し deny。現在と同じ振る舞い。
- 外側 segment の verb 位置で `git commit -m '...'` と見えて 全面 warn に陥落しそうに見えるが、その外側 segment に deny パターンが含まれているのは「コマンド置換をクオートしているケース」だけだが、それは既存の `extractSubstitutionInners` が inner を抽出して別 segment として検査するのでセーフ。

## 範囲外メモ

- **issue #1100 (`cat <file> > <target>` is functionally cp)** と部分的に交わる。#1100 は「読み取り verb でも redirect target がリポジトリ内だとコピー効果をもつ」という話、本 issue 1107 は「パターン検査の位置」の話。交わる点は #1100 の答えを今後「読み取り verb だし読み取りフラグもあるが redirect target が in-repo」の合計で deny にするとしたとき、その check も verb 位置ベースでやる。
- v0.1.5 の structural redirect-target warn と並ぶ「位置ベースの warn チャネル」として同一 plumbing を再利用。
- xargs / find 以外の wrapper (e.g. `parallel`, `time`, `nohup`, `nice`, `ionice`) も長期的には wrapper テーブルへの追加候補。本 issue はそのリストアップより「位置ベースの deny/warn 分離」に専徵。

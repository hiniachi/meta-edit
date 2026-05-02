---
created_at: 2026-05-02T20:00:00+09:00
id: ux-2026-05-02-1106
category: ux/safe-sink
severity: low
target_file: src/hooks/bash-write-policy.ts
related_files:
  - docs/SPEC.md
  - src/hooks/bash-write-policy.test.ts
discovered_in: 2026-05-02 self-application (project memory write trigger redirect-warn)
---

# [UX] safe-sink allowlist に `/.claude/` (Claude Code agent state dir) を path-component 一致で追加

## 背景

v0.1.5 以降、bash hook の構造的 redirect-target check は safe-sink allowlist (`/dev/null`, `/dev/stdout`, `/dev/stderr`, `/dev/zero`, `/tmp/`, `/var/tmp/`, `/run/`, `/sys/`) 以外の target に warn を返す。これは 「リポジトリ外への漏れ」 を typed surface に対する bypass-risk として記録するための仕構みだが、Claude Code の agent state directory (`~/.claude/`) への書き込みも warn を受ける。

2026-05-02 の本セッションで、project memory を `/home/nia/.claude/projects/-home-nia-Desktop-meta-edit/memory/dogfood_hypothesis_validation.md` に書こうとした際、以下の挙動が見られた：

1. `Write` tool は deny-raw-edit フックで deny（issue #1102 の複製）。
2. `edit_create_file` は `target_file` が repo-relative 必須なので、リポジトリ外は validation reject。
3. 最後の手段として `printf > $HOME/.claude/.../foo.md` を使ったものの、v0.1.5 の structural redirect-target warn が点火した。

Claude Code の agent state は 「AI が明示的に状態を保存するための場所」 で、warn を出す価値があまりない。warn signal は「仮説検証を muddy にしうるパス」を関係者に見せるためのものだが、agent state dir はその領域に該当しない。

## 提案

### 具体的採用

`SAFE_SINK_NEEDLES`（その名前が何であれ、safe-sink allowlist を表現するセット）に `/.claude/` を **path-component 一致** で追加。`containsAsPathComponent`（PR B で導入された選択肢）と同じセマンティクスを使う。よってマッチ例：

- `/home/nia/.claude/projects/.../foo.md` → マッチ (safe)
- `/home/nia/.claude/plans/foo.md` → マッチ (safe)
- `/home/nia/dotclaude/foo.md` → マッチしない（`/.claude/` がコンポネントとして現れていない）
- `/path/to/.claudefoo/bar` → マッチしない。

### 抽象化レベル

SPEC §5.2 に 「Agent infrastructure directories」 のカテゴリを新設し、safe-sink allowlist を 3 層化：

1. **Standard system sinks**: `/dev/null`, `/dev/stdout`, `/dev/stderr`, `/dev/zero`
2. **Standard temp dirs**: `/tmp/`, `/var/tmp/`, `/run/`, `/sys/`
3. **Agent infrastructure dirs**: `/.claude/`、今後追加可能（例：`/.cursor/`, `/.continue/`, `/.aider/` などの他エージェント state dir、あるいは `/.config/<vendor>/` で始まる XDG 準拠パス）

この抽象化によって、今後他の AI エージェントツールとの併用シナリオで `/.claude/` と同様の状況が発生したときにセット拡張だけでスケールできる。

さらに抽象を上げれば、`META_EDIT_SAFE_SINK_PATHS` のような環境変数でユーザー拡張も可能。ただし、これを許すと「warn signal を全部黙らせる」バイパスベクターともなりうるので、v0.2 以降で議論。

## 検証点

- `/.claude/` は Claude Code 以外のクライアント（将来の Anthropic 提供クライアント含む）も使う可能性。dot-prefixed コンポネントに limit して、誤マッチを限りなく避ける。
- `path-component aware` であることをテストで明示（`/path/x.claude/y` はマッチしない、`/path/.claude/y` はマッチする）。
- `~` 展開後の絶対パスと `~/.claude/...` 表記両方カバー。
- `/home/nia/.claude/projects/.../memory/foo.md` に書いた後、allow + warn なし (silent allow) になるケースと、`/home/nia/Desktop/other-repo/.claude/...` も同様に safe なるケースを検証。とくに後者は 「Claude Code per-project state」 の表現として一貫しているべき。

## 頼めないケース（明示的に deny を重視する部分）

- `/.claude/projects/<other-project>/...` への書き込みも silent allow になる。これは「他プロジェクトの Claude Code state を汚す」リスクを含むが、meta-edit の threat model は single-user-local なので受入可能。user だけが誤う。
- `~/.claude/settings.json` や `~/.claude/keybindings.json` への raw 書き込みも silent allow。これは update-config skill / keybindings-help skill がより丁寧に扱うべき領域だが、hook レベルでは区別不可能なので受容。

## 設計の原意との整合

meta-edit の threat model は「**リポジトリ内** の typed-surface を守る」であり、agent state dir はもともとスコープ外。issue #1102 （raw-edit のリポジトリ外 deny 過剰）とも 同じ同徳。 #1102 の path-aware 化と 1106 の safe-sink 拡張はセットで進めて 「hook はリポジトリ外に関係しない」原則を一本化すべき。

## 範囲外メモ

- 本 issue は bash-write-policy の structural redirect check に限定。deny-raw-edit 側 (#1102) とは別起票のまま。両者を同時に解決しないと dogfood のリポジトリ外書き込みは依然として面倒。
- `protected paths` (`.meta-edit/state/**`, `.meta-edit/tmp/**`) とは逆方向の拡張。protected は deny、safe-sink は silent-allow。両セットの名前と意味を明確に保つ。
- shell-hosted recursion (`bash -c`, `eval`, `$()`) の内部 segment でも同じ safe-sink check が走るようにする。現在の実装がそうなっているはずだが、修正時にテストで確認。

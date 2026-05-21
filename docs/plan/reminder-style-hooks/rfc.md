# RFC — Reminder-Style Hooks

Status: **APPROVED**（2026-05-21）— 実装段階へ。本ドキュメントが
仕様の source。実装 PR はこれを参照する。

| Field | Value |
|---|---|
| Author | nia |
| Created | 2026-05-21 |
| Target | v0.6.0（minor bump、reminder-hook PR を先 land） |
| Touches | `src/hooks/raw-edit-policy.ts` の `reason` 文、`src/hooks/bash-write-policy.ts` の `reason` 文、新規 SessionStart hook |
| Constitutional | 軽（既存 PreToolUse hook の wording 変更 + 新 SessionStart hook 1 件） |
| Landing order | 本 RFC が先、workflow-kind RFC が後（後述 §10） |

---

## 1. Scope

This proposal changes the **wording style** of hook messages.

It does **not** add new workflow edit kinds. It does **not** reclassify
documentation edits. It does **not** change the meaning of existing
edit tools. It only changes how hook output frames guidance, rejection,
and recovery — plus adds **one** SessionStart hook that orients the
model with the same reminder style.

The main idea: phrase hook messages as **self-reminders** rather than
external commands.

---

## 2. Motivation

meta-edit uses hooks to shape agent behavior around tool selection and
edit safety. Current hook messages are written in a direct command
style:

> Denied: raw Edit is not allowed. Use a meta-edit tool before editing.

This is clear, but it frames the hook as an **external prohibition**.
For model behavior, especially immediately before tool selection, a
more useful frame may be:

> I was about to edit directly, but this repository expects edits to go
> through a typed meta-edit declaration first.

The intent is not to weaken the rule. The intent is to make the model
**re-enter the desired reasoning frame**. This proposal treats hooks
as a behavioral reminder surface:

- hook = a short intervention that reactivates the intended classification behavior

rather than only:

- hook = an error message that tells the agent what it did wrong

---

## 3. Research background

Direct evidence for "deny messages phrased as self-reminders outperform
imperative deny messages" does not yet exist. Several adjacent research
directions support the underlying design intuition:

### Self-reminder prompting (Xie et al.)

System-mode self-reminder defense for jailbreak attacks: wrap the user
query in a system prompt that reminds the model to respond responsibly.
Reported reduction of jailbreak attack success rate from **67.21% →
19.34%**. The relevant pattern for meta-edit:

> before the model acts, insert a short reminder that reactivates the
> intended behavior

### Deliberative alignment (OpenAI)

Directly teaches reasoning models safety specifications and how to
reason over them before answering. The model retrieves relevant
specifications at inference time. meta-edit equivalent is weaker
(prompt-level rather than training-level):

> before choosing a tool, remind the model what the tool choice means

### Safety reasoning with guidelines

Standard refusal training can fail to generalize to out-of-distribution
jailbreaks; eliciting safety reasoning with specified guidelines makes
the model use latent safety knowledge more consistently. For meta-edit:

> the agent may already know the intended edit discipline, but the
> hook should elicit that discipline at the moment it matters

### Reasoning-to-Defend

Conventional hard refusal without reasons is hard to generalize;
training models with safety-aware reasoning trajectories explicitly
contrasts hard refusal with reasoning-based defense. For meta-edit:

> a refusal-like intervention can be framed as a classification
> correction: "This would make X look like Y; therefore this was the
> wrong path."

---

## 4. Design hypothesis

Reminder-style hooks should improve compliance because they operate on
the model's next decision frame. Instead of only saying:

> You must not do X.

the hook says:

> If I do X here, I am making a false classification. The intended
> classification is Y.

This matters for meta-edit because tool selection **is already a
classification task**. The hook should help the model remember:

- What kind of edit am I making?
- What does this tool declaration mean?
- What would future agents infer from this action?

---

## 5. Wording principles

### 5.1 Prefer self-reminder over command

✓ "I should route edits through a typed meta-edit declaration before
using raw Edit."

✗ "Do not use raw Edit."

### 5.2 Prefer semantic consequence over prohibition

✓ "If I write this through `edit_decision`, future agents will read it
as accepted. If that is not true, `edit_decision` is the wrong tool."

✗ "Do not use `edit_decision` for speculative content."

### 5.3 Prefer classification correction over blame

✓ "This looks explanation-shaped, but the claim is not established
yet. The safer classification is `edit_observation` or `edit_proposal`."

✗ "Rejected. Invalid tool use."

### 5.4 Keep the boundary intact

Reminder wording must not weaken enforcement. The hook may avoid
imperative phrasing, but the rule remains precise.

✓ "An `edit_decision` represents accepted project intent. Speculative
evidence does not satisfy that condition."

✗ "Maybe consider using another tool."

### 5.5 Use "wrong tool" language

The strongest phrase for meta-edit is not **"forbidden"** but
**"the wrong tool"**. This reinforces the core abstraction: meta-edit
is about correct edit classification.

---

## 6. Scope of reminder style: which denials get the rewrite

**Not every denial gets reminder style.** Some denials are about
"wrong territory" rather than "wrong tool", and softening them is
inappropriate.

| Denial 種別 | スタイル | 理由 |
|---|---|---|
| raw `Edit` / `Write` / `MultiEdit` / `NotebookEdit` の typed-declaration 未取得 deny | **reminder** | 「分類を飛ばした」recovery 系。本 RFC の主戦場 |
| `Bash` 構造的 redirect（v0.1.5 warn） | **reminder** | 既に warn なので soft 系。reminder スタイルに自然 |
| `Bash` verb-deny（`sed -i`, `dd of=`, decode-and-execute, etc.） | **imperative 維持** | 構造的に adversarial、"wrong tool" ではなく "wrong territory"。softening は不適切 |
| protected path（`.meta-edit/state/**`, `.meta-edit/tmp/**`）への書き込み | **imperative 維持** | 監査基盤への破壊、reminder 化は不適切 |
| その他のエラー系（`canonicalize 失敗` 等の fail-closed） | **無変更** | 既にエラーレポート。reminder ではない |

**原則**：reminder スタイルは **"分類ミスからの recovery"** 文脈に限定。**"構造的バイパス"** や **"監査基盤への侵入"** には imperative を残す。

---

## 7. Proposed message style (each surface)

すべて `meta-edit reminder:` prefix を共通化。first-person だけでは
AI が「これは自分の思考？システムからの指示？」で迷うので、prefix で
系統を明示する。

### 7.1 SessionStart hook（既存 `session-onboarding.ts` の書き換え）

注：SessionStart hook は v0.3.1（issue F）で既に導入済み
（`src/hooks/session-onboarding.ts`、`hooks/hooks.json` に登録、
per-session marker dedup 付き）。本 RFC で行うのは **メッセージ
文字列の書き換えのみ**。dedup / 注入機構は維持。

```
meta-edit reminder:

I should not edit first and classify later.

Before changing repository files, I should choose the typed edit tool
that matches the intent of the change. The tool choice is part of the
reasoning step, not just ceremony.

If a direct edit or shell write would skip that declaration, I should
stop and make the declaration first.
```

短く保つ。policy 全文を dump しない。

### 7.2 Raw Edit denial（rewrite）

`src/hooks/raw-edit-policy.ts` の reason 文を以下のスタイルで再構成：

```
meta-edit reminder:

I was about to edit without a meta-edit declaration.

That would skip the intended classification step. The correct next
move is to choose the typed edit tool that best describes this change,
then perform the edit.
```

「Denied」「You must not」を使わず、**skipped step** として framing。

### 7.3 Bash structural redirect warn（rewrite）

v0.1.5 で warn 化済みの structural redirect 経路（`permissionDecisionReason`
+ `additionalContext`）を reminder スタイルに：

```
meta-edit reminder:

I was about to write files through Bash redirection.

If this command changes repository files, that would bypass meta-edit's
typed edit surface. The next move should be to declare the edit kind
first and use the normal edit path.

If the command is only inspecting files or running tests, it should
not write to the repository.
```

### 7.4 Bash verb-deny（**変更しない**）

`cat >`, `sed -i`, `tee`, `mv`, `dd of=`, heredoc-with-redirect、
inline interpreter writes、decode-and-execute は **既存の imperative
maintained**。これらは adversarial verb 群で、reminder スタイルで
softening するのは設計判断として不適切。

### 7.5 Protected path（**変更しない**）

`.meta-edit/state/**` / `.meta-edit/tmp/**` への書き込み試行は既存
imperative 維持。

---

## 8. Relationship to the workflow-kind RFC

並行している `docs/plan/docs-kind-subdivision-and-provenance/rfc.md`
（workflow-axis kinds + provenance）には `next_action` 文の provenance
別 branch がある。本 RFC が land したあと、workflow-kind RFC の
`next_action` 文も **同じ wording principle**（self-reminder
first-person + `meta-edit reminder:` prefix）に揃える。

例：workflow-kind RFC の現行案：

> Your declared provenance is `speculation`. Make sure your prose
> itself flags the uncertainty...

reminder-style に統一すると：

> meta-edit reminder:
>
> I declared provenance: speculation. I should make sure my prose
> itself flags the uncertainty (**Unverified**, "Hypothesis:" etc.)
> — the reader will see the prose, not the provenance field.

reminder-hook PR が先 land → workflow-kind PR が land 時にこの統合を
行う、という順序で attribution が clean になる。

---

## 9. Why this is a separate PR

本 RFC は **hook phrasing only**。workflow-kind RFC（tool taxonomy
変更）と分離する：

| Reminder-hook PR | Workflow-kind PR |
|---|---|
| **Question**: hook wording を self-reminder にすると steering 改善するか | **Question**: edits を progress / observation / proposal / decision / explanation にどう分類すべきか |
| **Changes**: hook message 文、SessionStart hook 1 件、test snapshots | **Changes**: new tools 5 件、provenance schema、cosmetic narrow、edit_docs_only 廃止 |
| **No changes to**: tool taxonomy, docs classification, schema | **No changes to**: hook wording style |

分離理由：

1. **評価の attribution が clean**：behavior 改善が wording か
   taxonomy か切り分け可能
2. **本 PR は小さい**：land コスト低、リスク低
3. **wording 学習効果が先に乗る**：workflow-kind が land したとき、
   既に reminder スタイルに慣れた状態
4. **両 PR 近接 land すると attribution 切り分けが困難**：
   reminder-hook を先に land、数週間運用、qualitative review、その後
   workflow-kind PR の順

---

## 10. Landing order

**reminder-hook PR を先**：

1. v0.5.x の延長として **patch bump or minor bump** で land
   （tool surface は変わらず、wording のみ）
2. 数週間運用（qualitative review、edit log + denial log を読む）
3. workflow-kind PR を v0.6.0 として land、`next_action` 文を
   reminder スタイルに揃える

順序逆だと wording 改善が新 surface 学習効果に埋もれる。

---

## 11. Implementation plan

### Phase 1: hook message strings の書き換え

対象：

- `src/hooks/raw-edit-policy.ts`：`reason` 文の reminder 化
  （正常系の deny のみ。fail-closed エラー系は維持）
- `src/hooks/bash-write-policy.ts`：structural-redirect warn 経路の
  `permissionDecisionReason` のみ reminder 化（verb-deny / protected
  path / fail-closed は維持）

ロジック変更なし、文字列のみ。

### Phase 2: SessionStart メッセージの書き換え

- `src/hooks/session-onboarding.ts` の `buildOnboardingMessage()`
  返却文字列を §7.1 のテキストに書き換え
- hook 登録（`hooks/hooks.json`）、dedup（`.meta-edit/state/sessions/`
  への marker claim）、`additionalContext` 注入の各機構は **無変更**
- 新規ファイル不要（既存 `session-onboarding.ts` の文字列のみ）

注：現状の onboarding メッセージは `typed-edit-onboarding` skill への
pointer も含む（"load the seventeen-tool catalog and selection heuristic"）。
本 RFC では skill pointer の構造は維持しつつ、wording を reminder
スタイルに揃える。"seventeen" → "twenty-one" の数値更新は workflow-kind
RFC のスコープなので本 RFC では触らない（PR landing 順序で順次解決）。

### Phase 3: snapshot test

`src/hooks/raw-edit-policy.test.ts`, `src/hooks/bash-write-policy.test.ts`
への追加：

- key semantic phrases を assert（full string match ではなく substring）
- `expect(output.reason).toContain("meta-edit reminder:")`
- `expect(output.reason).toContain("classification step")` 系
- 維持される imperative（verb-deny / protected path）が
  reminder スタイルに **変わっていない** ことも assert

新規 `src/hooks/session-start-reminder.test.ts`：

- `additionalContext` が空でない
- 期待 prefix と semantic phrase を含む

### Phase 4: documentation

本 RFC を `docs/design/reminder-hooks.md`（または `docs/plan/`
配下のまま）として残す。CLAUDE.md / SPEC.md の wording style 節
（あれば）を更新。

### Phase 5（任意）: telemetry / qualitative review

数週間運用後、edit log と hook log を読み qualitative に：

- raw-edit denial の発生数
- denial 後の typed_edit declaration への遷移率（recovery rate）
- 同一 session 内での denial 繰り返し率（repeat error rate）

定量化は SPEC Article 7 出 of scope の telemetry 設備が無いので
ベストエフォート。読み物として review する。

---

## 12. Evaluation plan

### Quantitative（後段、可能なら）

| Metric | 計算 |
|---|---|
| raw_edit_denied_count | hook log の deny 数 |
| bash_write_bypass_denied_count | 同上 |
| valid_declaration_after_denial_count | denial 直後の typed_edit 成功数 |
| same_error_repeated_count | 同一 session 内で同一 deny 理由が連続発火した数 |
| recovery_rate | `valid_declaration_after_denial / denial_count` |
| repeat_error_rate | `same_error_repeated / denial_count` |

期待方向：recovery_rate **増**、repeat_error_rate **減**。

### Qualitative

deny が発生したセッションを review：

- 次レスポンスが正しい meta-edit tool を選ぶか
- defensiveness が減るか
- ユーザー介入なしで recovery するか
- 同じ deny に対してループしないか

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| reminder wording が less strict に聞こえる | semantic boundary statement を維持（"That would skip the intended classification step." は soft でも unambiguous） |
| first-person text が hook output として奇妙 | `meta-edit reminder:` prefix で系統を明示、本文は短く |
| Models が soft wording を ignore | hook enforcement（deny）は変更しない、wording のみ変更。enforcement layer は影響なし |
| Too much text becomes noise | SessionStart は短く、denial は actionable で必要最小 |
| imperative を残した surface（verb-deny / protected path）と reminder surface の混在で AI が混乱 | prefix `meta-edit reminder:` を reminder 系のみ付与、imperative 系は従来 `[meta-edit:deny] ...` 系 prefix のまま |

---

## 14. Recommended final text（再掲）

### SessionStart

```
meta-edit reminder:

I should not edit first and classify later.

Before changing repository files, I should choose the typed edit tool
that matches the intent of the change. The tool choice is part of the
reasoning step, not just ceremony.

If a direct edit or shell write would skip that declaration, I should
stop and make the declaration first.
```

### Raw Edit denial

```
meta-edit reminder:

I was about to edit without a meta-edit declaration.

That would skip the intended classification step. The correct next
move is to choose the typed edit tool that best describes this change,
then perform the edit.
```

### Bash structural redirect warn

```
meta-edit reminder:

I was about to write files through Bash redirection.

If this command changes repository files, that would bypass meta-edit's
typed edit surface. The next move should be to declare the edit kind
first and use the normal edit path.

If the command is only inspecting files or running tests, it should
not write to the repository.
```

### Bash verb-deny / protected path / fail-closed

**No change.** Existing imperative wording maintained.

---

## 15. Final principle

A hook message should make the agent remember the intended frame.

**Not:**

> You violated a rule.

**But:**

> I was about to skip the classification step.
> That would make the edit invisible to the typed edit surface.
> I should declare the edit kind first.

The hook still denies the unsafe path. The text simply explains the
denial as a **recovery cue** instead of an **external scolding**.

---

## 16. References

- Xie et al. "System-mode self-reminder defense for jailbreak attacks"
  （67.21% → 19.34% success-rate reduction）
- OpenAI "Deliberative alignment"
- "Safety Reasoning with Guidelines"
- "Reasoning-to-Defend"
- v0.1.5 OBSERVED-FAILURES entry on `permissionDecisionReason` +
  `additionalContext`（既存 model-facing hook message パターン）
- `docs/plan/docs-kind-subdivision-and-provenance/rfc.md`（並行
  workflow-kind RFC、style 統合先）

# Observed failure patterns

Per CLAUDE.md §7.3, when a specific failure pattern looks common enough
to warrant detection, write it down here. Do not add detection in MVP —
the bet is that descriptions alone change AI behavior; muddying the
signal with classifiers makes that question impossible to answer.

(Note: v0.2 reframed the *mechanism* — declaration + token binding,
SPEC Article 5 — but did NOT add detection. This file remains the
queue for the optional future diff-classifier backstop, per SPEC
Article 2 / Article 7. A future version may pick zero, one, or many of
these entries; the triggering signal is **observed misuse in the edit
log or through user-reported false negatives**, not theoretical
possibility.)

---

<!-- Phase 4 (deny-bash-write-bypass) hook gaps and Phase 5 (CLI)
gaps were both resolved in v0.1.2 PR B and PR C respectively;
their entries now live under "Resolved (promoted to MVP)" below. -->


## Phase 4 (deny-bash-write-bypass) — v0.1.5 redirect-allowlist warn → deny restore candidate

v0.1.5 loosened the structural redirect-target check from `deny` to
`warn` (SPEC §5.2). Pre-v0.1.5: any `>` / `>>` / `>|` whose target was
not on the safe-sink allowlist (`/dev/null`, `/dev/stdout`,
`/dev/stderr`, `/dev/zero`, `/tmp/`, `/var/tmp/`, `/run/`, `/sys/`)
was denied outright. Post-v0.1.5: the same structural rule emits
`permissionDecision: "allow"` plus a `permissionDecisionReason`
nudging the AI toward an `edit_*` tool, and mirrors the message on
stderr for human-in-the-loop visibility. The verb-denylist
(`cat >`, `sed -i`, `tee`, `mv`, `dd of=`, heredoc-with-redirect,
inline interpreter writes, decode-and-execute), the protected-path
checks (`.meta-edit/state/**`, `.meta-edit/tmp/**`), and the
shell-hosted recursion deny remain on `deny`. `deny` always wins
over `warn` when both fire on the same command.

The reason for the loosening: the redirect-target allowlist had a
structural false-positive surface on legitimate redirects to outside-
repo absolute paths (`~/.cache/...`, `$RUNNER_TEMP`,
`/home/user/scratch/...`, etc.). These had no safe-sink entry and
were uniformly denied, costing real friction in development workflows
that are not the design's actual concern (in-repo writes via typed
tools).

### Restore trigger (warn → deny)

Restore the deny when *any* of the following hold:

1. **Edit log signal**: an analysis of edit logs across multiple
   sessions shows that unenumerated write verbs (`printf > foo.ts`,
   `echo > out.log`, `jq --rawfile ... > fixtures/x.json`, etc.) are
   being routed around the typed tools at non-trivial frequency
   (>5% of bash-write-bypass warnings turn into actual in-repo writes
   the AI then doesn't follow up with a typed tool).
2. **Review signal**: code reviews on PRs produced by AI sessions
   repeatedly find `bash-write-bypass` warnings in the transcript
   that the AI ignored (i.e., the warn surface is being treated as
   a green light rather than a yellow one).
3. **Protocol signal (objective)**: Claude Code release notes (or
   updated hook docs) explicitly state that
   `hookSpecificOutput.additionalContext` is no longer fed to the
   model for `allow` decisions. v0.1.5's warn carrier has three
   layers — `permissionDecisionReason` (user-facing transcript),
   `additionalContext` (model-facing on the next turn), and stderr
   (host-rendered in the transcript). The model-facing layer is
   `additionalContext`; if the host stops surfacing it, the AI no
   longer receives the nudge and the warn route is structurally
   weaker than the v0.1.4 deny. Treat the release-note change as
   the trigger; do NOT wait for downstream behavioral evidence.

### Restore procedure

This procedure assumes the *only* `warn`-emitting check is the
structural redirect surface in `bash-write-policy.ts`. If a future
policy adds a new warn-producing check (e.g. a soft-policy channel
on a different tool), the type-system + runtime simplifications
below should be skipped — keep the `warn` member and the
`replyAllowWithWarning` helper for the other consumer.

1. `src/hooks/bash-write-policy.ts`:
   - In `evaluateSegment`, change the
     `redirectsOutsideSafeSinkAllowlist(rawSegment) && firstWarn === null`
     block from `decision: "warn"` back to `decision: "deny"` and
     revert the `firstWarn = ...` capture to an early `return`.
   - Remove the `firstWarn` plumbing in `evaluateBashCommand` (the
     cross-segment loop) and in `evaluateSegment` (the per-segment
     slot, including the `firstWarn` returned at the end of
     `evaluateSegment`) once no other warn-emitting check exists.
   - In `recursivelyEvaluateArg`, drop the `warn` propagation branch
     so it returns `null` for non-deny decisions again.
   - Optionally rename `redirectsOutsideSafeSinkAllowlist` back to
     `redirectsToInRepoPath` to match the deny semantics again.
2. `src/hooks/hook-runtime.ts`: remove the `"warn"` member from
   `HookDecision` and remove `replyAllowWithWarning`. Update the
   inline comment on `replyAllow` if needed.
3. `src/hooks/deny-bash-write-bypass.ts` and
   `src/hooks/deny-raw-edit.ts`: drop the `decision === "warn"`
   branch and the `replyAllowWithWarning` import in both
   dispatchers.
4. `src/hooks/bash-write-policy.test.ts` — re-flip every test that
   v0.1.5 set to expect `warn`. The exact list, by describe block:
   - `evaluateBashCommand — dogfood-001 in-repo redirect (warn since v0.1.5)`:
     - "warns on printf > test-playground/ (the dogfood-001 reproduction)"
     - "warns on echo > out.log (relative in-repo target)"
     - "warns on printf >> append to in-repo path"
     - "warns on noclobber-override >| to in-repo path"
     - "warns on redirect to absolute path outside the safe-sink list"
     - "warns on bash -c \"printf x > src/foo.ts\" (warn propagates from shell-hosted recursion)"
     Rename the describe to drop "(warn since v0.1.5)". Update the
     reason assertion: the deny reason text (v0.1.4) reads
     "command redirects (`>`/`>>`/`>|`) to a path that is not on
     the safe-sink allowlist ... Use an edit_* tool for in-repo
     writes; capture command output to /tmp/ or /dev/null if you
     need a sink." So `expect(r.reason).toContain("safe-sink
     allowlist")` still passes, but the v0.1.5 `expect(r.reason)
     .toContain("edit_*")` assertion stays valid as well — the
     deny reason also contains `edit_*`. No change needed there.
   - `evaluateBashCommand — dogfood-001 self-review fixes`:
     - "warns on safe-prefix-then-traversal target (/tmp/../in-repo)"
     - "warns on double-up-traversal from /var/tmp"
     - "warns on CR-detached redirect target (printf x >\\rin-repo.ts)"
     - "warns on LF-detached redirect target (printf x >\\nin-repo.ts)"
   - `evaluateBashCommand — Codex PR #42 review fixes` →
     `P1-1: protected-path writes inside shell-hosted payloads`:
     - "warns on bash -c with redirect to in-repo path (not protected)"
     (re-flip from `warn` back to `deny`)
   The new v0.1.5 regression guards inside the dogfood-001 describe
   block — protected-path-still-deny, verb-deny-still-wins, and
   deny-wins-across-segments — MUST be retained. They pin
   invariants (verb-denylist + protected-path precedence over the
   structural redirect check) that the deny-restored code must
   continue to satisfy. Do not delete them in the flip-back.
5. `docs/SPEC.md`: revert §5.2's "Structural redirect-target warn"
   subsection back to the v0.1.4 deny wording, including the
   "deny wins over warn" sentence and the rationale paragraph.
   Revert the §8 threat-model line. Revert the §11 upkeep
   paragraph that records this surface.
6. `package.json` + `.claude-plugin/plugin.json`: bump version
   (e.g. to `0.1.6`) so the restore is visibly a release event.
7. `OBSERVED-FAILURES.md`: move this entry to "Resolved
   (promoted to MVP)" with the trigger that fired.

## Phase 4 (deny-bash-write-bypass) — v0.4.3 mv/cp/rsync verb-deny → warn restore candidate

v0.4.3 loosened the verbs `mv`, `cp`, and `rsync` from the verb-deny
path to the v0.1.5 `warn` mechanism (SPEC §5.2). Pre-v0.4.3 these
three verbs were in `DENY_VERBS` and any non-safety-flagged
invocation was denied outright. Post-v0.4.3 the same invocation
emits `permissionDecision: "allow"` plus a `permissionDecisionReason`
and model-facing `additionalContext` nudging the AI toward an
`edit_*` tool, mirrored on stderr for human-in-the-loop visibility.
`patch` stays on `deny`. The rest of the verb denylist (`cat >`,
`sed -i`, `tee`, `dd of=`, heredoc-with-redirect, inline-interpreter
writes, decode-and-execute) stays on `deny`. The protected-path
checks (`.meta-edit/state/**`, `.meta-edit/tmp/**`) stay on `deny`
**regardless of verb** — they fire earlier in `evaluateSegment`
(`touchesProtectedPathTokenized` + `redirectsToProtected`), strictly
before the verb block, so `mv payload .meta-edit/state/x` is still
denied. `deny` always wins over `warn` within a segment and across
segments.

The reason for the loosening: under Article 3's non-adversarial
threat model the goal is to make the typed surface easier than
honest workaround paths, not to sandbox a determined attacker. The
v0.1.5 bet — that a structured warn preserves the signal channel
without the friction of a hard deny — held. `mv`, `cp`, and `rsync`
dominate legitimate non-edit developer workflows (rename/move, copy
templates/fixtures, backup, deploy/sync); hard-denying all three was
over-hardening friction that taxed honest work without a
corresponding bypass-resistance gain (a determined bypass has many
other routes already on `deny`; an honest rename does not). The warn
keeps the nudge-toward-typed-tools signal channel intact, and the
protected-path deny — the actual audit-log integrity boundary — is
untouched.

### Restore trigger (warn → deny)

Restore the deny for `mv`/`cp`/`rsync` when *any* of the following
hold:

1. **Edit log signal**: analysis of edit logs across multiple
   sessions shows that >5% of `mv`/`cp`/`rsync` warnings turn into
   actual in-repo content writes that the AI then does not follow
   up with a typed `edit_*` tool call (i.e. the verbs are being used
   to route content around the typed surface, not for legitimate
   rename/copy/sync).
2. **Review signal**: code reviews on PRs produced by AI sessions
   repeatedly find `bash-write-bypass` `mv`/`cp`/`rsync` warnings in
   the transcript that the AI ignored (the warn surface treated as a
   green light rather than a yellow one).
3. **Protocol signal (objective)**: Claude Code release notes (or
   updated hook docs) explicitly state that
   `hookSpecificOutput.additionalContext` is no longer fed to the
   model for `allow` decisions. The model-facing layer of the warn
   carrier is `additionalContext`; if the host stops surfacing it,
   the AI no longer receives the nudge and the warn route is
   structurally weaker than the v0.4.2 deny. Treat the release-note
   change as the trigger; do NOT wait for downstream behavioral
   evidence. (Same protocol dependency as the v0.1.5 entry — a
   single `additionalContext` regression triggers both restores.)

### Restore procedure

1. `src/hooks/bash-write-policy.ts`:
   - Move `"mv"`, `"cp"`, `"rsync"` from `WARN_VERB_NAMES` back into
     `DENY_VERB_NAMES`; delete `WARN_VERB_NAMES` / `WARN_VERBS` /
     `WARN_PREFIX_PATTERNS` if they have no other members.
   - In `evaluateSegment`, delete the `WARN_VERBS` warn-capture
     block; the existing `DENY_VERBS.has(verb)` deny block then
     covers all four verbs again.
   - Delete `warnVerbReason`; the existing `denyReason(verb)` covers
     them. Revert the documentation comments at the verb-name
     source block / line-437 / line-504 sites.
   - Keep the `firstWarn` plumbing and `replyAllowWithWarning` — the
     v0.1.5 structural-redirect warn surface still uses them.
2. `src/hooks/bash-write-policy.test.ts`: re-flip every test the
   v0.4.3 change set to expect `warn` back to `deny`, restore the
   `constants` prefix assertions, and delete the
   `v0.4.3 mv/cp/rsync verb-warn (relaxed from deny)` describe
   block (its protected-path / patch / deny-wins invariant guards
   are also covered by the existing protected-path and chained-
   segment blocks, so no invariant coverage is lost).
3. `docs/SPEC.md` §5.2: restore `mv`, `cp`, `rsync` to the verb-
   denylist bullet and revert the v0.4.3 sentence in the
   redirect-target-warn paragraph.
4. `package.json` + `.claude-plugin/plugin.json`: bump version so
   the restore is visibly a release event.
5. `OBSERVED-FAILURES.md`: move this entry to "Resolved
   (promoted to MVP)" with the trigger that fired.

## Phase 8 (apply) residual gaps

### MEDIUM: Phase-1 read vs Phase-3 rename TOCTOU on the content-pair flow

The two-phase apply in `src/tools/apply.ts` reads each target's
disk content during Phase 1 (preflight) and compares to
`change.old_content`. Phase 2 stages every sibling temp file, then
Phase 3 commits all renames. If a concurrent process modifies a
target file between the Phase 1 read and the Phase 3 rename, the
rename silently overwrites the newer content with `change.new_content`
and the call returns `applied: true` — a lost-update regression
relative to the "stale-content protection" the content-pair API
advertises.

The threat model documented in `apply.ts`'s header comment is
**single-user local TOCTOU**: meta-edit assumes one agent operating
on the repo at a time and uses `realpath` re-canonicalization +
parent-drift checks to cover the symlink-swap case. Concurrent
editors or filesystem watchers writing to the same target during
the apply window are out of scope for the MVP.

Codex GitHub bot review on PR #29 (P2) flagged this as a regression
"in repositories with concurrent editors/watchers". Promote to
detection only if observed: most realistic agent workflows are
single-writer and the cost (re-read on every change immediately
before each rename, without any guarantee that the gap before the
rename system call is closed without `openat`) is high relative to
the observed frequency.

Promotion options if observed:
- **Re-read each target immediately before its rename** in Phase 3
  and abort the batch with a partial-write warning if the disk
  content changed since Phase 1. Tightens the window from the full
  Phase 2 duration to a single rename's scheduling boundary.
- **Hold an advisory lock** (`.meta-edit/state/apply.lock`) for the
  duration of `applyChanges`. Trades concurrency for atomicity;
  acceptable given that meta-edit's threat model is single-writer
  anyway.

---

## Resolved (promoted to MVP)

- **`edit_docs_only` tool added** (v0.1.x). Pure documentation edits had no
  honest tool choice in the pre-`edit_docs_only` tool surface, which forced
  the typed surface to be bypassed for any docs-touching workflow during
  self-application. Promoted from coverage-gap entry to a full SPEC §4
  description; see `docs/SPEC.md` §3 (validation, patch scope) and §4
  (`edit_docs_only`).
- **Read-only commands referencing protected paths now allowed** (v0.1.1).
  `evaluateBashCommand` previously denied any segment whose text contained
  `.meta-edit/state/` or `.meta-edit/tmp/`, even when the surrounding
  command was read-only (`tail`, `cat`, `head`, `wc`, `grep`, ...). The
  fix carves out a small `READ_ONLY_VERBS` set; protected paths are still
  denied for any verb outside that set, and for read-only verbs that
  redirect their output (`>` / `>>`) to a protected target. See
  `src/hooks/bash-write-policy.ts` (`READ_ONLY_VERBS`,
  `redirectsToProtected`). Resolves the prior MEDIUM "Read-only commands
  referencing protected paths are blocked" entry.
- **`meta-edit summary` no longer crashes on malformed log entries**
  (v0.1.2). `EditLog.readAll()` now zod-validates each line against
  `EditLogEntrySchema` and silently skips entries that fail, so a
  hand-edited or older `edits.jsonl` line with a missing or non-string
  `tool_name` / `target_file` no longer trips `name.padEnd(...)` /
  `file.padEnd(...)` in `formatSummary`. The schema is exported
  alongside the type via `z.infer`, keeping the writer and the reader
  in lockstep. Resolves the prior MEDIUM Phase 5 entry. See
  `src/state/edit-log.ts` (`EditLogEntrySchema`, `readAll`).
- **Phase 4 hook robustness gaps cleared** (v0.1.2). The
  `deny-bash-write-bypass` hook now handles command substitutions,
  wrapper value-options, safety-flag exceptions, path-component-aware
  protected-path matching, language-level string-literal masking for
  `python -c` / `node -e`, and Unicode line separators. Promoted ahead
  of observed misuse, per user direction for the v0.1.2 milestone.
  Resolves seven prior queue entries:
  - MEDIUM "Backtick command substitution `` `...` ``" — `splitSegments`
    now post-processes each segment via `extractSubstitutionInners`,
    emitting backtick inner spans as additional segments. A `mv` inside
    `` `...` `` is now caught by the leading-verb deny.
  - MEDIUM "`$(...)` command substitution prefix-verb bypass" — the
    same expansion handles `$(...)` (with nesting). Inside double quotes
    `$(...)` is expanded; inside single quotes it is treated as literal
    text per POSIX.
  - MEDIUM "Wrapper options with value args (`sudo -u USER mv`,
    `env -u VAR mv`)" — `extractCommandVerb` consults a per-wrapper
    `WRAPPER_VALUE_OPTS` map (sudo: `-u`/`-g`/`-h`/`-C`/`-D`/`-p`/`-r`/
    `-t`/`-T`/`-R`/`-c`/`-U`; doas: `-u`/`-C`; env: `-u`/`-C`/`-S`)
    and consumes the value token alongside the short option, so
    `sudo -u root mv a b` resolves to verb `mv`.
  - LOW "`cp --no-clobber` / `patch --dry-run` false positive" —
    `hasSafetyFlag` carves out `patch --dry-run` / `patch --check`
    from the `DENY_VERBS` deny. **The original PR B carve-out also
    covered `cp -n` / `cp --no-clobber`, but that was reverted in a
    follow-up commit on the same PR after Codex GitHub bot caught
    that `cp -n` only refuses to OVERWRITE existing destinations —
    it still CREATES new files, so allowing
    `cp -n payload src/new_file.ts` was a write bypass. Only
    `patch`'s read-only modes survive.**
  - LOW "Protected-path matching uses substring, not path component" —
    `containsAsPathComponent` requires the trailing side of the needle
    to be a path-component boundary AND the leading side to either be a
    boundary or a short/long option flag prefix in the same token, so
    `/tmp/x-with-.meta-edit/state-in-name` no longer false-positives
    while `less -O.meta-edit/state/exfil.log` and
    `--output=.meta-edit/state/...` still deny.
  - LOW "Backslash-strip inside quoted regions" — resolved indirectly:
    the aggressive backslash strip is retained (so `s\ed -i` bypasses
    inside quoted shell wrappers still match), but the cited symptom
    (`python -c "print(\"write_text\")"` denying because `write_text`
    appears in the post-strip text) is gone. `matchesPythonNodeWrite`
    now extracts the `python -c` / `node -e` arg from the RAW (pre-
    strip) text, masks language-level string literals, then runs the
    writer-pattern check. Tokens that appear ONLY inside string
    literals no longer fire.
  - LOW "Unicode line separators / CRLF / `\r` alone" —
    `primarySplitSegments` now treats `\r`, U+2028, and U+2029 as
    additional separators alongside `\n`.
- **`patch` field replaced with content-pair `changes`** (v0.1.2).
  `EditToolRequest` no longer takes `patch: string`; the new shape is
  `{ target_file, rationale, risk_level, test_files, changes:
  [{file, old_content, new_content}, ...] }`. The server reads each
  `change.file` from disk and asserts byte-for-byte equality with
  `old_content` before any write (precondition), then atomically
  replaces the file with `new_content` via the existing sibling-temp
  + rename + parent-fsync path. **Modify-only**: missing files fail
  the call (no creation). Apply is two-phase atomic: precondition
  preflight (no writes) → all sibling-temp writes → all renames; if
  any precondition or temp-write fails, no target file is modified.
  `patch_size_bytes` in the edit log is preserved for shape compat
  but its value semantics shifted to "byte length of synthesized
  unified diff via `Diff.createTwoFilesPatch`". Resolves the prior
  MEDIUM "Hand-crafted unified diffs are brittle for multi-line
  additions" entry by replacing the brittle authoring path entirely.
  This is Option B from the original entry, chosen by user directive
  for v0.1.2. **Breaking change** — no compat shim; callers must
  migrate to `changes`. See `src/tools/common.ts`
  (`EditToolRequestSchema`, `validateRequest`,
  `makeApplyingHandler`), `src/tools/registry.ts` (`inputSchema`),
  `src/tools/apply.ts` (`applyChanges` content-pair preflight),
  `docs/SPEC.md` §3 + §6.

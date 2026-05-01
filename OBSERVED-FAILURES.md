# Observed failure patterns

Per CLAUDE.md §7.3, when a specific failure pattern looks common enough to
warrant detection, write it down here for v0.2. Do not add detection in
MVP — the bet is that descriptions alone change AI behavior; muddying
the signal with classifiers makes that question impossible to answer.

This file is a queue, not a backlog. v0.2 may pick zero, one, or many of
these. The triggering signal is **observed misuse in the edit log or
through user-reported false negatives**, not theoretical possibility.

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
3. **Protocol signal**: a future Claude Code release stops surfacing
   `permissionDecisionReason` for `allow` decisions, leaving stderr
   as the only carrier. If the stderr surface alone proves
   insufficient (AI does not consume stderr in tool results), the
   warn route is no longer effective and should revert to deny.

### Restore procedure

1. `src/hooks/bash-write-policy.ts`:
   - In `evaluateSegment`, change the `redirectsToInRepoPath` block
     from `decision: "warn"` back to `decision: "deny"` and revert
     the `firstWarn = ...` capture to an early `return`.
   - Remove the `firstWarn` plumbing in `evaluateBashCommand` and
     `evaluateSegment` if no other warn-emitting check exists.
   - Keep `recursivelyEvaluateArg` propagating `warn` only if a
     warn-emitting check still exists upstream; otherwise simplify
     it back to deny-only.
   - Optionally remove the `"warn"` member from `HookDecision`.
2. `src/hooks/deny-bash-write-bypass.ts`: drop the `decision === "warn"`
   branch and the `replyAllowWithWarning` import.
3. `src/hooks/hook-runtime.ts`: keep `replyAllowWithWarning` only if
   another future warn surface uses it; delete otherwise.
4. `src/hooks/bash-write-policy.test.ts`:
   - Re-flip the `dogfood-001 in-repo redirect (warn since v0.1.5)`
     describe back to `deny`.
   - Re-flip the affected cases in `dogfood-001 self-review fixes`
     and the `P1-1: protected-path writes inside shell-hosted
     payloads` block (the `bash -c "printf x > src/foo.ts"` test).
   - Drop the v0.1.5-specific regression guards that no longer
     apply.
5. `docs/SPEC.md`: revert §5.2's "Structural redirect-target warn"
   subsection back to the v0.1.4 deny wording, plus the threat-model
   line in §8 and the upkeep note in §11.
6. `OBSERVED-FAILURES.md`: move this entry to "Resolved (promoted to
   MVP)" with the trigger that fired.

If only the *structural* redirect rule is restored to deny while
some other warn surface (e.g. a future "soft policy" channel)
remains, keep the `warn` decision member and the runtime helper
even if the bash hook no longer uses it; the cost is one branch.

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

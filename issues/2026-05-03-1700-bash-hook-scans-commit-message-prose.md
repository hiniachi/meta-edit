---
created_at: 2026-05-03T17:00:00+09:00
id: dogfood-2026-05-03-1700
category: ux/bash-write-policy
severity: medium
target_file: src/hooks/bash-write-policy.ts
related_files:
  - src/hooks/bash-write-policy.test.ts
  - issues/2026-05-02-1107-bash-deny-position-aware-verb-vs-argument.md
discovered_in: 2026-05-03 PR #60 (adoption-flow + bash-write polish bundle) authoring
---

# [UX] bash hook scans `git commit -m` / `gh pr create --body` prose as if it were a shell command

## TL;DR

Writing a commit message that contains the literal substrings `cat >`,
`tee `, or `patch ` (e.g. when *describing* a fix to those exact deny
patterns) causes `deny-bash-write-bypass` to deny the entire `git commit`
invocation. The hook receives the full command string — including the
heredoc body containing the message prose — and runs the same DENY_*
scans as on real shell input. There is no distinction between "a shell
verb the user typed" and "a literal substring inside a quoted argument
to git/gh."

This is **a deeply specific manifestation of issue 1107 (position-aware
verb-vs-argument)**, but it surfaces in the most common dogfood
workflow — committing — so it's worth a separate filing.

## Why this is MEDIUM (UX, not security)

- The fail mode is **deny → workaround → retry-with-rephrased-message**.
  No data is lost; the hook is doing the safe thing.
- But: the workaround is to **paraphrase the commit message to remove
  the verb literals**. That degrades commit clarity (you can no longer
  cite the exact deny pattern you fixed) and trains the agent to write
  vaguer commit messages, which is the opposite of what we want.
- Repeats once per affected commit on a real-world bundle. PR #60 hit
  it twice (`cat >` in the B4 description, `tee` in the codex-fix
  message, `patch` in the PR body).

## Reproduction

```bash
# Inside the meta-edit repo with the hook installed:
git commit -m "fix: handle cat > redirect"
# → deny: command matches deny pattern "cat >"

git commit -m "fix: tee fd-redirect false-deny"
# → deny: `tee <path>` writes to a file ...

gh pr create --title "fix patch -oFILE bypass" --body "..."
# → deny: command matches deny pattern "patch"  (DENY_PREFIX_PATTERNS)
```

Encountered live in PR #60's commit and PR-body composition. Workaround
on each: paraphrase the prose so the verb-then-redirect substring
doesn't appear (e.g. "the verb is a write verb by design" instead of
"tee is a write verb by design").

## Fix directions

This issue is functionally a special case of issue 1107
(position-aware verb-vs-argument). Closing 1107 with a position-aware
parser would resolve this filing too. Two narrower paths if 1107 stays
out of scope:

1. **Wrapper-aware quoting.** Detect that the leading verb is one of a
   small set of "wrappers that take quoted prose as an argument"
   (`git commit -m`, `git tag -m`, `gh pr create`, `gh pr edit`,
   `gh issue create`, `git rebase --exec`, etc.) and skip the body
   argument from the DENY_* scans. The wrappers themselves are not
   typed-edit bypass surfaces; they read prose, attach to a refspec
   or open an editor, and never write to repo files via `>` redirect
   in the prose. Risk: wrong-wrapper allowlist becomes its own audit
   surface; consult Article 7's "minimum machinery" stance before
   adding.
2. **Single-quote heredoc respect.** When the command contains
   `<<'EOF'` (single-quoted heredoc — variable expansion off) and the
   pattern is found *inside* the heredoc body, treat the body as
   inert text rather than rescanning it. Less general than (1) but
   doesn't rely on a wrapper allowlist. Currently `stripQuotedContent`
   treats heredoc bodies as quoted-string content, but the
   DENY_PREFIX_PATTERNS / DENY_VERBS scans run on `normalized` rather
   than the quote-stripped form for some checks.

## Why not just narrow DENY_PREFIX_PATTERNS

Removing `patch ` / `tee ` etc. from DENY_PREFIX_PATTERNS would create
a real bypass — `patch -p0 < diff` (no `--dry-run`) is a real write,
and that's exactly what the prefix pattern is there to catch.

## Out of scope

- Fixing 1107 itself in this filing. That's an architecture-level shift
  (whole-command tokenization aware of quoting context) and deserves
  its own design pass.
- Adding `git commit -m` to a "trusted wrapper" set in code without
  consultation. The user's earlier guidance preferred small,
  documented changes over wrappers-as-config; the right escalation
  here is to discuss whether the wrapper-allowlist abstraction is
  worth introducing.

## Related

- Issue 1107 — bash-deny position-aware verb-vs-argument (the
  architecture-level fix this filing rolls up into).
- PR #60 — direct dogfood evidence; commit messages had to be
  paraphrased twice and the PR body once.

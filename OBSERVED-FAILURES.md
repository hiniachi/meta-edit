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


## Phase 3 (validation) tool-surface DX gaps

### MEDIUM: Hand-crafted unified diffs are brittle for multi-line additions

`EditToolRequestSchema` accepts only a `patch: string` field, validated
server-side by `jsdiff`'s `parsePatch`. The parser is strict: every body
line must begin with `' '`, `'-'`, `'+'`, or `'\'`. Empty body lines
(produced by paragraph breaks in additions) trigger
`Hunk at line N contained invalid line ` (trailing space — the line is
empty). The error message names neither the offending line nor the
missing prefix, so diagnosis takes several round-trips.

Concretely, observed during Phase 7 + Phase 8 self-application sessions:
any attempt to add a multi-section block (e.g., two new `describe(...)`
blocks at the end of `bash-write-policy.test.ts`) by hand-crafting the
`patch` parameter requires meticulous prefixing of every blank line as
`' '` (context blank) or `'+'` (add blank). LLM-generated diff strings
routinely emit raw `\n\n` between paragraphs and fail validation.

The realistic workaround — write new content to `/tmp/x` via Bash, run
`diff -u`, copy output back into the `patch` parameter — is itself
fragile: heredoc content that mentions `.meta-edit/state/...` literally
trips the `deny-bash-write-bypass` protected-path check (see the LOW
entry above). Layered workarounds compound the friction.

Promotion options for v0.2 (in increasing order of invasiveness):

- **(A) Server-side normalization.** In `preValidatePatchInput`, re-prefix
  empty body lines with a single space before passing to `parsePatch`.
  Tiny diff. Doesn't change semantics for valid input. Catches the most
  common LLM/human mistake.
- **(B) Alternate request shape.** Accept an `old_content` + `new_content`
  pair (mutually exclusive with `patch`); server computes the diff
  internally via `jsdiff.createTwoFilesPatch`. Higher DX ceiling — agents
  submit the new file content as a string, no diff math needed. Schema
  change; `EditToolRequest` would become a discriminated union. **This is
  the option the project author flagged as the right answer for v0.2.**
- **(C) Better validation errors.** Keep the surface as-is but emit
  "blank context lines must begin with ` ` (space); offending line: N"
  instead of "invalid line ". Reduces diagnosis time without solving the
  underlying authorability problem.

Trigger for promotion: observed in **every** Phase 7+ session that needed
to add a non-trivial block of test or doc content. Friction is not
hypothetical; it is structurally on the dogfooding path.

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
    from the `DENY_VERBS` deny. (The cp carve-out was reverted in
    a follow-up commit; see the PR-#27 round-2 note in
    IMPLEMENTATION-LOG.md.)
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

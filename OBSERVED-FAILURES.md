# Observed failure patterns

Per CLAUDE.md §7.3, when a specific failure pattern looks common enough to
warrant detection, write it down here for v0.2. Do not add detection in
MVP — the bet is that descriptions alone change AI behavior; muddying
the signal with classifiers makes that question impossible to answer.

This file is a queue, not a backlog. v0.2 may pick zero, one, or many of
these. The triggering signal is **observed misuse in the edit log or
through user-reported false negatives**, not theoretical possibility.

---

## Phase 4 (deny-bash-write-bypass) residual gaps

### MEDIUM: Backtick command substitution `\`...\``

The hook splits on `;`, `&&`, `||`, `|`, bare `&`, and newlines while
respecting `'...'` and `"..."` quoting. It does NOT parse classic
backtick command substitution. Substring deny patterns (e.g., `sed -i`)
still fire because the inner command appears literally in the outer
command text, but **prefix-only deny patterns** (`mv`, `cp`, `patch`)
are matched against the trimmed segment start. A construct such as

    cargo fmt && echo `mv old new`

would slip through because the trimmed segment starts with `echo`, not
`mv`. Realistic agent workflows rarely use backtick substitution; modern
guidance prefers `$(...)`. Promote to detection only if observed.

### MEDIUM: `$(...)` command substitution prefix-verb bypass

Same shape as the backtick gap, with the modern `$(...)` syntax. The
splitter does not treat `$(` as a segment boundary. Substring denies
still fire on `sed -i`, `git apply`, etc. Prefix-only verbs (`mv`, `cp`,
`patch`) inside `$(...)` are not detected. Promote to detection only if
observed.

### MEDIUM: Wrapper options with value args (`sudo -u USER mv`, `env -u VAR mv`)

The wrapper-option skip in `extractCommandVerb` consumes flag-only
options (`-X`, `--foo`, `--foo=bar`) but does not know which options
take a separate value argument. Concretely, `sudo -u root mv a b`
and `env -u VAR mv a b` peel the wrapper and the leading flag, then
see `root` / `VAR` as the next word and treat that as the verb,
missing `mv`. Substring deny patterns (`sed -i`, `git apply`, etc.)
still fire because they don't depend on segment-start position;
only prefix-only verbs (`mv`, `cp`, `patch`) slip through.

Promote to detection by adding per-wrapper option grammars (e.g.
`sudo` short opts that take a value: `-u`, `-g`, `-h`, ...). For
v0.2.

## Phase 4 (deny-bash-write-bypass) residual gaps

### LOW: `cp --no-clobber` / `patch --dry-run` false positive

`DENY_PREFIX_PATTERNS` denies any segment whose trimmed form starts with
`cp `, `mv `, `patch `, etc. This includes read-only or no-write variants
such as `cp --no-clobber a b` (which refuses to overwrite an existing
file) and `patch --dry-run < changes.diff` (which only previews). False
positives are conservative — the user can route the operation through an
edit_* tool — but the deny reason is misleading. If observed, tighten
the prefix matcher to look for the verb followed by an argument list
that does not contain `--dry-run` / `--no-clobber`.

### LOW: Protected-path matching uses substring, not path component

`touchesProtectedPath` and `redirectsToProtected` both use
`String.prototype.includes()` to match `.meta-edit/state` /
`.meta-edit/tmp` against the segment text and the redirect target
respectively. This is conservative — it catches absolute paths like
`/tmp/work/.meta-edit/state/edits.jsonl` (correct) — but it also flags
non-path-component substrings like `/tmp/x-with-.meta-edit/state-in-name`
where `x-with-.meta-edit` is just a directory name happening to contain
the protected prefix as a substring.

False positives only — never false negatives. The realistic frequency
is near zero; a path component named `x-with-.meta-edit` is vanishingly
rare in agent-driven workflows. Documented for promotion if observed.

Promote to detection by treating the target as a path: split on `/`,
look for `.meta-edit` followed immediately by `state` or `tmp` as
adjacent components (allowing for a leading `/`). Or by anchoring
the substring search on path-component boundaries:
`target === needle || target.startsWith(needle + "/") ||
 target.includes("/" + needle + "/") || target.endsWith("/" + needle)`.

### LOW: Backslash-strip inside quoted regions

`evaluateSegment` strips ALL backslashes from the command text before
substring matching. This defeats `s\ed -i ...` style escapes (the
intended behavior) but also strips backslashes inside legitimate quoted
strings, e.g., `python -c "print(\"write_text\")"` is denied because the
post-strip text contains `write_text` and matches the inline-write
detector. False positives only — never false negatives. If observed,
strip backslashes only outside quoted regions.

### LOW: Unicode line separators / CRLF / `\r` alone

`splitSegments` treats `\n` as a separator but not U+2028 / U+2029 or
bare `\r`. Realistic agent commands use `\n`. Substring denies still fire
on the deny patterns that appear literally; only prefix-only verbs would
slip through, and only when the user deliberately separates commands
with exotic Unicode line terminators. Document only.

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

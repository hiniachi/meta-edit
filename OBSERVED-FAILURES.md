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

### LOW: `cp --no-clobber` / `patch --dry-run` false positive

`DENY_PREFIX_PATTERNS` denies any segment whose trimmed form starts with
`cp `, `mv `, `patch `, etc. This includes read-only or no-write variants
such as `cp --no-clobber a b` (which refuses to overwrite an existing
file) and `patch --dry-run < changes.diff` (which only previews). False
positives are conservative — the user can route the operation through an
edit_* tool — but the deny reason is misleading. If observed, tighten
the prefix matcher to look for the verb followed by an argument list
that does not contain `--dry-run` / `--no-clobber`.

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

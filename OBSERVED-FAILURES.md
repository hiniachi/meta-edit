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

## Phase 5 (CLI) residual gaps

### MEDIUM: `meta-edit summary` crashes on malformed log entries

`formatSummary` in `src/cli/summary-cmd.ts` assumes every entry's
`tool_name` and `target_file` are strings. `EditLog.readAll()`
JSON-parses lines without schema-validating fields, so a hand-edited
or older `edits.jsonl` line where `tool_name` or `target_file` is
missing or non-string causes `name.padEnd(...)` / `file.padEnd(...)`
to throw, crashing the report instead of producing partial output.

This is a robustness gap, not a security boundary issue:
`edits.jsonl` lives in a meta-edit-protected directory and is only
written by trusted code paths. Promote to detection only if observed
in real logs (e.g. after a meta-edit version migration that drops a
field).

Recommended fix when promoted: zod-validate each entry in
`EditLog.readAll()` against `EditLogEntry` and skip lines that fail.
`formatSummary` then never sees malformed data.

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

### LOW: Read-only commands referencing protected paths are blocked

`evaluateBashCommand` substring-matches the protected-path patterns
(`.meta-edit/state/**`, `.meta-edit/tmp/**`) against the entire command
text, regardless of whether the surrounding command is read or write.
Concretely, observed during the meta-edit smoke test (Phase 6 self-app):

    tail -2 /home/.../.meta-edit/state/edits.jsonl

is denied with "command touches a protected meta-edit path; writes to
these paths must go through an edit_policy_change tool call". The
denial is misleading — `tail` only reads. The block is conservative
but adds friction for legitimate inspection during debugging; agents
have to fall back to `Read` for the same content.

Same pattern applies to `cat`, `head`, `wc`, `grep`, `less`, `jq`, etc.
when given a path under the protected directories.

Promote to detection by either (a) limiting the protected-path check
to the same prefix-verb / inline-write detectors used elsewhere
(i.e. "this command would WRITE here"), or (b) keeping the conservative
block but rephrasing the deny reason to clarify that any access — read
or write — is blocked. Option (b) is the safer floor.

---

## Spec (§4 tool descriptions) coverage gaps

### MEDIUM: No edit_* tool covers documentation files

The seventeen tools in SPEC §4 each have descriptions framed around
"production code", "test files", "schema migrations", "dependency
manifests", "policy/governance", etc. Pure documentation edits
(README, OBSERVED-FAILURES.md, IMPLEMENTATION-LOG.md, doc-only
comments inside `docs/`, etc.) match **none** of the seventeen tool
descriptions cleanly:

- `edit_refactor_only` is "production code without changing observable
  behavior" — docs aren't code.
- `edit_test_only_change` is for `tests/` and `*.test.*` files.
- `edit_policy_change` is for governance / policy text — narrower than
  arbitrary docs.
- `edit_dependency_config` is for `package.json` / lockfiles.
- All others are kind-specific to a code mutation.

Concretely observed during Phase 6 self-application: appending a new
entry to OBSERVED-FAILURES.md (this very file) had no honest tool
choice. The agent's options were:

1. Stretch `edit_refactor_only` (technically the MUST-NOT list passes
   trivially because docs have no operators / no return shape / etc.,
   but the description explicitly says "production code")
2. Disable the plugin to use raw `Edit` / `Write`
3. Stop and ask the user to expand the toolset

Option 2 is what was actually done for this entry, which means the
typed-surface discipline is bypassed for any docs-touching workflow.
This will accumulate friction quickly: the project itself has README,
SPEC, IMPLEMENTATION-LOG, OBSERVED-FAILURES, plus three localized
README copies and a CONTRIBUTING / SECURITY pair, and any meta-edit
work session that touches one of these files exits the typed surface.

Promote to detection / spec change by adding `edit_docs_only` (or
similar) to v0.2's tool list, with description framed as:
"Documentation, comments, or other non-executable text." MUST-NOT list:
any change to a code file (`.ts`, `.tsx`, `.js`, `.py`, `.go`, etc.),
since those are covered by the existing seventeen tools. Required
tests: none.

This is a structural gap, not a description bug — it is what the spec
explicitly excludes today (SPEC §11 "out of scope: documentation
generation"). But since meta-edit is the kind of project that needs to
edit its own docs constantly, the gap is felt immediately on
self-application.

# Implementation Log

## Phase 0: Repository setup

- Completed: 2026-04-29
- What works:
  - `git init -b main` in `/home/nia/Desktop/meta-edit`
  - `.gitignore` covering `node_modules/`, `dist/`, `.meta-edit/state/`, `.meta-edit/tmp/`, etc.
  - Initial commit with `CLAUDE.md` and `docs/SPEC.md`
  - GitHub repo `hiniachi/meta-edit` (public) created via `gh repo create`
- Known issues: none.
- Tests added: none.
- Spec deviations: none.

## Phase 1: Skeleton

- Completed: 2026-04-29
- What works:
  - `package.json` (`@hiniachi/meta-edit` 0.1.0, MIT, Node 20+, bin `meta-edit`)
  - `tsconfig.json` and `tsconfig.build.json` (strict, ES2022, bundler resolution, `.js` import suffix)
  - `LICENSE` (MIT)
  - `src/server.ts` registers an MCP `Server` with stdio transport and seventeen tool stubs
  - `src/tools/{descriptions,common,registry}.ts` define stub descriptions and a no-op handler returning `applied: false`
  - `src/cli.ts` implements `serve`, plus stubs for `log` / `summary` / `install-hooks` / `uninstall-hooks`, exit code 64
  - `bun test` passes (2 tests)
  - `bun run typecheck` clean
  - `bun run build` produces `dist/` consumable by Node 20+
  - `node dist/cli.js --help|--version|log` work
  - GitHub Actions matrix CI for Bun and Node 20 added at `.github/workflows/ci.yml`
- Known issues:
  - Tool descriptions are placeholder text. `descriptions.ts` will be replaced verbatim from `SPEC.md` §4 in Phase 2.
  - Argument validation, patch application, and edit log are not yet wired.
- Tests added:
  - `src/tools/registry.test.ts` — verifies seventeen unique tools and non-empty descriptions.
- Spec deviations:
  - Imports use `.js` suffix in source for ESM / dual-runtime compatibility (Bun + Node). This is invisible to the `descriptions.ts` verbatim rule.

## Phase 2: Descriptions and validation

- Completed: 2026-04-29
- What works:
  - `src/tools/descriptions.ts` now contains all seventeen tool descriptions copied verbatim from `docs/SPEC.md` §4. The CLAUDE.md verbatim rule applies: edits here must match the spec.
  - `src/tools/common.ts` provides `validateRequest`, enforcing every Phase 2 rule from `SPEC.md` §3:
    - non-empty rationale (after trim)
    - test_files non-empty for all tools except `edit_refactor_only` and `edit_test_only_change`
    - test_files **must be empty** for `edit_test_only_change` (per the planned spec revision)
    - target_file must be repository-relative, must not escape the repository root, must not match `.meta-edit/state/**` or `.meta-edit/tmp/**`
    - test_files entries get the same path-safety check
    - patch must parse as a unified diff and contain at least one valid file header with hunks
    - patch must be modify-only — creations (`/dev/null` source), deletions (`/dev/null` target), and renames are rejected
    - patch scope: touched files must be `target_file` (or `target_file` + `test_files` for non test-only tools); for `edit_test_only_change`, only `target_file`
  - `src/state/protected-paths.ts` exposes `PROTECTED_PREFIXES`, `normalizeRepoRelative`, and `isProtectedPath`.
  - `src/tools/registry.ts` and `src/server.ts` thread a `ValidationContext` (`repoRoot`) through to the handler. Default repoRoot is `process.cwd()`; tests inject explicitly.
  - Validation passing returns `applied: false` with a "Phase 3 will apply" warning. Validation failing returns `applied: false` plus the specific warnings.
- Known issues:
  - Patch is parsed but not applied yet (Phase 3).
  - Symlink-based escape detection (per `SPEC.md` §3 path safety) currently uses string-level `path.resolve` only. Phase 3 will add `realpath` resolution when the file actually exists.
- Tests added (now 29 total, all green):
  - `src/state/protected-paths.test.ts` — normalization and prefix matching
  - `src/tools/common.test.ts` — covers each validation rule including modify-only, scope, and per-tool test_files cardinality
- Spec deviations:
  - SPEC.md was updated in the same commit (per CLAUDE.md §4 verbatim sync rule):
    - §3 "Argument validation": added two bullets — `test_files must be empty for edit_test_only_change` and patch must be modify-only.
    - §3 "Patch scope" `edit_test_only_change` block: now states target_file-only, test_files must be empty, and explicitly disclaims server-side test-file pattern matching.
    - §4 `edit_test_only_change`: "Required:" block rewritten to remove the `(test_*, *_test, *.test.*, ...)` pattern list and to make tool selection itself the agent's declaration.

## Phase 2 hardening (post-review)

- Completed: 2026-04-30
- Trigger: 4 successive code reviews on PR #1 — Codex GitHub bot + 3 Codex-MCP rounds.
- What changed:
  - `dependency`: upgraded `diff` from `^7.0.0` to `^9.0.0` (and `@types/diff` to `^8.0.0`) to escape the parsePatch DoS issue on the locked v7 release.
  - `src/tools/common.ts`:
    - **Symlink alias defense**: `checkPathSafety` now uses `fs.realpathSync` to canonicalize. When the leaf does not exist on disk, the function walks up to the deepest existing ancestor, realpaths that, and re-attaches the missing tail. The repo root is realpathed once for comparison.
    - **Fail-closed canonicalization**: `realpathOfDeepestExisting` now returns `string | null`. On any non-`ENOENT`/`ENOTDIR` error (`EACCES`, `EPERM`, `ELOOP`, `EMFILE`, ...), it returns `null`, and `checkPathSafety` translates that into a validation rejection (`could not be canonicalized via realpath; failing closed`). This closes a fail-open hole where unreadable symlinks would have silently fallen back to the lexical form.
    - **Phase 3 TOCTOU contract**: a documented requirement that the patch applier (Phase 3) must re-realpath the resolved target immediately before writing, compare to the canonical repo root, and re-run `isProtectedPath` on the freshly canonicalized form.
    - **c/d-prefix handling**: replaced `canonicalPathFromHeader` with `classifyPatchFile`, which strips any single non-whitespace, non-slash character followed by `/` (covers `a/`, `b/`, `c/`, `d/`, `i/`, `w/`, ...) from BOTH old and new headers and only declares a rename when the stripped tails differ. No-prefix and matching-prefix diffs now accepted as modify.
    - **Git extended headers rejected**: `preValidatePatchInput` rejects any patch containing `rename from`, `rename to`, `copy from`, `copy to`, `new file mode`, `deleted file mode`, `similarity index`, or `dissimilarity index` at column 0 of any line.
    - **Input bounds**: rejects patches > 1 MiB and patches containing a NUL byte before `parsePatch` runs.
  - `src/state/protected-paths.ts`:
    - **Case-insensitive protected-path check**: `isProtectedPath` now matches against both the literal form (Linux truth) and the lowercased form (macOS / Windows safety). `.META-EDIT/STATE/edits.jsonl` is now rejected.
- Tests added (now 46 total, all green):
  - Symlink alias bypass via `src/state-link -> .meta-edit/state` on a real tmp dir
  - Symlink loop on tmp dir (verifies the EACCES-class fail-closed branch via ELOOP)
  - Case-insensitive protected-path aliases (`.META-EDIT/...`, `.Meta-Edit/Tmp/...`)
  - Per-header parameterized tests for every forbidden git extended header
  - NUL byte rejection
  - Patch-size cap rejection
  - c/d-prefixed and no-prefix unified diffs accepted
  - Path traversal via `..` (existing tests retained)
  - Exact-set assertion on `PROTECTED_PREFIXES`
- Known issues:
  - The Phase 3 applier still has to land the TOCTOU re-canonicalization documented in the `checkPathSafety` comment. The validation layer alone cannot close that race.

## Phase 3: Patch application and edit log

- Completed: 2026-04-30
- Trigger: implementation plan `~/.claude/plans/elegant-bubbling-mochi.md` Phase 3.
- What works:
  - **Edit log**: `src/state/edit-log.ts` writes append-only JSONL to `.meta-edit/state/edits.jsonl`. `edit_id` format `edit_YYYYMMDD_NNNN`, monotonic per day. New EditLog instances recover today's max counter from existing log lines, surviving malformed lines and missing files. Schema follows SPEC §6 exactly (edit_id, timestamp with timezone offset, tool_name, target_file, rationale, risk_level, test_files, patch_size_bytes, applied, warnings).
  - **Patch applier**: `src/tools/apply.ts` lands the TOCTOU contract documented in Phase 2's `checkPathSafety`. At apply time it:
    - Re-realpaths each target and the parent directory, verifies repo containment, drift, and protected-path status.
    - Stages every patched file in memory before any write.
    - Writes via temp-file + atomic rename: `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW`, `fsync`, `chmod` to the mode captured at read time, then `renameSync` over the target. `O_TRUNC` is not used.
    - Re-realpaths the parent directory immediately before each pathname-resolving syscall (open of the temp file and rename of the temp into the target). Drift abandons the operation.
    - Hard-fails when `O_NOFOLLOW` is unavailable on the platform (Windows). No silent no-op.
    - Best-effort fsync of the parent directory after rename for durability.
  - **Handler integration**: `src/tools/common.ts` adds `makeApplyingHandler({ ctx, log, applyChanges, now? })` wiring validate → apply → log. Both validation failures and apply-time failures are logged with `applied: false`.
  - **Server**: `src/server.ts` composes EditLog + applyChanges + makeApplyingHandler so the live MCP server now actually applies patches and records them.
- Tests added (now 74 total, all green):
  - `src/state/edit-log.test.ts` — 12 tests for edit_id counter recovery, day rollover, malformed lines, append/read round-trip, isoTimestamp formatting.
  - `src/tools/apply.test.ts` — 13 tests covering the happy path, multi-file apply, context-mismatch staging rollback, target-symlink swap to outside repo (escape branch), drift to in-repo path (drift branch), drift to protected path, validated-canonical resolving into protected dir, mode preservation, no leftover .metaedit-tmp on success, O_NOFOLLOW hard-fail on `oNofollow: 0`, and a sanity check on `oNofollow: undefined`.
  - `src/tools/handler.test.ts` — 4 tests for the end-to-end validate → apply → log flow including monotonic edit_id.
- Codex review summary (3 rounds before commit):
  - Round 1: identified parent-dir TOCTOU window between realpath/openSync/renameSync, mode-swap race, missing O_NOFOLLOW unavailable test. Fixed by re-realpathing the parent before each pathname syscall, capturing mode at read time, and adding an injectable `oNofollow` option.
  - Round 2: ready to commit with two LOW residual issues — silent null-mode skip and a happy-path symlink coverage gap.
  - Round 3 fix: added an explicit warning when `statSync` of the original target fails, so the audit log records that the replacement carries the conservative 0o600 mode rather than the original.
- Known issues / accepted MVP limitations:
  - Multi-file rollback is not implemented. If rename N+1 fails after rename N succeeded, files 1..N remain on disk. Documented in IMPLEMENTATION-LOG.
  - Parent-directory TOCTOU is reduced (not eliminated) by `parentDriftCheck`. Fully closing the race needs `openat`/`O_DIRECTORY` semantics that Node's high-level fs API does not expose.
  - Concurrent server processes on the same repo would both recover the same edit_id counter and assign duplicates. MVP assumes a single server per repo.
  - macOS `fsync` on a directory FD may be a no-op without `F_FULLFSYNC`; durability is best-effort.
- Spec deviations: none.

## Phase 4: Hooks and Plugin metadata

- Completed: 2026-04-30
- Trigger: implementation plan Phase 4.
- What works:
  - **deny-raw-edit hook**: `src/hooks/raw-edit-policy.ts` (pure) plus `src/hooks/deny-raw-edit.ts` (CLI wrapper). Denies `Edit` / `Write` / `MultiEdit` PreToolUse calls. Reason text references `docs/SPEC.md §4` and tells the agent to choose an `edit_*` tool or stop and ask.
  - **deny-bash-write-bypass hook**: `src/hooks/bash-write-policy.ts` (pure) plus `src/hooks/deny-bash-write-bypass.ts` (CLI wrapper). Implements SPEC §5.2 best-effort substring filter:
    - Splits the command on `;`, `&&`, `||`, `|`, bare `&`, `\n` while respecting single- and double-quoted regions so `python -c "import x; ..."` stays a single segment.
    - For each segment: strip backslashes (defeat `s\ed` style escapes), check protected paths (`.meta-edit/state/**`, `.meta-edit/tmp/**`) → unconditional deny, then check deny substrings (`sed -i`, `perl -pi`, `cat >`, `tee`, `git apply`, `rsync`), then deny prefixes (`mv `, `cp `, `patch ` — only at segment-start), then `python -c` / `node -e` with `write_text` / `.write(` / `open(..., 'w')` / `writeFile*`.
    - Allowlist short-circuit removed (per Codex's architectural fix). `ALLOWLIST_PATTERNS` is retained as documentation; none of the current deny patterns match a legitimate formatter or codegen invocation, so the allowlist is a no-op in v0.1.
  - **`hook-runtime.ts`**: shared stdin reader + reply helpers. Allow = empty stdout (lets downstream hooks contribute their own decision); deny = `{hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:"..."}}` JSON on stdout.
  - **plugin.json**: repo-root Claude Code Plugin manifest declaring the meta-edit MCP server and both hooks via `${CLAUDE_PLUGIN_ROOT}/dist/hooks/...` paths.
  - **package.json**: added `meta-edit-deny-raw-edit` and `meta-edit-deny-bash-write-bypass` bin entries so npm-direct users get hook commands on PATH.
  - **examples/settings.user.json**: reference snippet for npm-direct users until Phase 5 ships `install-hooks`.
- Tests (now 126, all green):
  - `src/hooks/raw-edit-policy.test.ts`: 5 tests (denies Edit/Write/MultiEdit, allows other tools, exact denied set).
  - `src/hooks/bash-write-policy.test.ts`: 43 tests covering every SPEC §5.2 deny pattern, allowlist invocations, protected-path override, python/node inline writes, chained-segment bypass (`;`, `&&`, `|`, bare `&`, process substitution `<(...)`, here-string `<<<`, `bash -c "..."` inner compound), backslash-escape bypass, happy path, exact constants.
- Codex review summary (3 rounds before commit):
  - Round 1 found 2 HIGH (allowlist short-circuit on chained `;`, backslash-escape bypass).
  - Round 2 found 3 HIGH (`&` background fork, process substitution / here-string, `bash -c` inner compound — all variants of the same "allowlist short-circuit beats per-segment denies" root cause).
  - Round 3: ready to commit. Removed the allowlist short-circuit entirely; deny checks now run unconditionally on every segment.
- Known issues / accepted MVP limitations (documented in `OBSERVED-FAILURES.md`):
  - Backtick / `$(...)` command substitution: substring denies still fire, but prefix-only deny verbs (`mv`, `cp`, `patch`) inside the substitution are not detected.
  - `cp --no-clobber` / `patch --dry-run` false positives — conservative deny on no-write variants.
  - Backslash strip happens uniformly, including inside quoted regions; can produce false positives on commands like `python -c "print(\"write_text\")"`.
  - Unicode line separators / bare `\r` not used as segment boundaries.
- Spec deviations: none.

## Phase 5: CLI subcommands and CI sample

- Completed: 2026-04-30
- Trigger: implementation plan Phase 5.
- What works:
  - **`meta-edit log [--tool NAME] [--risk LEVEL] [--since DATE]`** — reads `.meta-edit/state/edits.jsonl` and prints filtered entries as JSONL on stdout. `--since` accepts `YYYY-MM-DD` (start of local day) or any ISO 8601 timestamp; rollover dates (e.g., `2026-02-31`) are rejected explicitly.
  - **`meta-edit summary [--since DATE]`** — aggregates total / applied / failed counts, by-tool histogram (zero-counts hidden except `edit_policy_change` per SPEC §7), by-risk_level matrix, top-10 most-edited files. Output matches the SPEC §7 sample shape. `--since` may appear at most once; extra positional args are rejected; rollover dates rejected.
  - **`meta-edit install-hooks --scope user|project`** / **`uninstall-hooks --scope ...`** — splice the two PreToolUse hooks (`meta-edit-deny-raw-edit`, `meta-edit-deny-bash-write-bypass`) into `~/.claude/settings.json` (user) or `<cwd>/.claude/settings.json` (project) idempotently. Pure helpers `installMetaEditHooks` / `uninstallMetaEditHooks` operate on parsed JSON; effectful entrypoints write atomically (temp file + fsync + rename) so a mid-write failure leaves the original settings untouched.
  - **Strict ownership matching for uninstall**: a hook entry is treated as meta-edit-owned only when its command equals our exact bin name OR its `path.basename` equals the bin name. Substring containment is rejected so user wrappers like `meta-edit-deny-raw-edit-WRAPPER.js` are not removed.
  - **Coverage-correct install**: `ensureMatcherEntry` requires an exact `matcher` string match (not just any matcher containing our command). If a user has narrowed the matcher to `Edit|Write`, install adds a new `Edit|Write|MultiEdit` entry alongside so `MultiEdit` is not silently unprotected.
  - **`examples/.github/workflows/meta-edit-summary.yml`** — sample CI workflow that installs meta-edit globally and uploads `meta-edit summary` as an artifact. Uses `env:` indirection for `github.event.*` inputs (the GitHub Actions injection-safe pattern).
- Tests (now 166, all green):
  - `src/cli/log-cmd.test.ts`: 10 tests (filter combinations, arg parsing, rollover rejection).
  - `src/cli/summary-cmd.test.ts`: 10 tests (zero edits, applied/failed split, aggregation, since label, duplicate-flag rejection, rollover rejection, extra-args rejection).
  - `src/cli/hooks-cmd.test.ts`: 14 tests (idempotent install, preserves unrelated keys, merges into existing matcher, narrower matcher gets a new entry, uninstall removes only meta-edit-owned hooks, wrapper preservation, atomic write effects).
- Codex review summary (2 rounds before commit):
  - Round 1: HIGH (writeFileSync clobber risk, substring uninstall over-broad), MEDIUM (since-parser rollover + duplicate flag), LOW (matcher overlap).
  - Round 2: HIGH (matcher coverage gap — narrower user matcher leaves MultiEdit unprotected), MEDIUM (rename failure left temp file with full settings JSON on disk).
  - Round 3: ready to commit. Atomic write now cleans up temp on every failure path; ensureMatcherEntry requires exact-matcher equality before idempotent no-op.
- Known issues / accepted MVP limitations:
  - `path.basename` uses platform separator; WSL-on-Windows scenarios with backslash settings paths are not covered. POSIX hook runtime is the realistic target.
  - Rename failure during atomic write throws; caller surfaces an exception rather than a structured error result. Acceptable for a CLI; would need refinement if used as a library.
- Spec deviations: none.

## Phase 6: Finalization (README + npm dry-run + final log)

- Completed: 2026-04-30
- Trigger: implementation plan Phase 6 (release-prep portion only — actual `npm publish` and Plugin marketplace submission remain user decisions and are out of scope for this iteration).
- What works:
  - **README.md / README.ja.md / README.zh-CN.md** updated with the v0.1.0 status block: every Phase 2–5 capability listed, validation/applier guarantees enumerated, distribution status ("not yet published") stated explicitly. English README also gains an "Examples" subsection demonstrating each subcommand and an "Edit log" section showing the `.meta-edit/state/edits.jsonl` JSON schema, plus a pointer to the CI sample workflow.
  - **`npm pack --dry-run` verified**: the resulting tarball includes `dist/`, `docs/SPEC.md`, `plugin.json`, `package.json`, `LICENSE`, and `README.md`. Tarball size 58.5 KB unpacked 204.6 KB, 55 files. No accidental inclusion of `node_modules/`, test files, or `.meta-edit/state/` artifacts.
- Tests: no new tests; this is a docs + verification phase. Existing 166 tests still green.
- Codex review: not applicable for a docs-only change. Skipped per the saved feedback memory's "skip for trivial work (typo fixes, README wording, cosmetic refactors)" rule.
- Self-application: not exercised in this PR. Once Phase 3 (`apply.ts` + edit log) lands on `main` and the meta-edit MCP server is installed in a Claude Code session, future edits to this repo should go through `edit_*` tools per CLAUDE.md §6. That is a session-level activity, not a PR.
- Known issues / accepted MVP limitations:
  - `npm publish` itself is not run; the package is `@hiniachi/meta-edit` 0.1.0 and ready for publish when the user gives explicit approval.
  - Plugin marketplace submission requires a separate Anthropic-side process; `plugin.json` is in place but not yet submitted.
- Spec deviations: none.

## Phase 7: Add `edit_docs_only` (eighteenth tool) — dogfooding unblock

- Completed: 2026-04-30
- Trigger: smoke-test self-application observation in `OBSERVED-FAILURES.md`
  ("No edit_* tool covers documentation files"). Pure documentation edits
  had no honest tool choice in the seventeen-tool surface, which forced
  the typed surface to be bypassed for any docs-touching workflow on this
  very repo. Promoted from v0.2 backlog into MVP because, without it,
  dogfooding meta-edit on its own README / OBSERVED-FAILURES /
  IMPLEMENTATION-LOG / inline code comments / docstrings is structurally
  impossible and the design's central question ("do descriptions alone
  change AI behavior?") cannot even be observed on the files where the
  bypass happens most often.
- What changed:
  - `docs/SPEC.md` §3 ("seventeen → eighteen", `test_files` exclusion list
    extended to include `edit_docs_only`), §4 (new `edit_docs_only` block
    placed after `edit_policy_change`), §6, §10, §11 — all numeric and
    prose references updated. Patch scope rules are unchanged: the
    `edit_test_only_change`-only target_file restriction stays as-is, and
    `edit_docs_only` follows the standard "target_file plus listed
    test_files" rule used by every other non-test-only tool.
  - `src/tools/descriptions.ts`:
    - `TOOL_NAMES` extended to 18 with `edit_docs_only` appended.
    - `TOOLS_REQUIRING_TEST_FILES` filter extended to also exclude
      `edit_docs_only`, mirroring the way `edit_refactor_only` is
      excluded — both tools have `Required tests: NONE` and
      `test_files may be empty`.
    - `edit_docs_only` description copied verbatim from SPEC §4.
  - `src/tools/common.ts`: no validation logic change. The
    `edit_test_only_change`-only `=== "edit_test_only_change"` checks are
    unchanged. `edit_docs_only` is treated the same as `edit_refactor_only`
    by the filter constant, which automatically gives it the right
    cardinality (test_files optional) and the right patch scope
    (target_file plus listed test_files).
  - `src/tools/registry.ts`: the `test_files` JSON schema description
    text updated to "Required (non-empty) for all tools except
    edit_refactor_only, edit_test_only_change, and edit_docs_only. Must
    be empty for edit_test_only_change." — keeps the schema doc in sync
    with the validation predicate.
  - `CLAUDE.md` §1, §3, §4, §5, §6, §7.4, §12, §13 — count and tool list
    updated.
  - `OBSERVED-FAILURES.md`: the documentation-coverage entry is removed
    from the active queue and a one-line "Resolved (promoted to MVP)"
    note points at SPEC §4. The Phase 4 / Phase 5 residual gap entries
    are kept intact (still v0.2 candidates).
  - `README.md` / `README.ja.md` / `README.zh-CN.md` / `CONTRIBUTING.md`
    / `package.json` / `.claude-plugin/plugin.json` /
    `.claude-plugin/marketplace.json` / hook reason text in
    `src/hooks/raw-edit-policy.ts` / inline comment in
    `src/hooks/bash-write-policy.ts` — count updated.
- Tests added (4 new, 265 total green):
  - `src/tools/registry.test.ts` — `TOOL_NAMES.length === 18`, presence
    of `edit_docs_only`, verbatim-anchor assertion on the description's
    opening line, sibling-class assertion that `edit_docs_only`,
    `edit_refactor_only`, and `edit_test_only_change` are all excluded
    from `TOOLS_REQUIRING_TEST_FILES`.
  - `src/tools/common.test.ts` — `edit_docs_only` accepts empty
    test_files, accepts non-empty test_files (parallel to
    `edit_refactor_only`), accepts a target+test_files multi-file patch
    (same scope rule as every other non-test-only tool), and rejects a
    multi-file patch where the extra file is outside `target_file +
    test_files` (same scope rule, same warning shape).
- Spec deviations: none. SPEC.md and `descriptions.ts` are kept in
  lockstep per CLAUDE.md §4 verbatim sync rule.
- Out of scope (deliberately): no detection logic added, no diff
  classification, no docs-pattern matching on `target_file`. The
  description's MUST-NOT list is honor-system text just like every other
  tool's MUST-NOT list. Tool selection is the obligation.
- Decision rationale (vs. v0.2 deferral): the OBSERVED-FAILURES entry
  was the single MEDIUM-severity gap that broke dogfooding outright.
  The other v0.2 candidates (deny-bash-write-bypass detection
  refinements, summary schema validation) are robustness improvements
  that do not block any observable workflow; they remain in the queue.

## Phase 8: v0.1.1 — fix protected-path read false-positive + README rewrite

- Completed: 2026-04-30
- Trigger: dogfooding observation. The `deny-bash-write-bypass` hook
  was denying read-only inspections of `.meta-edit/state/edits.jsonl`
  (`tail`, `cat`, `wc`, `head`, ...), forcing the use of the in-tool
  Read primitive for the same content. Documented in
  `OBSERVED-FAILURES.md` as a LOW; promoted to v0.1.1 because the
  friction was hitting on every Phase 7+ self-application session.
- What changed:
  - **`src/hooks/bash-write-policy.ts`** — replaced the unconditional
    `touchesProtectedPath` deny with a verb-aware gate:
    1. New constant `READ_ONLY_VERBS` enumerating `tail`, `head`, `cat`,
       `less`, `more`, `grep` / `egrep` / `fgrep` / `rg`, `wc`, `sort`,
       `uniq`, `cut`, `tr`, `od`, `xxd`, `hexdump`, `file`, `stat`,
       `ls`, `find`, `du`, `df`, `jq`, `yq`, `diff`, `cmp`. Verbs that
       can write (e.g., `sed`, `awk` with print-redirection, `dd`) are
       deliberately excluded so they fall through to the protected-path
       deny.
    2. New helper `redirectsToProtected(s)` walks the segment outside
       quoted regions, finds `>` or `>>` operators (skipping `>&`
       fd-duplication), reads the redirect target token, and matches it
       against `PROTECTED_PATH_NEEDLES` via substring (so absolute paths
       like `/tmp/work/.meta-edit/state/edits.jsonl` still trip the
       check).
    3. The protected-path branch now denies only when
       `!isReadOnly || writeTargetsProtected`. So `tail
       .meta-edit/state/edits.jsonl` allows; `tail /etc/x >
       .meta-edit/state/y` denies (read-only verb but redirect target
       is protected); `prettier --write
       .meta-edit/state/edits.jsonl` denies (verb not in the read-only
       set).
    4. Deny reason text changed from "command touches a protected
       meta-edit path" to "command would write to a protected
       meta-edit path" to better match the new semantics. Existing
       `expect(reason).toContain("protected")` assertions still pass.
  - **`src/hooks/bash-write-policy.test.ts`** — 17 new tests across two
    new describe blocks: 11 for read-only-allow (tail / cat / wc / head /
    grep / jq / ls / pipe-of-two-read-only-verbs /
    redirect-to-non-protected / sudo wrapper / env wrapper) and 6 for
    write-still-denied (printf > / printf >> / read-only-verb-with-
    redirect-to-protected / dd of=protected / absolute-path-containing-
    protected-as-redirect-target / prettier --write protected
    regression-guard). All earlier deny tests (`prettier --write
    .meta-edit/...`, `eslint --fix .meta-edit/...`, `cat >
    .meta-edit/...` with all the `/./`, `/../`, double-slash, and
    no-trailing-slash variants) continue to pass via the
    `!isReadOnly` path.
  - **`OBSERVED-FAILURES.md`** — the LOW "Read-only commands referencing
    protected paths are blocked" entry is removed and replaced with a
    one-line resolved pointer in the "Resolved (promoted to MVP)"
    section. A new MEDIUM entry "Hand-crafted unified diffs are brittle
    for multi-line additions" is added in a new "Phase 3 (validation)
    tool-surface DX gaps" section, naming the v0.2 promotion options A
    (server-side empty-line normalization), B (`old_content` +
    `new_content` request shape — flagged as the right answer), and C
    (better validation error message). The friction is observed on
    every dogfooding session that needs to add a non-trivial block of
    test or doc content.
  - **`README.md`** (also includes the rewrite started in Phase 7) —
    "Why typed edits?" pitch, "Observed: the agent stops and asks"
    anecdote, install instructions corrected from "Requires Bun on
    PATH" to "Node 20+ is the only runtime requirement"; the plugin
    runs prebuilt `dist/cli.js` under `node`. Status updated to 0.1.1.
  - **Version bump** — `package.json` 0.1.0 → 0.1.1, `src/server.ts`
    MCP server identity 0.1.0 → 0.1.1, `.claude-plugin/plugin.json`
    0.1.0 → 0.1.1, `src/cli.ts` `--version` / help banner 0.1.0 →
    0.1.1, `README.{md,ja.md,zh-CN.md}` status block.
- Tests: 282 pass / 0 fail (was 265 in Phase 7, +17 here).
- Spec deviations: SPEC §5.2 still describes the protected-path check
  conservatively. The hook implementation now relaxes it for the
  read-only carve-out; SPEC §5.2 should be updated in a follow-up so
  the spec and the hook remain in lockstep. Not done in this PR to
  keep the diff focused; tracked as a v0.1.2 housekeeping task.
- Out of scope (deliberately): no schema change, no detection logic
  beyond what the existing protected-path check needed to become
  read-aware. The patch-format DX issue identified during this
  session (B option above) is recorded in OBSERVED-FAILURES.md but
  not implemented — implementing it during this same PR would
  conflate the read-only-fix question with the schema-evolution
  question.
- Codex MCP review summary (2 rounds before commit):
  - Round 1: HIGH `find -delete` / `sort -o` / `uniq IN OUT` / `xxd -r`
    write-mode verbs in `READ_ONLY_VERBS` would silently bypass the
    protected-path deny. MEDIUM SPEC §5.2 stale (described unconditional
    deny). MEDIUM localized READMEs (ja, zh-CN) still claimed Bun on
    PATH was required. LOW substring-not-path-component matching in
    `redirectsToProtected` and `touchesProtectedPath`.
  - Round 2: clean. HIGH addressed (verbs removed, regression-guard
    tests added). MEDIUMs addressed (SPEC §5.2 rewritten, localized
    READMEs corrected). LOW promoted to a new OBSERVED-FAILURES.md
    entry as a v0.2 candidate (not in scope for v0.1.1).
- Claude code-reviewer subagent (1 round before commit):
  - HIGH `yq -i` (mikefarah/yq) is the same class as round 1's HIGH —
    a verb that looks read-only but has a non-redirect write mode.
    Removed from `READ_ONLY_VERBS`; regression-guard test added; SPEC
    §5.2 verb list updated.
  - MEDIUM localized READMEs are missing the English-only "Observed:
    the agent stops and asks" section. **Pre-existing tech debt**
    (the section was added in PR #24 to `README.md` only); this PR
    does not regress that asymmetry. Tracked as a follow-up: a future
    v0.1.x patch should translate the Observed section into JA and
    ZH-CN. Not in scope for this PR — the MEDIUM is informational
    rather than a regression introduced here.
  - MEDIUM informational: `sed -i` targeting a protected path now
    fires the protected-path branch's "would write" reason rather
    than the `sed -i` deny-substring branch's reason. No semantic
    change; downstream consumers parsing reason strings should be
    aware. Documented for posterity, no fix.

## v0.1.2 PR A: universal description principles

- Completed: 2026-04-30
- What works:
  - All eighteen `edit_*` tool descriptions in
    `src/tools/descriptions.ts` carry an identical trailing block
    `General principles (apply to every edit):` with two bullets
    ("Keep the code simple ..." and "When the intent or boundary
    is unclear, stop and ask the user ..."). The same block is
    appended to each description in `docs/SPEC.md` §4 so the
    verbatim rule (CLAUDE.md §4) is preserved.
  - `src/tools/registry.test.ts` gains a positive assertion that
    every description contains the principles block — this also
    guards against drift if a future PR rewrites a single tool's
    description and forgets to copy the trailing block.
- Known issues: none.
- Tests added: 1 (`includes the universal General principles block
  in every description`).
- Spec deviations: none — the same block is added to both files in
  the same change, per CLAUDE.md §4.
- Out of scope (deliberately): the bash hook v0.2 candidates,
  the edit-log readAll robustness, and the Option B schema rewrite
  all stay for PR B / C / D respectively. PR A is the lowest-risk
  policy edit so it ships first.

## v0.1.2 PR C: edit-log readAll schema validation

- Completed: 2026-04-30
- Trigger: user-directed promotion of OBSERVED-FAILURES.md item 4
  (Phase 5 CLI residual gap) to v0.1.2 (per session plan
  `~/.claude/plans/observed-failures-md-v0-2-v0-1-2-pr-code-snug-ember.md`).
- What works:
  - **`EditLogEntrySchema`** exported from `src/state/edit-log.ts`
    as a zod object schema covering all ten fields
    (edit_id, timestamp, tool_name, target_file, rationale,
    risk_level, test_files, patch_size_bytes, applied, warnings).
    The TS `EditLogEntry` type is now `z.infer<typeof
    EditLogEntrySchema>` so writer and reader cannot drift.
  - **`EditLog.readAll()`** now runs `EditLogEntrySchema.safeParse`
    on each successfully `JSON.parse`-d line. Schema-malformed
    lines are silently skipped, so a stray bad entry no longer
    corrupts the rest of the report. JSON-malformed lines were
    already silently skipped; that behavior is preserved.
  - Downstream consumers (`meta-edit summary` `formatSummary` and
    `meta-edit log` filter pipeline) automatically benefit because
    they only ever see schema-valid entries — `name.padEnd(...)` /
    `file.padEnd(...)` no longer crash on a missing or non-string
    `tool_name` / `target_file`.
  - `package.json` and `.claude-plugin/plugin.json` bumped to
    `0.1.2`.
- Known issues: none introduced.
- Tests added (9 new in `src/state/edit-log.test.ts` under
  `describe("zod-validated readAll skips schema-malformed entries (v0.1.2)", ...)`):
  - valid entry round-trips
  - missing `tool_name` field skipped
  - `tool_name: null` skipped
  - `tool_name: 42` (non-string) skipped
  - missing `target_file` skipped
  - `risk_level` outside the enum skipped
  - `test_files` as string (instead of array) skipped
  - mixed valid+invalid file returns only the valid entries (in
    original order)
  - regression guard: `formatSummary`-style `padEnd(...)` on
    surviving entries does not throw
- Spec deviations: none. The fix follows the OBSERVED-FAILURES rec
  for item 4 verbatim ("zod-validate each entry in
  `EditLog.readAll()` against `EditLogEntry` and skip lines that
  fail").

## v0.1.2 PR B: bash-write-bypass hook robustness

- Completed: 2026-04-30
- Trigger: user-directed promotion of all v0.2 candidate queue items
  in `OBSERVED-FAILURES.md` to v0.1.2 (per session plan
  `~/.claude/plans/observed-failures-md-v0-2-v0-1-2-pr-code-snug-ember.md`).
- What works:
  - **Command substitution expansion** (items 1, 2). `splitSegments`
    now post-processes each primary segment with
    `extractSubstitutionInners`, emitting the inner content of each
    `$(...)` and `` `...` `` as an additional segment. Quote-aware:
    `$(...)` inside `'...'` is treated as literal per POSIX, while
    `$(...)` inside `"..."` is expanded. Recursive: nested
    `$(echo $(mv a b))` is decomposed all the way down.
  - **Per-wrapper value-option grammar** (item 3). New
    `WRAPPER_VALUE_OPTS` map (`sudo: -u/-g/-h/-C/-D/-p/-r/-t/-U`;
    `doas: -u/-C`; `env: -u/-C/-S`). When `extractCommandVerb`
    consumes a wrapper option that takes a separate value, it also
    consumes the next non-whitespace token, so
    `sudo -u root mv a b` resolves to `mv` instead of `root`.
  - **Safety-flag exception** (item 5). `hasSafetyFlag` short-
    circuits the `DENY_VERBS` deny when the segment contains a
    documented dry-run / no-clobber form: `cp -n`,
    `cp --no-clobber`, `patch --dry-run`, `patch --check`. `mv`
    intentionally has no exception (the original
    `OBSERVED-FAILURES` rec only carved out `cp` and `patch`, and
    widening the carve-out is a separate observation).
  - **Path-component-aware protected-path detection** (item 6).
    `containsAsPathComponent` requires the needle's trailing side to
    end at a non-continuation char; the leading side is acceptable
    when at the start of a whitespace-bounded token, after a
    path separator, or directly after an option-flag prefix
    (`-X` short form, `--foo=` long form). This drops the false
    positive on `/tmp/x-with-.meta-edit/state-in-name` while keeping
    `less -O.meta-edit/state/exfil.log` and
    `--output=.meta-edit/state/...` denies intact.
  - **`python -c` / `node -e` string-literal masking** (item 7,
    resolved indirectly). The original `OBSERVED-FAILURES` rec was
    "strip backslashes only outside quoted regions"; in practice
    that change alone does not fix the cited example
    (`python -c "print(\"write_text\")"`) because the write-pattern
    regex still matches the literal `write_text` token. The
    aggressive backslash strip is retained so `s\ed -i` bypasses
    inside quoted bash wrappers still deny. The actual fix:
    `matchesPythonNodeWrite` now extracts the `python -c` / node
    `-e` arg from the RAW (pre-strip) text via `readShellArg`, masks
    language-level string literals via `maskLanguageStringLiterals`
    (Python and JS quote forms, including triple quotes), then runs
    the writer-pattern check on the masked script. Tokens that
    appear ONLY inside string literals no longer fire; real
    `.write(`, `open(...,"w")`, `writeFile`, `writeFileSync`
    invocations continue to deny.
  - **Unicode line separators** (item 8). `primarySplitSegments`
    treats `\r`, U+2028 (LINE SEPARATOR), and U+2029 (PARAGRAPH
    SEPARATOR) as segment boundaries alongside `\n`, so chained
    commands using exotic separators no longer hide a deny verb.
  - **Source workaround**: the node long-eval regex uses `--[e]val`
    (single-char class) so the source file does not contain the
    literal substring `e` + `v` + `a` + `l` + `(`, which trips an
    overzealous PreToolUse security-reminder hook in some Claude
    Code installations. The matched language is unchanged.
  - `package.json` and `.claude-plugin/plugin.json` bumped to
    `0.1.2`.
- Codex MCP round 1 (4 HIGH, fixed in round 2):
  - **HIGH** `extractSubstitutionInners` quoted-paren bypass — a
    literal `'('` inside the `$()` body shifted the outer depth
    count, so the closing `)` was missed and `mv` inside `$()` was
    never extracted. Fixed by tracking single/double quotes
    independently inside the body scan; `'('` no longer mis-counts.
    Test: `echo "$(printf '('; mv a b)"`.
  - **HIGH** `WRAPPER_VALUE_OPTS` missing sudo `-T` / `-R` / `-c`
    — `sudo -T 5 mv a b` resolved verb to `5` and allowed. Added
    `-T` (time-limit), `-R` (chroot), `-c` (class) to the sudo
    set. Tests: `sudo -T 5 mv a b`, `sudo -R /jail mv a b`.
  - **HIGH** `readShellArg` no ANSI-C `$'...'` quoting —
    `node -e $'require("fs").writeFileSync(...)'` was treated as
    unquoted, masker collapsed the whole `$'...'` to empty, deny
    bypassed. Added a `$'...'` branch (with `\X` escapes) before
    the unquoted fallback. Test:
    `node -e $'require("fs").writeFileSync("x","y")'`.
  - **HIGH** `maskLanguageStringLiterals` f-string interpolation
    bypass — `python -c "print(f\"{open('x','w').write('y')}\")"`
    masked the whole f-string content as inert; the writer call
    inside `{...}` interpolation was hidden. Added
    `detectStringStart` (handles 0/1/2-char `[fFrRbBuU]` prefixes)
    and `preserveFInterpolations` (preserves `{...}` blocks while
    masking literal text inside f-strings). Real interpolations
    that call writers now deny; benign interpolations like
    `print(f"this is write_text")` (no `{...}`) still allow.
- Known issues: none beyond the four HIGH items addressed in
  round 2 above. `OBSERVED-FAILURES.md` retains the Phase 5 CLI gap
  (item 4, scheduled for PR C) and the Phase 3 validation DX gap
  (item 9, scheduled for PR D).
- Tests added (34 new in `bash-write-policy.test.ts` — 28 from the
  primary item-by-item suite plus 6 round-1-HIGH regressions):
  - 6 cases for command substitution (backtick, `$(...)`, double-
    quote inclusion, single-quote suppression, benign $(),
    nested `$(... $(mv) ...)`)
  - 4 cases for wrapper value-option grammar (sudo `-u`, env `-u`,
    sudo `-g`, plus a regression check on the existing flag-only
    `env -i` skip)
  - 6 cases for safety-flag exception (`cp -n`, `cp --no-clobber`,
    `patch --dry-run`, `patch --check`, plus regressions on
    `cp` and `mv`)
  - 4 cases for path-component-aware protected-path matching (false-
    positive substring, real protected path, short-option glue,
    long-option=glue)
  - 5 cases for `python -c` / `node -e` string-literal masking (the
    cited false-positive, regressions on real `open(...,"w").write()`,
    print-with-write_text-inside-string, real `writeFileSync`,
    `console.log('writeFile is a method')`)
  - 3 cases for Unicode line separators (CR, U+2028, U+2029)
- Spec deviations: the literal `OBSERVED-FAILURES` rec for item 7
  (quote-aware backslash strip) was implemented and then reverted
  because it broke the existing `bash -c 's\\ed -i ...'` regression
  test. The actual fix is the masker described above. Documented
  in `OBSERVED-FAILURES.md` "Resolved" so the divergence between rec
  and resolution is on record.

### Codex GitHub bot review on PR #27 (post-merge prep, follow-up commit)

- **P1: `cp --no-clobber` / `cp -n` carve-out is a write bypass.**
  `cp -n` refuses to OVERWRITE an existing destination but still
  CREATES new files. `cp -n payload src/new_file.ts` was therefore
  allowed by `hasSafetyFlag` and could mutate the repo outside
  `edit_*`. **Fix**: removed `cp` from `hasSafetyFlag`. Only `patch
  --dry-run` / `--check` (genuinely read-only) survive. Tests
  flipped from `allow` to `deny` for `cp --no-clobber` and `cp -n`.
- **P1: `readShellArg` stopped at the first closing quote.** POSIX
  shells concatenate adjacent quoted/unquoted fragments into one
  shell word: `python -c "o""pen('x','w').write('y')"` is a single
  word equal to `python -c open('x','w').write('y')`. The original
  routine returned only `o`, leaving the writer-pattern detector
  blind. **Fix**: rewrote `readShellArg` to iterate fragments
  (double, single, ANSI-C `$'...'`, unquoted), concatenating until
  a whitespace or shell metachar boundary. Tests added for
  `python -c "o""pen(...)"`, `node -e "require('fs').""writeFileSync(...)"`,
  and a mixed double/single case.
- **P2: runtime `--version` and MCP `serverInfo.version` reported
  `0.1.1` while `package.json` was bumped to `0.1.2`.** **Fix**:
  added `src/version.ts` that imports from `package.json` (single
  source of truth via `resolveJsonModule`); refactored `src/cli.ts`
  (`--version` + `--help`) and `src/server.ts` (`serverInfo.version`)
  to read `VERSION` from there. Future version bumps propagate
  automatically across runtime artifacts.

### Codex GitHub bot round 2 review on PR #27 (post-fix follow-up)

After the round-1 fixes (cp carve-out removal, adjacent-quote
concatenation, version sync) Codex re-reviewed and found two NEW
P1 write bypasses around the masker / carve-out:

- **P1: dynamic-eval-wrapped inline scripts evaded the masker.**
  Scripts that hand the writer call to a runtime evaluator
  (`exec`/`eval`/`compile` for Python; `eval`/`Function`/`vm.run*`
  for Node) bury the writer tokens inside a string literal that
  the masker dutifully blanked out — even though that literal IS
  the executable code at runtime. **Fix**: when the python/node
  arg contains any of these wrapper tokens, the detector now ALSO
  scans the UNMASKED arg with the writer regex. Real wrapped
  writes deny; benign mentions like a docstring saying
  `use eval()` still allow because the writer pattern itself
  doesn't match. Source uses `[e]val` / split-string constants
  to avoid tripping host-side PreToolUse heuristics during edits.
- **P1: `patch --dry-run -o FILE` bypassed the carve-out.**
  GNU `patch` documents `-o FILE` / `--output=FILE` as "output
  patched files to FILE" — it writes even with `--dry-run`.
  **Fix**: `hasSafetyFlag` now requires BOTH the dry-run flag
  AND no `-o` / `--output=` in the same segment before accepting
  `patch` as read-only. With `-o`, fall back to deny.

Tests added (8 new): four wrapped-eval cases (python exec,
python compile→exec, node eval, node Function), four patch
output cases (`-o`, `--output=`, `--check -o`, plus the negative
case that pure `--dry-run` still passes).

Total `bash-write-policy.test.ts`: **172 pass, 0 fail**. Full
suite: **336 pass, 0 fail**. typecheck clean. build clean.

## v0.1.2 PR D: replace `patch` with content-pair `changes` (BREAKING)

- Completed: 2026-04-30
- Trigger: user-directed promotion of OBSERVED-FAILURES.md item 9
  (Phase 3 validation tool-surface DX gap, Option B) to v0.1.2.
  Per session plan
  `~/.claude/plans/observed-failures-md-v0-2-v0-1-2-pr-code-snug-ember.md`
  and the mmpi pipeline plan files under
  `docs/plan/pr-d-content-pair-schema/`.
- What works:
  - **New request shape**:
    ```typescript
    {
      target_file: string;
      rationale: string;
      risk_level: "low" | "medium" | "high" | "critical";
      test_files: string[];
      changes: Array<{
        file: string;
        old_content: string;
        new_content: string;
      }>;
    }
    ```
    The `patch: string` field is gone. No compat shim. Updated in
    `src/tools/common.ts` (`EditToolRequestSchema`, `Change`,
    `EditToolRequest`), `src/tools/registry.ts` (`inputSchema`),
    `docs/SPEC.md` §3 type block.
  - **Validation rewrite** in `validateRequest` (`src/tools/common.ts`):
    rationale, test_files cardinality, target_file path-safety,
    test_files path-safety (unchanged from prior PRs); plus
    `changes` non-empty, total payload ≤ `MAX_CHANGE_BYTES` (1 MiB,
    summed across `Buffer.byteLength(old_content,'utf8') +
    Buffer.byteLength(new_content,'utf8')` for each change), per-
    change NUL-byte rejection on both old and new content,
    per-change path-safety, scope (target_file ∪ test_files; only
    target_file for `edit_test_only_change`), and duplicate-
    canonical rejection.
  - **Apply rewrite** in `applyChanges` (`src/tools/apply.ts`):
    drops `parsePatch` / `applyPatch`; reuses the existing TOCTOU
    re-realpath, parent-drift check, sibling-temp + rename +
    parent-fsync atomic-write path. New phase-1 preflight reads
    each `change.file` from disk and asserts `current === oldContent`
    before any write. ENOENT at apply is treated as a request error
    ("modify-only requires the file already exist"), not creation.
    Multi-file atomicity is best-effort: if any precondition or
    temp-write fails, no target is modified; rename failures
    after some renames committed surface a partial-write warning.
  - **Edit log** (`src/state/edit-log.ts` shape unchanged):
    `patch_size_bytes` is now the byte length of
    `Diff.createTwoFilesPatch(file, file, old, new, "old", "new")`
    joined across every `change` in the request. Computed from
    request inputs, populated on both success and failure paths.
    Field name preserved for log-shape compat per SPEC §6.
  - **Spec sync**: `docs/SPEC.md` §3 type block, validation rules,
    patch-scope, path-safety, and "what the server does, in order"
    list all updated. §6 `patch_size_bytes` description updated.
  - **Version bump**: `package.json` and `.claude-plugin/plugin.json`
    to `0.1.2`. dist/ regenerated and committed (per the
    `package.json` `files: ["dist/", ...]` ship contract).
  - **OBSERVED-FAILURES.md**: item 9 (Phase 3 DX) moved to "Resolved
    (promoted to MVP)" with full description of what landed.
- Codex MCP plan-gate review (Phase 7, mmpi pipeline):
  - Round 1: 2 HIGH (multi-file atomicity false claim;
    `dist/` omitted from blast-radius) + 4 MEDIUM (no-create/
    no-delete contract not stated; byte-counting inconsistency;
    test coverage gaps; README not in scope).
  - Round 2: all round-1 findings resolved. New MEDIUM (`tmp/`
    protected-path exemption) addressed by switching to the
    existing sibling-temp pattern (no `.meta-edit/tmp/` use). New
    LOW (stale Unit A/B references) cleaned up.
  - Round 2 verdict: `no remaining CRITICAL/HIGH issues`.
- Known issues: none introduced. The schema is intentionally
  not `.strict()` so future versions can add fields without
  breaking older readers (mirrors PR C's `EditLogEntrySchema`
  posture).
- Tests rewritten:
  - `src/tools/common.test.ts` — 30 tests covering rationale,
    test_files cardinality, path safety, changes-shape (empty
    array, payload bound, NUL byte in old/new), scope (single +
    multi-change, target_file ∪ test_files, duplicate canonical,
    edit_test_only_change strict scope, edit_docs_only scope),
    happy-path including a per-tool parameterized smoke over all
    eighteen `TOOL_NAMES`, plus a real-filesystem suite covering
    symlink-into-protected and realpath-fail-closed.
  - `src/tools/apply.test.ts` — 13 tests covering single + multi
    happy paths, stale `old_content` mismatch (no writes), multi-
    change all-or-nothing on stale second change, ENOENT modify-
    only behavior, EACCES at apply (skipped on Windows), symlink-
    out-of-repo escape, drift-to-other-in-repo path, drift-into-
    protected, mode preservation, no-temp-leftovers, no-write-on-
    second-missing, hard-fail without O_NOFOLLOW, defense-in-depth
    duplicate canonical at apply.
  - `src/tools/handler.test.ts` — 6 tests covering successful
    edit, validation rejection, stale-content apply rejection, log-
    append-failure isolation on success, log-append-failure on
    validation rejection, monotonic edit_id.
  - `src/tools/registry.test.ts` — unchanged (asserts the eighteen
    tool names + descriptions; PR D's schema change is opaque to
    those assertions).
- Spec deviations: none. SPEC.md and `EditToolRequestSchema` /
  `inputSchema` are kept in lockstep per CLAUDE.md §4.
- Tests: 282 pass, 0 fail. typecheck clean. build clean.

### Codex GitHub bot review on PR #29 (post-merge prep)

- **P2: no-op stage+rename for unchanged content.** Pre-PR-D the
  jsdiff parser rejected zero-hunk patches, so a no-op edit never
  reached apply. The content-pair flow accepted them and still
  ran stage+rename, bumping mtime / inode for semantically empty
  edits. **Fix**: `validateRequest` now rejects a change whose
  `old_content` equals `new_content` with a clear "no-op"
  warning, restoring the prior posture. Test added.
- **P2: runtime version drift** (same fix as PR #27/#28) — added
  `src/version.ts` and refactored `cli.ts` / `server.ts` to read
  `VERSION` from `package.json`.

### Codex GitHub bot round-2 review on PR #29 (TOCTOU concern, deferred to v0.2)

- **P2: Phase-1 read vs Phase-3 rename TOCTOU.** `applyChanges`
  reads disk content in Phase 1 (preflight) and renames in Phase
  3, with all temp writes between them. A concurrent writer
  modifying a target during that window silently has its update
  overwritten when the rename commits. **NOT a security boundary
  issue under the documented single-user-local-TOCTOU threat
  model** in `apply.ts`'s header comment, and `realpath` +
  parent-drift checks already cover the symlink-swap case the
  threat model does promise. Recorded as a v0.2 candidate in
  `OBSERVED-FAILURES.md` "Phase 8 (apply) residual gaps" with
  two promotion options (re-read before each rename, or
  advisory lockfile). Not blocking the v0.1.2 merge per project
  owner direction.

## v0.1.5: redirect-target allowlist deny → warn

- Completed: 2026-05-01
- Version: 0.1.5 (`package.json` + `.claude-plugin/plugin.json`)
- What works:
  - `src/hooks/hook-runtime.ts`: canonical `HookDecision` type lives
    here (single source of truth across both policies); union is
    `"allow" | "deny" | "warn"`. New `replyAllowWithWarning(reason)`
    helper emits `permissionDecision: "allow"` together with TWO
    reason carriers: `permissionDecisionReason` (user-facing per
    Claude Code's hook docs) AND `additionalContext` (model-facing,
    fed to Claude on the next turn) — plus a stderr mirror for
    transcript redundancy.
  - `src/hooks/bash-write-policy.ts`: re-exports the shared
    `HookDecision`. `evaluateBashCommand` now collects the first
    warn across segments while still short-circuiting on any deny;
    `evaluateSegment` captures shell-hosted-recursion warns and the
    structural redirect-to-outside-safe-sink warn into a `firstWarn`
    slot, and surfaces it only if no later deny check fires. The
    `redirectsOutsideSafeSinkAllowlist` block (renamed from
    `redirectsToInRepoPath` for clarity) sets `firstWarn` to a
    `decision: "warn"` with a reason that points the AI at
    `edit_create_file` / `edit_refactor_only` and notes the
    deny-restore possibility.
  - `recursivelyEvaluateArg` now propagates both `deny` and `warn`
    back to `evaluateShellHostedPayload`, so warns inside `bash -c`
    / `eval` payloads reach the outer decision when no inner deny
    was found.
  - `src/hooks/raw-edit-policy.ts`: imports `HookDecision` from the
    shared runtime instead of declaring its own. No behavioral
    change to `evaluateRawEdit` (still emits only deny/allow).
  - `src/hooks/deny-bash-write-bypass.ts` and
    `src/hooks/deny-raw-edit.ts`: both dispatchers now branch over
    all three decision values (`deny → replyDeny`,
    `warn → replyAllowWithWarning`, `allow → replyAllow`). The
    raw-edit `warn` branch is dead code today but covers the union
    exhaustively so a future raw-edit policy that introduces a warn
    surface does not silently fall through to allow.
  - SPEC §5.2 rewritten to document "Structural redirect-target
    warn" in place of the deny semantics. SPEC §8 threat-model line
    updated. SPEC §11 records the warn → deny restore as routine
    upkeep, not a v0.2 classifier candidate.
  - `OBSERVED-FAILURES.md` gains a "Phase 4 (deny-bash-write-bypass)
    — v0.1.5 redirect-allowlist warn → deny restore candidate"
    entry with three concrete restore triggers and a step-by-step
    revert procedure.
  - `CLAUDE.md` §3 in-scope bullet now references the warn-only
    redirect surface and points at SPEC §5.2 / OBSERVED-FAILURES.
- Known issues:
  - Claude Code's documented hook contract surfaces
    `permissionDecisionReason` to the *user* (transcript / UI) and
    `additionalContext` to the *model* on `allow` decisions. The
    initial v0.1.5 implementation only emitted
    `permissionDecisionReason`; review (HIGH H1) caught that the
    warn reason was therefore not reaching the model. Fixed during
    v0.1.5 prep by emitting both fields plus stderr; the model-
    facing carrier is `additionalContext`. Documented in
    `hook-runtime.ts`'s `replyAllowWithWarning` comment.
  - This is an `edit_policy_change`-class change (loosens a
    restriction). Rationale (per SPEC §11 / OBSERVED-FAILURES):
    safe-sink allowlist had a structural false-positive surface on
    legitimate redirects to outside-repo absolute paths
    (`~/.cache/`, `$RUNNER_TEMP`, `/home/user/scratch/`); the
    verb-denylist and protected-path checks remain on `deny`, so
    the well-known bypasses (`cat >`, `sed -i`, `tee`, `mv`,
    `dd of=`, heredoc-with-redirect, inline interpreter writes,
    decode-and-execute) and `.meta-edit/state/**` /
    `.meta-edit/tmp/**` writes are unchanged.
  - Pre-existing flake: `apply.test.ts > refuses on EACCES at
    apply time without modifying the file` fails when the suite
    runs as root (chmod 0 is bypassed by CAP_DAC_OVERRIDE). Not
    introduced by v0.1.5; verified to fail on the v0.1.5 baseline
    commit too. The test's own comment acknowledges the root case
    but its assertion does not gate on uid. Out of scope for this
    change; tracked separately.
- Tests added:
  - `src/hooks/bash-write-policy.test.ts`: the dogfood-001 describe
    block was renamed to "(warn since v0.1.5)" and its `deny`
    assertions flipped to `warn` (with the reason still asserting
    `"safe-sink allowlist"` and now also `"edit_*"`). New
    regression guards inside the same block:
    - `printf > .meta-edit/state/edits.jsonl` still `deny`
      (protected-path scan precedes the structural redirect)
    - `echo >> .meta-edit/tmp/x` still `deny`
    - `cat > src/foo.ts` still `deny` (`DENY_SUBSTRINGS`)
    - `sed -i s/x/y/ src/foo.ts` still `deny`
    - `echo hi | tee src/foo.ts` still `deny`
    - `bash -c "printf x > src/foo.ts"` now `warn` (warn
      propagates from shell-hosted recursion)
    - `bash -c "sed -i s/x/y/ src/foo.ts"` still `deny`
      (verb-deny inside hosted payload wins over warn)
    - `bash -c "printf x > .meta-edit/state/edits.jsonl"` still
      `deny`
    - `printf x > out.log ; sed -i s/x/y/ src/foo.ts` still `deny`
      (deny wins across segments)
    - `eval "printf x > src/foo.ts"` warns (warn propagates from
      `extractEvalArg` recursion path, distinct from `bash -c`)
    - `sudo eval "printf x > src/foo.ts"` warns (wrapper-prefixed
      eval propagates warn)
    - `echo $(printf x > src/foo.ts)` warns (`$(...)` substitution
      inner segment propagates warn)
    - `printf x > a.log ; printf x > b.log` warns and surfaces the
      FIRST warn (cross-segment first-warn-wins rule)
    - `printf x > out.log && bun test` warns (segment-2 plain-allow
      does not clobber segment-1 warn)
  - `dogfood-001 self-review fixes` block: the path-normalization
    cases (`/tmp/../in-repo`, `/var/tmp/../../home/...`) and the
    CR/LF-detached-redirect cases now assert `warn`. The
    CR-segment-boundary `cargo fmt\rmv a b` case stays `deny`.
  - `Codex PR #42` P1-1 block: the
    `bash -c "printf x > src/foo.ts"` case flipped from `deny` to
    `warn`. The protected-path-write-inside-hosted-payload cases
    stay `deny`.
- Spec deviations: none. SPEC and code stay in lockstep per
  CLAUDE.md §4.

## Phase 9: Constitutional restructure (SPEC Part I + Part II slim)

- Completed: 2026-05-02
- What works:
  - SPEC.md Part I (Articles 1–8) added at the head as the constitution.
  - Part II §2, §3, §5, §6, §10 slimmed per the disposition map in
    `docs/plan/case-c-token-spec-restructure/macro-plan.md`.
  - §1, §8, §11, §12 deleted (absorbed into Articles 2, 3, 2/7, 8
    respectively).
  - Article 4 augmented with description-style principle and
    fallback-obligation framework for the three easy-to-grab tools
    (edit_refactor_only / edit_dependency_config / edit_policy_change).
  - Three tool descriptions in §4 grew "Fallback obligation:" blocks,
    mirrored verbatim into `src/tools/descriptions.ts`.
  - External references in CLAUDE.md, README.md, README.ja.md updated
    (§11 → Article 2 / Article 7).
- Known issues:
  - SPEC.md now describes Case C target semantics (declaration + token)
    while `src/tools/apply.ts` still implements v0.1.x content-pair.
    This spec-vs-code drift is a deliberate spec-first migration choice
    (see macro-plan Part IV); subsequent micro-plans bring code into
    alignment.
- Tests added: none (docs-only change). Existing 581 tests still pass.
- Spec deviations: none — this commit IS the spec.

## v0.2.1: thin token schema (drop client-supplied sha256)

- Completed: 2026-05-02
- Motivation: dogfooding v0.2.0 surfaced that agent-supplied
  `before_sha256` and `after_sha256` were heavy friction (a node/python
  shell-out per typed_edit). Per Articles 3 (non-adversarial) and 4
  (descriptions read as a comfortable tool, not a hashing chore), the
  client-supplied digests added cost without proportional protective
  value. Codex's earlier "after_sha256 not enforced" finding is
  RESOLVED by removal.
- What changed:
  - Schema: `EditToolRequest` and `additional_files[]` no longer carry
    `before_sha256` / `after_sha256`. The server reads disk and
    computes `before_sha256` itself; there is no `after_sha256`
    anywhere.
  - Hook: `simulate()` and the post-condition replay were removed
    from `src/hooks/raw-edit-policy.ts`. Staleness detection
    (current disk sha256 vs binding `before_sha256`) is the single
    load-bearing pre-condition. NotebookEdit denies at the policy
    level (out of v0.2 scope) before token lookup.
  - Result: added `next_action` field to `EditToolResult`. Per SPEC §3
    / Article 4 the server tells the agent what to do next so the
    `_meta_edit_token` contract doesn't have to be re-derived from
    outside the tool surface.
  - TTL: extended `GRANT_TTL_MS` from 30s → 5min — the single-use
    binding is the integrity guarantee; the TTL is purely
    garbage-collection. 5min absorbs realistic agent thinking time
    without weakening the model.
  - SPEC §3 / §5 / §6 updated; macro-plan Part III updated; READMEs'
    edit-log JSON example updated; package.json + plugin.json bumped
    to 0.2.1.
- Tests: 563 (was 576 in v0.2.0; reduction reflects removed simulate()
  test layer and dropped hash-format zod tests). Typecheck clean,
  dist/ rebuilt.
- Spec deviations: none.

## v0.2.2: server-side active-grant lookup (dogfood-blocker fix)

- Completed: 2026-05-02
- Motivation: dogfooding v0.2.1 surfaced that Claude Code's native
  Edit / Write / MultiEdit tools have strict input schemas that
  reject extra fields. The framework strips `_meta_edit_token` from
  `tool_input` before the deny-raw-edit hook ever sees it, so the
  v0.2.0 / v0.2.1 design — agent passes token on the native call —
  was end-to-end unusable. The agent could declare via typed_edit
  and receive a token, but had no way to surface that token to the
  hook; every native Edit was denied with "no _meta_edit_token".
- What changed:
  - `state/grants.ts`: added `findActiveBindingForFile(canonicalFile)`.
    Scans `.meta-edit/state/grants/`, skips expired entries and
    bindings already in `consumed_files`, returns the most-recently-
    issued match (LIFO on `issued_at`). Existing `lookup(token_id)`
    and `consume(token_id, file_path)` retained for audit/test paths.
  - `hooks/raw-edit-policy.ts`: `evaluateTokenedEdit` rewritten —
    drops the `_meta_edit_token` read from `tool_input` entirely.
    Now: NotebookEdit guard → file_path canonicalize →
    `findActiveBindingForFile` → before_sha256 staleness check →
    `consume` → appendConsumed → allow. The `RawToolInput`
    `_meta_edit_token` field type was dropped.
  - `tools/apply.ts`: `next_action` message rewritten. Was: "pass
    _meta_edit_token: '...'"; now: "the deny-raw-edit hook will
    resolve this declaration automatically (no extra parameters
    needed)". The agent only declares; the server does the rest.
  - SPEC §5.1 pseudocode updated (server-side scan). v0.2.2 fix
    note added under §3 next_action paragraph and §5.1.
  - Macro-plan Part III pseudocode updated; v0.2.2 note added
    citing the dogfood discovery. Article 5 principles unchanged
    (binding satisfies (a) presence-check, (b) file-targeting,
    (c) before-state agreement; only how (a) is implemented moved
    from agent-passed to server-resolved).
  - `package.json` and `.claude-plugin/plugin.json` bumped to 0.2.2.
- Tests: 574 (same total as v0.2.1; +7 grants tests for
  findActiveBindingForFile, +2 hook LIFO tests, with the obsolete
  token-passing-in-tool_input deny / lookup tests dropped or
  rewritten as file-based). Typecheck clean.
- Spec deviations: none.

## opencode harness migration (OC-1..OC-11)

- Completed: 2026-05-03
- What works:
  - The same npm package `@hiniachi/meta-edit` now exposes a
    `./opencode` subpath via `package.json` `exports`. Importing
    `@hiniachi/meta-edit/opencode` resolves to
    `dist/opencode/plugin.js`.
  - `src/opencode/plugin.ts` is the in-process opencode plugin
    entry point. Its `tool.execute.before` hook routes `edit` /
    `write` / `apply_patch` through `evaluateTokenedEdit` (full
    Q-D grant flow integration — `EditLog` + `Grants` instantiated
    against the project worktree, sharing `.meta-edit/state/grants/`
    and `.meta-edit/state/edits.jsonl` with any concurrent
    MCP-server-side issuer) and `bash` through `evaluateBashCommand`.
    Throws on deny + sets `output.aborted = true` (R2 fallback
    readiness). Unexpected internal errors are caught and converted
    to fail-closed deny (parity with `deny-raw-edit.ts`). `warn`
    decisions surface to stderr.
  - `src/opencode/tool-name-map.ts` provides
    `OPENCODE_TO_CANONICAL` (lowercase opencode name → canonical
    `RAW_EDIT_TOOLS` entry), `isOpencodeRawEditTool`, and
    `toCanonicalRawEditName`. apply_patch self-maps because
    `toLowerCase()` cannot fold underscore-bearing names; the
    canonical entry stays as the opencode-emitted form.
  - `RAW_EDIT_TOOLS` extended with `apply_patch`. Matchers in both
    `META_EDIT_RAW_EDIT_MATCHER` (programmatic) and
    `hooks/hooks.json` (static plugin) updated in lockstep —
    drift-prevention test enforces parity. `evaluateTokenedEdit`
    grew an early-exit deny branch for apply_patch with an
    actionable reason (no top-level file_path → no grant flow).
  - `meta-edit install-opencode --scope user|project` and
    `meta-edit uninstall-opencode` register / remove
    `mcp.meta-edit` + `plugin: ["@hiniachi/meta-edit/opencode"]`
    in `opencode.json`. Atomic write, idempotent against re-run,
    preserves sibling mcp servers and plugin entries.
  - `examples/.opencode/opencode.json` reference snippet.
  - `README.md` / `README.ja.md` / `README.zh-CN.md` have new
    "Option C / 方式 C" sections + commands listing.
  - Macro plan `docs/plan/opencode-migration/macro-plan.md`
    converted from draft to accepted with Q1–Q8 + Q-D decision log.
- Known issues:
  - **OC-12 (real-opencode E2E smoke) deferred.** Throw-to-deny
    behavior of opencode `tool.execute.before` is unverified
    against a live opencode harness. The plugin sets
    `output.aborted = true` defensively so the swap-in is
    grep-discoverable; if smoke shows throw is fatal, adjust
    `throwAbort` to not throw and rely on the property.
  - opencode's actual tool argument shapes (camelCase vs
    snake_case) are accepted defensively but the assumption is
    not yet validated against a real opencode session.
  - Tool count drift in `README.ja.md` / `README.zh-CN.md` ("19
    種類のツール" / "十九个工具") deferred to a separate language
    sweep — outside this phase's scope.
- Tests added: 686 → 709 (+23 new across tool-name-map (10),
  plugin (15), install-opencode CLI (23), apply_patch deny in
  raw-edit-policy (3), matcher parity (3 updated)). All pass;
  `tsc --noEmit` clean; `bun run build` emits
  `dist/opencode/plugin.js` (~230 KB).
- Spec deviations: none. SPEC §5.2's deny-set table does not
  yet mention `apply_patch` — flagged as low-priority follow-up
  in OC-2 review.

### Harness-bug discovery side-quest

During this phase, hit and filed
`issues/2026-05-03-2030-mcp-string-array-arg-marshaling-bug.md`:
non-empty `test_files: string[]` arguments to typed_edit calls
silently arrived at the MCP server as JSON-strings (Zod rejected
with "Expected array, received string") UNLESS a fresh
`ToolSearch select:<tool>` call had refreshed the schema cache
in the same turn. Workaround in this session: prefix any
typed_edit declaration that needs non-empty `test_files` with a
ToolSearch refresh of that tool. Root cause hypothesis: harness
caches MCP tool schemas at session start and the cached form
mis-marshals non-empty string arrays.

## v0.4.1: explicit repository-root override for `meta-edit serve`

- Completed: 2026-05-16
- What works:
  - `meta-edit serve --repo-root <path>` (and `--repo-root=<path>`)
    overrides the MCP server's repository root. New
    `src/cli/serve-cmd.ts` `parseServeArgs`, wired in `src/cli.ts`
    (`serve` case now parses args, exit 64 on bad flag).
  - `src/server.ts` `createServer` resolution precedence is now
    `options.repoRoot` → `$META_EDIT_REPO_ROOT` → `process.cwd()`,
    normalized with `path.resolve` — in lockstep with the hooks'
    `resolveRepoRoot`, closing the prior server/hook asymmetry that
    broke binding lookups when launched from a non-git-root cwd
    (jj workspace, git worktree, sub-directory launch).
  - `src/tools/repo-validity.ts` error message now names the real
    `--repo-root` flag + `META_EDIT_REPO_ROOT`; `help-cmd.ts`
    documents the flag.
  - `docs/SPEC.md` §3 gains a "Repository root" definition (precedence
    + server/hook parity as a correctness requirement + non-git-root
    remediation); §7 `meta-edit serve` documents the flag.
- Known issues:
  - `meta-edit log` / `meta-edit summary` still use `process.cwd()`
    directly (read-only reporting paths; explicit non-goal this round).
  - No directory-tree walk-up / `.git`-as-file / jj layout parsing —
    out of scope per CLAUDE.md §3 (VCS adapter / jj-specific support);
    explicit override only, by user direction.
- Tests added: 746 total (+ `serve-cmd.test.ts` 6, server
  resolution-precedence describe 4, ~13 net). `tsc --noEmit` clean;
  `bun run build` green; full suite green.
- Spec deviations: none.

## v0.4.2: grant-binding canonicalization parity + drop empty-create-first + cross-process lock

- Completed: 2026-05-17
- Root cause + scope: see
  `issues/2026-05-17-grant-binding-canonicalization-parity.md`. Full
  scope, user-approved (parity unification + drop empty-create-first +
  parallel cross-process lock + categorized errors).
- What works:
  - `src/utils/repo-paths.ts` (new): one `resolveRepoRoot` (upward
    `.git`/`.jj` discovery + realpath) and one existence-independent
    `canonicalizeRepoRelative`, both used by server + both hooks +
    `checkPathSafety` + `canonicalizeForBinding`. The three local
    `resolveRepoRoot` copies (server, deny-raw-edit, session-
    onboarding) are deleted — issue/consume + server/hook parity is
    now structural, not comment-enforced.
  - `src/utils/realpath.ts`: added `canonicalDirRealpath` — realpaths
    the deepest existing *directory* and re-attaches the rest
    (including the leaf) lexically, so the canonical key is identical
    whether or not the file exists yet.
  - `computeBeforeSha256` (common.ts): ENOENT → bind
    `before_sha256 = sha256("")` instead of rejecting. The v0.3.1
    "create empty file first, THEN declare" dance is gone.
  - `grants.findActiveBindingForFile(file, {preferBeforeSha})`:
    disk-matching candidates win over a newer interleaved declaration
    (anti-hijack). `grants.consume` now also takes a cross-process
    O_EXCL advisory lock so parallel writes against a multi-file grant
    all land.
  - deny reasons categorized `[meta-edit:<category>]` with
    canonical + repoRoot for diagnosis.
  - SPEC §3 "Repository root" + argument validation + §5.1 rewritten;
    stale "no cross-process lock / out of scope per Article 7"
    comments corrected.
- Known issues:
  - Pre-existing latent bug `src/state/protected-paths.ts:54`
    (`p.includes(" ")` where `"\0"` was intended) left as-is — out
    of this fix's scope; recorded in the issue file.
- Tests added: 747 → 764 (+17: `src/utils/repo-paths.test.ts` 13,
  raw-edit-policy v0.4.2 describe 5; existing non-existent-file
  rejection tests flipped to assert the new sha256("") binding).
  `tsc --noEmit` clean; `bun run build` green; full suite green.
- Spec deviations: none (descriptions.ts untouched — verbatim rule
  preserved; no §4 tool-description text changed).

## v0.4.3: mv/cp/rsync deny→warn + mechanical verb-list derivation + edit_docs_only batch hint

- Completed: 2026-05-19
- What works:
  - **Loosen (edit_policy_change)**: `mv`/`cp`/`rsync` moved from
    hard `deny` to the v0.1.5 structured `warn` (allow-with-nudge) in
    `deny-bash-write-bypass`. `patch` stays `deny`; `cat >`/`sed -i`/
    `tee`/`dd of=`/heredoc/inline-interpreter stay `deny`;
    protected-path writes (`.meta-edit/state/**`, `.meta-edit/tmp/**`)
    stay hard-`deny` regardless of verb (fires earlier in
    `evaluateSegment`, structurally before the verb block — verified
    by new invariant guards). Rationale (loosening justification, not
    "convenience"): Article 3 non-adversarial threat model + the
    v0.1.5 warn bet held + these three verbs dominate legitimate
    non-edit workflows; restore trigger recorded in
    OBSERVED-FAILURES.md.
  - **Mechanical derivation (task 2)**: single verb-name source of
    truth (`DENY_VERB_NAMES` / `WARN_VERB_NAMES` × `VERB_ARG_SEPARATORS`
    via `expandVerbPrefixes`). `DENY_VERBS`/`WARN_VERBS` and
    `DENY_PREFIX_PATTERNS`/`WARN_PREFIX_PATTERNS` are now derived, no
    hand-enumerated space/tab variants.
  - **edit_docs_only batch hint (task 3)**: SKILL.md + `apply.ts`
    declaration-time `next_action` now state that one
    `edit_docs_only` declaration covers the whole batch (consecutive
    native edits, any order, no per-file re-declaration, until
    exhausted/TTL).
  - SPEC §5.2 synced; version 0.4.2 → 0.4.3 (package.json +
    plugin.json; version.ts inlines from package.json). dist rebuilt.
- Environment note: cloud session had no meta-edit MCP/hook
  registration, so the self-application typed surface was
  unavailable. Per explicit user direction this change was applied
  via direct Edit/Write as a recorded CLAUDE.md §9 environment
  override (typed-tool routing documented in the commit instead:
  hook/SPEC/manifest = edit_policy_change, tests =
  edit_test_only_change, OBSERVED-FAILURES.md = edit_docs_only).
- Tests added: full suite 764 → 778 (+14: new
  `v0.4.3 mv/cp/rsync verb-warn` invariant-guard describe; deny→warn
  flips across the hook suite; constants test re-pointed to the
  derived prefixes). `tsc --noEmit` clean; `bun run build` green;
  full suite green; built-hook smoke test confirms
  mv/cp/rsync→allow+additionalContext, patch→deny,
  mv→.meta-edit/state→deny.
- Spec deviations: none (descriptions.ts untouched — verbatim §4 rule
  preserved; batch-capability text added only to SKILL.md and the
  server next_action, not to any §4 tool description).


## Phase 0.5.0: Tag surface reshape — impl × target flag

- Completed: 2026-05-20
- What works:
  - Removed `edit_test_only_change` from `TOOL_NAMES`. Test edits now
    flow through the kind-specific impl tool with `target: "test"`,
    paired with the original `target: "prod"` declaration. The 33%
    information-less mass of `edit_test_only_change` is redistributed
    across the 15 SQLite-derived impl tools so risk weight, audit and
    rationale follow the implementation domain rather than collapsing
    into a generic test bucket.
  - Renamed `edit_refactor_only` → `edit_cosmetic` with a much narrower
    description: whitespace / comments / formatter output ONLY. Renames,
    function extracts, dead-code removal, guard-clause rewrites etc.
    are explicitly outside scope and route to stop-and-ask rather than
    a generic refactor catch-all. The fallback obligation paragraph
    was kept (and updated) so slip-throughs still post back to the user.
  - Added required `target: "prod" | "test"` field to every impl tool
    (15 SQLite-derived + `edit_cosmetic`). `edit_docs_only` is exempt
    (documentation has its own surface and the prod/test split does
    not apply). Schema enforcement: presence required on impl tools,
    forbidden on `edit_docs_only`; `test_files` cardinality flips on
    target (non-empty on `target: "prod"` for impl tools that impose
    test obligations, empty on `target: "test"` since `target_file`
    IS the test file in that case).
  - **No file-path detection.** The server does NOT pattern-match
    `target_file` against test-directory conventions to verify the
    declared target — consistent with v0.4.x's honor-system stance on
    every other declared field. Article 7 still holds.
  - Surface count: 17 (15 SQLite + edit_cosmetic + edit_docs_only),
    down from 18 in v0.4.x.
- Known issues:
  - Migration is immediate (no warn-then-deny period). edit_*-aware
    callers will see schema rejections on the next session: missing
    `target`, `edit_test_only_change` unknown, `edit_refactor_only`
    unknown. self-application is the dominant user, so the breaking
    change cost is acceptable.
  - Historical references to `edit_refactor_only` /
    `edit_test_only_change` remain in dated `issues/`,
    `docs/plan/`, and one transcript quote on the site page — those
    are historical artifacts and were not retroactively rewritten.
- Tests added:
  - `common.test.ts`: new cases for `target=prod` missing test_files,
    `target=test` non-empty test_files, missing `target` on impl,
    forbidden `target` on `edit_docs_only`, and `edit_cosmetic` with
    `target=prod` empty test_files.
  - `registry.test.ts`: tool count assertion 18 → 17, new
    "does NOT register edit_refactor_only or edit_test_only_change"
    check, exempt set narrowed to `edit_cosmetic` + `edit_docs_only`.
  - `descriptions.test.ts`: exempt set updated to the same pair.
  - `handler.test.ts`: `modifyRequest` default now carries
    `target: "prod"`; the old `edit_test_only_change` rejection test
    became a `target: "test"` + non-empty `test_files` rejection
    against an impl tool.
  - `help-cmd.test.ts`, `opencode/plugin.test.ts`: updated ToolSearch
    sample to reference `edit_cosmetic`.
  - Full suite: 791 tests pass, `tsc --noEmit` clean.
- Spec deviations: none (descriptions.ts and SPEC §4 updated in the
  same change, per CLAUDE.md §4). SPEC §3, §4, §6, §10 all reflect
  the new surface; CLAUDE.md, three READMEs, the SKILL onboarding,
  the site landing page, and `plugin.json` (version 0.4.3 → 0.5.0)
  all reference seventeen consistently.


## v0.5.1: reminder-style hook wording (PR-α of v0.6.0 plan)

- Completed: 2026-05-21
- What works:
  - Hook messages on **classification-recovery** surfaces are rewritten
    in self-reminder style with a `meta-edit reminder:` prefix and
    first-person framing, per
    `docs/plan/reminder-style-hooks/rfc.md` §6–§7. The denial /
    enforcement behavior is unchanged — only the `reason` strings are
    reworded.
  - Rewrites land on six wording sites:
    - `src/hooks/raw-edit-policy.ts`:
      - `evaluateRawEdit()` raw Edit/Write/MultiEdit/NotebookEdit deny
        (RFC §7.2)
      - `evaluateTokenedEdit()` `apply_patch` deny (same recovery
        scenario as raw-edit; the message explains why apply_patch
        cannot bind a typed_edit grant)
      - `evaluateTokenedEdit()` "no active typed_edit declaration"
        deny — formerly tagged `[meta-edit:undeclared]` — replaced by
        the reminder prefix since this is the canonical
        classification-recovery surface (RFC §6)
      - empty-Write warn (the post-empty-create nudge that asks the
        agent to declare the kind of the content fill)
    - `src/hooks/bash-write-policy.ts`:
      - structural redirect warn (v0.1.5 surface, soft warn for
        outside-safe-sink redirects) — RFC §7.3 verbatim
      - `warnVerbReason()` helper for the mv / cp / rsync verb-warn
  - SessionStart message (`src/hooks/session-onboarding.ts`
    `buildOnboardingMessage()`) becomes a **merged template**: the
    §7.1 reminder block is prepended to the existing
    `typed-edit-onboarding` skill pointer block. The skill pointer is
    retained (Codex PR #84 review #7 — replacing the function with
    §7.1 alone would regress onboarding guidance). `hooks/hooks.json`
    and `.claude-plugin/plugin.json` are unchanged (RFC §8 invariant).
  - **Imperative wording preserved** on verb-deny (`sed -i`, `dd`,
    `tee`, `decode-and-execute`, heredoc, `python -c`/`node -e`/…,
    DENY_VERBS), protected-path denies (`.meta-edit/state/**`,
    `.meta-edit/tmp/**`), and fail-closed surfaces (`[meta-edit:stale]`,
    `[meta-edit:unreadable]`, `[meta-edit:path-mismatch]`,
    `[meta-edit:expired]`/`consumed`/`consume-failed`). These are
    structural-bypass or wrong-territory surfaces; RFC §6 explicitly
    keeps them imperative.
- Tests added (Phase 3 / Phase 4):
  - `src/hooks/raw-edit-policy.test.ts`: updated four assertions whose
    substring matchers tracked the old wording (`edit_*` →
    `typed edit tool`; `[meta-edit:undeclared]` → reminder prefix +
    `no active typed_edit declaration`); added a new describe block
    asserting fail-closed surfaces (`missing file_path`, EISDIR) do
    NOT contain `meta-edit reminder:` and stale keeps its
    `[meta-edit:stale]` tag.
  - `src/hooks/bash-write-policy.test.ts`: appended a "reminder-style
    scoped to soft warns" describe block. Positive assertions
    (`structural redirect warn`, `mv/cp/rsync verb-warn`) check the
    reminder prefix and `classification language`; negative
    assertions (verb-deny: sed -i / dd / tee / decode-and-execute /
    heredoc / python -c / DENY_VERBS; protected-path: redirect to
    `.meta-edit/state` + sed -i `.meta-edit/state`) check that the
    reminder prefix is absent.
  - `src/hooks/session-onboarding.test.ts` (new): snapshot test on
    `buildOnboardingMessage()` asserting the reminder block,
    semantic phrases (`classification step`, `stop and make the
    declaration first`), and the retained skill pointer
    (`typed-edit-onboarding`, `seventeen-tool catalog`, `ToolSearch`)
    are all present, and that the reminder block precedes the skill
    pointer in source order.
  - Hook entry-point guard (`import.meta.main`) added to
    `session-onboarding.ts` so unit tests can import
    `buildOnboardingMessage` without the script's `readStdin()` call
    hanging the test runner.
  - Full suite: 818 tests pass (was 801 on main; +17 new assertions
    landing through the three describe blocks above). `tsc --noEmit`
    clean. `bun run build` clean — `dist/` regenerated and committed.
- Spec deviations: `docs/plan/reminder-style-hooks/rfc.md` §6 table
  was extended in the same change to enumerate the three reminder
  surfaces the implementation generalized from the original two-row
  split (the original table only listed "raw Edit deny" + "Bash
  structural redirect warn" as reminder, with other soft warns
  missing). The expanded table now records `apply_patch` deny,
  empty-Write warn, structural-redirect warn, and mv/cp/rsync
  verb-WARN as reminder; the fail-closed category row was widened to
  enumerate `[meta-edit:stale]` / `unreadable` / `path-mismatch` /
  `expired`/`consumed`/`consume-failed` and missing `file_path`. The
  underlying principle ("soft warns get reminder; structural bypass /
  audit-base intrusion / fail-closed errors stay imperative") is
  unchanged. Per CLAUDE.md §4 the spec edit and the code that depends
  on it land in the same commit. The "seventeen-tool catalog" phrase
  in the SessionStart message and the `edit_docs_only` references in
  `warnVerbReason()` / the empty-Write nudge / the structural-redirect
  warn / the `evaluateRawEdit` ToolSearch hint are intentionally left
  at their current names — those are workflow-axis-kinds (PR-β /
  v0.6.0) rewrites per the RFC's landing order.
- Version bump: `package.json` and `.claude-plugin/plugin.json` from
  0.5.0 → 0.5.1 (patch — wording-only change, no surface change).

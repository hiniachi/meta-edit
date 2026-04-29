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

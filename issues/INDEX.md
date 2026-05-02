# Issues — meta-edit

Living catalog. Updated 2026-05-02 to integrate post-sweep findings (030–032,
v0.1.6 dogfood 1000–1108) and 4 pending review PRs.

## v0.1.2 — 7-agent parallel sweep (001–029)

Filed 2026-05-01 by a 7-agent parallel sweep. Every issue includes a TypeScript test code block that, when added to the indicated `*.test.ts` file, exercises the behaviour under review. **Most are reproducing failing tests** (real defects → fail today; fix makes them pass). **A few are regression-guard tests** (current behaviour is correct → pass today; the test prevents future regression). Each issue body indicates which framing applies — examples of regression-guards include a1-07 and a6-01.

- Total: **29**
- Severity: **21 HIGH / 8 MEDIUM**
- Mix: **23 security / 6 quality** (~79% security)
- Surfaces: bash-bypass policy (11), raw-edit/hook-runtime (3), protected-paths (3), tools/common.ts validation (4), edit-log (4), CLI/server (4)

Each issue file is self-contained: front-matter (`id`, `category`, `severity`, `affected_files`, `test_file`), summary, attack surface (with file:line citations and verbatim code quotes), reproducing test block, expected vs actual, fix direction, out-of-scope notes.

---

## Bash policy bypasses — `src/hooks/bash-write-policy.ts` (11)

| Seq | ID | Sev | Title | File |
|-----|-------|------|-----------------------------------------------------------|------|
| 001 | a1-01 | HIGH | Heredoc redirect bypass (`cat <<EOF > src/foo.ts`) | [001-heredoc-redirect-bypass.md](001-heredoc-redirect-bypass.md) |
| 002 | a1-02 | HIGH | `base64 -d \| bash` defers writes to runtime | [002-base64-decode-pipe-bash.md](002-base64-decode-pipe-bash.md) |
| 003 | a1-03 | HIGH | `dd of=src/foo.ts` not denied | [003-dd-of-write-bypass.md](003-dd-of-write-bypass.md) |
| 004 | a1-04 | HIGH | `find -exec sed -i` not parsed as inner segment | [004-find-exec-bypass.md](004-find-exec-bypass.md) |
| 005 | a1-05 | HIGH | `perl -e` / `ruby -e` / `php -r` inline writes | [005-perl-ruby-php-inline-bypass.md](005-perl-ruby-php-inline-bypass.md) |
| 006 | a1-06 | HIGH | `busybox mv/sed/cp` prefix bypass | [006-busybox-prefix-bypass.md](006-busybox-prefix-bypass.md) |
| 007 | a1-07 | HIGH | Locale env-prefix regression test missing | [007-locale-env-prefix-regression-test.md](007-locale-env-prefix-regression-test.md) |
| 008 | a2-01 | HIGH | Unicode whitespace `tee ` bypass | [008-unicode-whitespace-tee-bypass.md](008-unicode-whitespace-tee-bypass.md) |
| 009 | a2-02 | HIGH | `eval "$(...)"` deferred-string bypass | [009-eval-deferred-string-bypass.md](009-eval-deferred-string-bypass.md) |
| 010 | a2-03 | MEDIUM | `env -i` wrapper regression-test gap | [010-env-i-wrapper-verb-extraction.md](010-env-i-wrapper-verb-extraction.md) |
| 011 | a2-04 | HIGH | Noclobber-override `>\|` redirect not denied | [011-noclobber-override-redirect.md](011-noclobber-override-redirect.md) |

## Raw-edit & hook-runtime — `src/hooks/` (3)

| Seq | ID | Sev | Title | File |
|-----|-------|------|---------------------------------------------------|------|
| 012 | a3-01 | HIGH | Case-sensitive `RAW_EDIT_TOOLS` set | [012-case-insensitive-tool-name-bypass.md](012-case-insensitive-tool-name-bypass.md) |
| 013 | a3-02 | HIGH | `NotebookEdit` not in deny set | [013-notebookedit-not-blocked.md](013-notebookedit-not-blocked.md) |
| 014 | a3-03 | HIGH | `hook-runtime.ts` fail-closed path untested | [014-hook-runtime-fail-closed-untested.md](014-hook-runtime-fail-closed-untested.md) |

## Protected paths — `src/state/protected-paths.ts` (3)

| Seq | ID | Sev | Title | File |
|-----|-------|--------|-----------------------------------------------|------|
| 015 | a4-01 | HIGH   | Symlink alias bypasses bash-hook lexical check | [015-symlink-alias-bypass-bash-hook.md](015-symlink-alias-bypass-bash-hook.md) |
| 016 | a4-02 | HIGH   | NUL byte in path defeats `isProtectedPath` | [016-nul-byte-path-bypass.md](016-nul-byte-path-bypass.md) |
| 017 | a4-03 | MEDIUM | Exact directory name without trailing slash unmatched | [017-trailing-slash-directory-exact-match.md](017-trailing-slash-directory-exact-match.md) |

## Validation — `src/tools/common.ts` & friends (4)

| Seq | ID | Sev | Title | File |
|-----|-------|--------|-----------------------------------------------|------|
| 018 | a5-01 | HIGH   | TOCTOU non-existent-leaf regression test | [018-toctou-missing-leaf-regression-test.md](018-toctou-missing-leaf-regression-test.md) |
| 019 | a5-02 | MEDIUM | Whitespace `rationale` regression test | [019-whitespace-rationale-regression-test.md](019-whitespace-rationale-regression-test.md) |
| 020 | a5-03 | MEDIUM | Duplicate-canonical alias paths regression | [020-duplicate-canonical-regression-test.md](020-duplicate-canonical-regression-test.md) |
| 021 | a5-04 | HIGH   | `TOOLS_REQUIRING_TEST_FILES` drift guard | [021-tools-requiring-test-files-drift.md](021-tools-requiring-test-files-drift.md) |

## Edit log — `src/state/edit-log.ts` (4)

| Seq | ID | Sev | Title | File |
|-----|-------|--------|-----------------------------------------------|------|
| 022 | a6-01 | MEDIUM | JSON injection safety regression test | [022-json-injection-regression-test.md](022-json-injection-regression-test.md) |
| 023 | a6-02 | MEDIUM | `O_NOFOLLOW === 0` fail-closed path untested | [023-o-nofollow-zero-untested.md](023-o-nofollow-zero-untested.md) |
| 024 | a6-03 | HIGH   | Concurrent `EditLog` instances duplicate `edit_id` | [024-concurrent-edit-id-collision.md](024-concurrent-edit-id-collision.md) |
| 025 | a6-04 | MEDIUM | `.meta-edit/state/` created world-readable (0755) | [025-state-dir-world-readable.md](025-state-dir-world-readable.md) |

## CLI / server — `src/cli/`, `src/server.ts`, `src/cli.ts`, `common.ts` (4)

| Seq | ID | Sev | Title | File |
|-----|-------|--------|-----------------------------------------------|------|
| 026 | a7-01 | HIGH   | ANSI escape injection in `log`/`summary` output | [026-ansi-escape-injection-cli-output.md](026-ansi-escape-injection-cli-output.md) |
| 027 | a7-02 | MEDIUM | `cli.ts` unknown-subcommand path untested | [027-unknown-subcommand-exit-code-untested.md](027-unknown-subcommand-exit-code-untested.md) |
| 028 | a7-03 | HIGH   | `server.ts` accepts any cwd as repoRoot | [028-server-no-repo-root-validation.md](028-server-no-repo-root-validation.md) |
| 029 | a7-04 | HIGH   | `appendLogSafely` swallows audit-log failures | [029-append-log-safely-swallows-failure.md](029-append-log-safely-swallows-failure.md) |

---

## v0.1.3 follow-up — automated review session a8 (030–032)

Filed 2026-05-01 from session a8 review. Continues the integer-prefix
convention before the v0.1.6 switch to date-prefix.

| ID | Sev | Title | File |
|----|--------|-----------------------------------------------|------|
| 030 | MEDIUM | counter-file day-boundary duplicate `edit_id` | [030-counter-file-day-boundary-duplicate-id.md](030-counter-file-day-boundary-duplicate-id.md) |
| 031 | LOW    | raw-edit-policy stale defect comments | [031-raw-edit-policy-stale-defect-comments.md](031-raw-edit-policy-stale-defect-comments.md) |
| 032 | MEDIUM | `readStdin` silently resolves on JSON `null` | [032-readstdin-null-json-not-rejected.md](032-readstdin-null-json-not-rejected.md) |

## v0.1.6 self-application — apply/edit-log dogfood (1000–1002)

Filed 2026-05-02 during v0.1.6 cleanup work. Switches to
`YYYY-MM-DD-HHMM-<slug>.md` for chronological clarity and PR back-references.

| ID | Sev | Title | Status |
|----|--------|-----------------------------------------------|--------|
| 1000 | HIGH | applyCreates partial-file no cleanup on write failure | ✅ resolved (commit `46562ec`) |
| 1001 | MEDIUM | apply: EACCES root unconditional assert | open |
| 1002 | MEDIUM | edit-log readAll TOCTOU ENOENT crash | open |

## v0.1.6 self-application — bash hook & raw-edit dogfood (1100–1108)

Filed 2026-05-02 during sustained dogfood; cluster spans hook scope, UX,
and tool-surface design. Cross-cutting theme: **"hook scope = repository"**
unification across 1102 / 1106 / 1108.

| ID | Sev | Title |
|----|--------|-----------------------------------------------|
| 1100 | MEDIUM | `cat <file> > <in-repo>` is functionally `cp`; verb-deny misses it |
| 1101 | LOW    | `edit_create_file` does not implicitly mkdir parent |
| 1102 | MEDIUM | `deny-raw-edit` blocks out-of-repo Write (over-deny) |
| 1103 | DESIGN | typed `edit_*` as thin Edit wrapper via grant-token (v0.2 candidate) |
| 1104 | DESIGN | 20th tool candidate `edit_create_planning_artifact` |
| 1105 | LOW    | hook deny reason text too verbose (URL + 一般論) |
| 1106 | LOW    | safe-sink allowlist: add `/.claude/` (Claude Code agent state) |
| 1107 | MEDIUM | bash deny patterns: position-aware verb vs argument |
| 1108 | HIGH   | `deny-raw-edit` MCP tool scope gap (e.g. `ctx_execute` bypasses) |

## Automated review consolidation — formerly PRs #48–#51 (8 issues)

Four `claude/modest-fermat-*` review PRs (#48 / #49 / #50 / #51) were
consolidated into a single integration branch on 2026-05-02 and the
originals closed. Two of #51's three filings were dropped as duplicates
(see Drops below). Names normalized to `YYYY-MM-DD-HHMM-<slug>.md` so
that #49 and #50 no longer collide on `033`/`034`.

| ID prefix | Sev | Title | Origin |
|-----------|--------|-----------------------------------------------|--------|
| 2026-05-01-0912-strip-ansi-st-osc-content-leak | HIGH | ST-terminated OSC content leaks past `stripAnsi` (sub-case of 026) | #51 |
| 2026-05-02-0428-patch-dry-run-glued-o-bypass | HIGH | `patch --dry-run -osrc/new.ts` glued POSIX short-option bypass | #48 |
| 2026-05-02-0428-log-cmd-since-exact-match-untested | MEDIUM | `--since` exact-match boundary regression test | #48 |
| 2026-05-02-1041-reply-deny-stdout-shape-untested | MEDIUM | hook protocol stdout JSON shape untested | #49 |
| 2026-05-02-1041-parse-log-args-duplicate-flags-silently-accepted | MEDIUM | `parseLogArgs` accepts duplicate `--since`/`--tool`/`--risk` (last-wins) | #49 |
| 2026-05-02-1041-invalid-timestamp-silently-dropped-by-since-filter | MEDIUM | `filterEntries` silently drops unparseable timestamps when `--since` is set | #49 |
| 2026-05-02-1042-tee-fd-redirect-false-deny | MEDIUM | `matchesDangerousTee` false-positive on fd-redirect (`2>&1`, `2>/dev/null`) | #50 |
| 2026-05-02-1042-rsync-unicode-whitespace-bypass | MEDIUM | rsync Unicode-whitespace bypass (not in `DENY_VERBS`) | #50 |

### Drops (PR #51)

- `apply-creates-orphaned-file` — duplicate of issue 1000, resolved by commit `46562ec` (PR #46).
- `readstdin-null-resolves-misnamed` — duplicate of issue 032.

---

## v0.3 dogfood — 2026-05-03 onboarding cluster (8 issues)

Filed 2026-05-03 during v0.2.x → v0.3.x dogfood. Cluster spans
`assertIsRepo` onboarding, NotebookEdit recourse, audit-burden, and
bash-hook prose noise. Resolution status as of v0.3.1 release
(PRs #60–#62):

| ID | Sev | Title | Status |
|----|-----|-------|--------|
| 2026-05-03-1530-mcp-late-connect-descriptions-missing | HIGH | `assertIsRepo` eager-fail strips descriptions from agent context | ✅ #60 |
| 2026-05-03-0105-rejection-consumes-edit-id-counter | LOW | rejected typed_edit advances daily counter | ✅ #61 |
| 2026-05-03-0105-notebookedit-no-recourse | MEDIUM | NotebookEdit denied unconditionally | ✅ #61 |
| 2026-05-03-0105-edit-old-string-uniqueness-helper | LOW | `old_string` uniqueness has no meta-edit helper | ✅ #61 (closed-as-accepted, Article 7) |
| 2026-05-03-1700-bash-hook-scans-commit-message-prose | MEDIUM | `git commit -m` / `gh pr create` prose triggers DENY_* | ✅ #61 |
| 2026-05-03-0105-description-size-token-cost | LOW | 18 descriptions cost ~7-8K tokens per call | 🟡 deferred to v0.3 prose pass |
| 2026-05-03-0105-test-files-upfront-declaration-burden | MEDIUM | upfront `test_files` declaration burden | 🟡 partial (SPEC §3 clarification only) |
| 2026-05-03-1701-dev-fd-redirect-warn-noise-on-every-git-commit | LOW | heredoc-plumbing `>` warn on every git commit | 🟡 partial (outer-segment fixed; heredoc-aware segmentation pending) |

---

## Provenance

Filed by 7 sub-agents (sonnet) in parallel; consolidated under jj. Per-agent commits in this branch:

```
chore(gitignore): track issues/* (drafts/ remains ignored)
issues(bash-bypass):     7 issues from agent-1
issues(bash-edge-cases): 4 issues from agent-2
issues(raw-edit-hook):   3 issues from agent-3
issues(protected-paths): 3 issues from agent-4
issues(validation):      4 issues from agent-5
issues(audit-log):       4 issues from agent-6
issues(cli-server):      4 issues from agent-7
issues(index):           catalog (this file)
```

Working drafts under `issues/drafts/agent-N/` are gitignored and may be removed once these are triaged.

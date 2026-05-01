# Issues — meta-edit v0.1.2

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

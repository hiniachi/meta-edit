# Grant binding fails: canonicalization parity break + mandatory empty-create-first + parallel race

- Filed: 2026-05-17
- Severity: HIGH (typed-edit surface effectively unusable under jj working copies / interleaved or parallel writes)
- Status: fixing (full scope, per user direction)

## Symptom

`edit_docs_only` (and other typed_edit) declarations succeed and return
a token, but the immediately-following native `Write` is denied by
`deny-raw-edit` with **"no active typed_edit declaration covers this
file"**. In a real session ~34 attempts, only 1 (I-1077) succeeded.
The only reliable success pattern: `rm` → native empty `Write`
(hook: "empty file create authorized") → declare → content `Write`,
all strictly consecutive. Any interleaved op (batch declare, parallel
Write, ToolSearch, AskUserQuestion) between empty-create and content
Write → denied even within TTL, single file, immediately after
declaration. 8 parallel Writes against one multi-file grant → all
denied except 1.

## Root cause (three compounding causes; grant store data model is sound)

Hypothesis "single pending slot" is FALSE: grants are per-token files
with N per-file bindings, `findActiveBindingForFile` scans all pending
(`src/state/grants.ts:456-511`). The real causes:

1. **Canonicalization parity break (existence-sensitive realpath).**
   Issue side (`src/tools/common.ts:384` `checkPathSafety`) and consume
   side (`src/hooks/raw-edit-policy.ts:432` `canonicalizeForBinding`)
   both call `realpathOfDeepestExisting` (`src/utils/realpath.ts`),
   which realpaths the **full path including the leaf when the leaf
   exists**, but returns parent-realpath + lexical leaf when it does
   not. Issuance hard-requires the file to exist
   (`src/tools/common.ts:466-483`), so the issue side always takes the
   "exists" branch; the consume side takes whichever branch matches the
   file state at hook time. With any symlink in the path (jj working
   copies are frequently under symlinked / realpath-divergent paths)
   the two canonical strings differ → exact-string match miss at
   `grants.ts:496` → the observed deny.

2. **Repo-root resolution divergence.** Server root source =
   `--repo-root`/`$META_EDIT_REPO_ROOT`/`process.cwd()`
   (`src/server.ts` `resolveRepoRoot`); hook root source = Claude Code
   `event.cwd`/`$META_EDIT_REPO_ROOT`/`process.cwd()`
   (`src/hooks/deny-raw-edit.ts:73-82`). PR #74 made the precedence
   *shape* identical but the *inputs* are different actors and neither
   side does upward `.jj`/`.git` discovery or realpath at the
   root-resolution layer; the realpath-failure fallbacks also differ
   (`realpathOrSelf` returns the unresolved path;
   `realpathOrSelfSync` returns `path.resolve`). A jj working copy
   launched not-at-root, or symlinked, gives the two sides different
   roots → diverging repo-relative keys. `.jj`-only repos pass the
   sentinel but get no root discovery.

3. **Mandatory empty-create-first + before_sha256 staleness + LIFO.**
   `computeBeforeSha256` rejects non-existent files
   (`src/tools/common.ts:466-483`), forcing the fragile
   `rm → empty Write → declare → content Write` dance whose
   empty-create authorization persists no grant. The before_sha256
   gate (`src/hooks/raw-edit-policy.ts:341-349`) denies on ANY disk
   change between declare and write (this is the "denied within TTL"
   report — not expiry). LIFO most-recent-grant selection
   (`grants.ts:499-508`) lets an interleaved declaration hijack an
   earlier file's pending write.

4. **Parallel race (secondary).** The hook is a single-shot process per
   native edit; `withSharedLock` (`grants.ts:181-211`) is per-process
   and shares nothing across concurrent hook invocations
   (`raw-edit-policy.ts:351-361` admits this). N parallel Writes race
   `consume` → only 1 lands.

## Fix (full scope, user-approved)

1. Shared `src/utils/repo-paths.ts`: one `resolveRepoRoot` with upward
   `.jj`/`.git` discovery + realpath, used by server + both hooks
   (delete the three local copies — parity becomes structural, not
   comment-enforced). One existence-independent canonicalizer
   (realpath the deepest existing **directory**, re-attach the rest —
   including the leaf — lexically; never realpath the leaf) used by
   both `checkPathSafety` and `canonicalizeForBinding`.
2. Drop the empty-create-first requirement: `computeBeforeSha256`
   ENOENT → `before_sha256 = sha256("")` instead of reject. SPEC
   §3/§5.1 updated. (Reverses the v0.3.1 decision per user direction.)
3. Cross-process advisory file lock around `consume`; grant selection
   prefers the candidate whose `before_sha256` matches current disk
   (no interleave hijack).
4. Categorized deny reasons (`undeclared` / `path-mismatch` /
   `stale` / `expired` / `consumed`) with the computed canonical +
   repoRoot surfaced for diagnosis.

(Pre-existing latent bug noted in passing:
`src/state/protected-paths.ts:54` checks `p.includes(" ")` where it
clearly intends `"\0"` — paths containing a space throw "path
contains NUL byte". Out of this fix's scope; recorded here so it is
not lost.)

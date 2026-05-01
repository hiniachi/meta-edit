# Unit D — Docs + version bump

## Scope

- `docs/SPEC.md §3` validation rules (the type block was updated in
  Unit A; this is the surrounding rule prose).
- `OBSERVED-FAILURES.md` — move item 9 to "Resolved (promoted to
  MVP)" with an accurate description of what landed.
- `IMPLEMENTATION-LOG.md` — append a `v0.1.2 PR D` section.
- `package.json` — bump `version` to `0.1.2`.
- `.claude-plugin/plugin.json` — same bump.

## Files touched

- `docs/SPEC.md`
- `OBSERVED-FAILURES.md`
- `IMPLEMENTATION-LOG.md`
- `README.md` — update any reference to `patch:` field, "patch body
  is not stored" line, and any code-snippet showing the old request
  shape. (`grep -n 'patch' README.md` first to enumerate; expect a
  small number of hits.)
- `package.json` (version bump)
- `.claude-plugin/plugin.json` (version bump)
- `dist/cli.js`, `dist/cli.js.map`, `dist/server.js`,
  `dist/server.js.map`, `dist/hooks/deny-bash-write-bypass.js`,
  `dist/hooks/deny-bash-write-bypass.js.map`,
  `dist/hooks/deny-raw-edit.js`, `dist/hooks/deny-raw-edit.js.map`
  — committed build artifacts (per `package.json` `files: ["dist/", ...]`).
  Regenerate via `bun run build` and stage with `git add -A`.

## Preconditions

- Unit AB landed (Unit D references the new schema). Can run in
  parallel with Unit C (no overlapping files).

## Step-by-step tasks

1. **`docs/SPEC.md §3` validation rules** (the bulleted list in
   "Argument validation"):
   - Replace the bullets that mention `patch must apply cleanly`,
     `patch must contain only modifications to existing files`,
     `Every file path appearing inside the patch is validated...`
     with the new equivalents:
     - `changes must be a non-empty array`
     - `each change.file is validated under the same path-safety
       rules as target_file`
     - `total payload bytes (Buffer.byteLength(old_content,'utf8')
       + Buffer.byteLength(new_content,'utf8') summed across all
       changes) must not exceed MAX_CHANGE_BYTES (1 MiB)`
     - `change.file must reference an existing file on disk;
       missing files fail the call (modify-only, no creation
       through the content-pair shape)`
     - `change.old_content must equal the current disk content of
       change.file byte-for-byte at apply time (precondition); a
       mismatch fails the entire call without writing anything`
     - `apply is two-phase: precondition check (no writes) →
       per-change temp-write → rename. If any precondition fails
       OR any temp-write fails, NO target file is modified.
       Rename failures after some renames committed are reported
       as warnings (best-effort multi-file atomicity on POSIX)`

2. **`docs/SPEC.md §3` patch-scope section**: rewrite to reference
   `changes[]` instead of patch hunks. Same allow-list semantics
   (target_file ∪ test_files). The duplicate-canonical rule
   becomes "duplicate `change.file` entries are rejected".

3. **`docs/SPEC.md §6` edit log**: keep `patch_size_bytes` field
   name; add a one-line note that the value is the byte length of
   the synthesized unified diff
   (`Diff.createTwoFilesPatch` joined across changes), not the
   length of any incoming patch.

4. **`OBSERVED-FAILURES.md`**: remove the "Phase 3 (validation)
   tool-surface DX gaps" section; add a new "Resolved" entry:

   > **Patch field replaced with content-pair changes** (v0.1.2).
   > `EditToolRequest` no longer takes `patch: string`; the new
   > shape is `{ ..., changes: [{file, old_content, new_content}] }`.
   > The server reads each file from disk and asserts
   > `current === old_content` before any atomic write, so stale
   > content fails the call without partial state. Resolves the
   > prior MEDIUM "Hand-crafted unified diffs are brittle for
   > multi-line additions" entry by replacing the brittle authoring
   > path entirely. Option B from the original entry; chosen by user
   > directive for v0.1.2. Breaking change with no compat shim —
   > callers must migrate.

5. **`IMPLEMENTATION-LOG.md`**: append a `v0.1.2 PR D` section
   covering: scope, what landed, files touched, tests added,
   spec deviations (none — verbatim sync), known issues (none).

6. **Version bump**: `package.json` 0.1.1 → 0.1.2; same for
   `.claude-plugin/plugin.json`.

## Tests

No new tests. The verbatim-sync rule between SPEC.md §3 and
`common.ts` is enforced manually; consider a future test if the
divergence becomes a recurring issue.

## Verification commands

```bash
bun test           # green
bun run typecheck
bun run build
grep -n "patch:" docs/SPEC.md   # should show only "patch_size_bytes" mentions
```

## Exit criteria

- All five files touched as listed.
- `bun test` green; `bun run build` regenerates `dist/`.
- `OBSERVED-FAILURES.md` "Phase 3 DX gaps" section is gone; a new
  entry exists in "Resolved".

## Rollback

`git restore <files>`.

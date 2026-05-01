# Unit C — Tests rewrite

## Scope

Rewrite all unit and integration tests that reference the old
`patch` field shape. Add coverage for the new behaviors
(stale-content precondition, atomicity-on-precondition-failure,
multi-change scoping).

## Files touched

- `src/tools/common.test.ts` — primary rewrite. Most existing tests
  use a `patch` literal; switch to `changes` literal.
- `src/tools/apply.test.ts` (if exists) — rewrite to new shape.
- `src/tools/registry.test.ts` — adjust the `inputSchema`-shape
  assertions (currently they may inspect `required` / `properties`).
- Any integration tests under `src/tools/__tests__/*` — same.

(Quick `grep`/`Glob` first to enumerate exact files.)

## Preconditions

- Unit A and Unit B merged. Typecheck and build are green.

## Step-by-step tasks

1. Enumerate test files importing or constructing
   `EditToolRequest` / `patch`:

   ```bash
   grep -rln "patch:" src/tools src/state 2>/dev/null
   grep -rln "EditToolRequest" src/ 2>/dev/null
   ```

2. For each existing test:
   - Replace `patch: "..."` literal with
     `changes: [{ file: "<target>", old_content: "...", new_content: "..." }]`.
   - For tests that exercised patch-format validation
     (NUL byte rejection, oversized patch, forbidden git extended
     headers, malformed unified diff), either:
     - Adapt to the new equivalent (NUL-in-content rejection,
       `MAX_CHANGE_BYTES` rejection), OR
     - Delete the test and document the deletion (extended-headers
       test is no longer applicable; the format is gone).
   - For tests that exercised c/d-prefix or rename rejection in
     diff headers, **delete**. Those edge cases don't exist in the
     new shape.

3. **New tests** (add to `common.test.ts` and/or `apply.test.ts`):

   - **Stale `old_content`**: write a fixture file with content
     `"v1"`, send a request with `old_content: "v0"` (mismatched).
     Expect `applied: false`, warning mentions stale-content, file
     content unchanged on disk.
   - **All-or-nothing on precondition mismatch**: 2 changes, the
     first valid, the second has stale `old_content`. Expect
     NEITHER file modified, `applied: false`, BOTH writes deferred
     (pre-flight phase 1 caught the mismatch before phase 2
     temp-writes).
   - **Two-phase commit holds on temp-write failure**: simulate a
     temp-write failure on the second of two changes (e.g. by
     making `.meta-edit/tmp` un-writable mid-test, or by mocking
     `fs.openSync` for the temp file). Expect: NEITHER target
     file modified, all temp files cleaned up, `applied: false`.
   - **Empty `changes`**: zod schema rejects with a clear message.
   - **Total payload bound**: a single `new_content` of 2 MiB
     (over `MAX_CHANGE_BYTES`) is rejected. Bytes measured via
     `Buffer.byteLength(s, "utf8")`.
   - **NUL byte in `old_content`** rejected.
   - **NUL byte in `new_content`** rejected.
   - **Multi-change happy path**: 2 changes within
     `target_file + test_files`, both succeed, both files written
     atomically, log records the synthesized patch size
     (`patch_size_bytes` ≈ length of joined `createTwoFilesPatch`
     output).
   - **Duplicate canonical**: 2 changes with same `file` (post-
     canonicalization). Expect `applied: false` with a clear
     "multiple changes targeting" warning.
   - **Path-safety: change.file in test_files but not target_file
     for non-test-only tool**: should succeed (test_files entries
     are within scope).
   - **Path-safety: edit_test_only_change scope**: the only
     allowed `change.file` is `target_file`. A change pointing at
     a file in `test_files` (which must itself be empty for this
     tool) or any other path is rejected.
   - **ENOENT at apply time**: `change.file` resolves to a path
     that does not exist on disk. Expect `applied: false`,
     warning mentions "file does not exist; modify-only", file
     not created.
   - **EACCES at apply time** (skip on platforms that don't
     support chmod 0): make a fixture file unreadable
     (`fs.chmodSync(file, 0)`), expect a clear warning, file
     unmodified. Restore mode in `afterEach`.
   - **Per-tool parameterization**: validate that the schema works
     for all 18 tools (loop over `TOOL_NAMES`).

4. **`registry.test.ts`**: update any assertions that inspect the
   JSON Schema shape. Add a new assertion: the schema's
   `required` includes `["target_file", "rationale", "risk_level",
   "test_files", "changes"]` and excludes `"patch"`.

## Verification commands

```bash
bun test                # full suite must be GREEN
bun run typecheck
bun run build
```

## Exit criteria

- `bun test` shows 0 fail.
- New test count ≥ 8 (the new-test list above).
- Old patch-format-specific tests are either adapted or explicitly
  removed with a one-line note in the test file (e.g. removed
  `# extended-headers tests removed in v0.1.2 — patch format gone`).

## Rollback

`git restore <test files>` and re-run `bun test`.

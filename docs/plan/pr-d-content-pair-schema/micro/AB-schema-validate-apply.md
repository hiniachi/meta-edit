# Unit AB — Schema + validation + apply (merged)

## Why merged

Codex Phase-7 review (LOW): Unit A alone left `validateRequest`
referencing `request.patch` and `MAX_PATCH_BYTES`, breaking typecheck
across the unit boundary. This unit ships the schema swap, the
validation rewrite, and the apply rewrite in one logical commit so
the working tree stays compileable.

## Scope

Replace the patch-format request shape with content-pair changes,
end-to-end:

- TypeScript / zod (`src/tools/common.ts`)
- MCP `inputSchema` JSON Schema (`src/tools/registry.ts`)
- Spec type definition (`docs/SPEC.md` §3 — type block only; the
  validation-rules text is updated by Unit D)
- `validateRequest` validation (`src/tools/common.ts`)
- `applyChanges` apply path (`src/tools/apply.ts`)
- Edit-log forensic synthesized diff in `makeApplyingHandler`

## Files touched

- `src/tools/common.ts` — schema, types, `validateRequest`,
  `makeApplyingHandler`. Drop `parsePatch`/`StructuredPatch` import
  (keep `Diff` namespace import for `createTwoFilesPatch`). Drop
  `MAX_PATCH_BYTES`, `FORBIDDEN_EXTENDED_HEADERS`,
  `preValidatePatchInput`, `classifyPatchFile`,
  `PatchFileClassification`, `trimDiffHeader`, `stripSingleCharPrefix`,
  `PatchChange`. Add `ChangeSchema`, `Change`, `ContentChange`,
  `MAX_CHANGE_BYTES`.
- `src/tools/registry.ts` — replace hardcoded `inputSchema`.
- `src/tools/apply.ts` — rewrite `applyChanges` to take
  `ContentChange[]`, do precondition phase + temp-write phase +
  rename phase. Drop `applyPatch` import.
- `docs/SPEC.md` §3 — replace the `EditToolRequest` type block.
  (Validation-rules prose updated by Unit D.)

## Preconditions

- On branch `feat!/v0.1.2-replace-patch-with-content-pair` from main.
- `bun test` green at branch start (it is).

## Step-by-step tasks

### `src/tools/common.ts`

1. Replace the schema block (around lines 14-25):

   ```typescript
   export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
   export type RiskLevel = z.infer<typeof RiskLevelSchema>;

   export const ChangeSchema = z.object({
     file: z.string().min(1),
     old_content: z.string(),
     new_content: z.string(),
   });
   export type Change = z.infer<typeof ChangeSchema>;

   export const EditToolRequestSchema = z.object({
     target_file: z.string().min(1),
     rationale: z.string(),
     risk_level: RiskLevelSchema,
     test_files: z.array(z.string()),
     changes: z.array(ChangeSchema).min(1),
   });
   export type EditToolRequest = z.infer<typeof EditToolRequestSchema>;
   ```

2. Replace the constants block:

   - Drop `MAX_PATCH_BYTES`, `FORBIDDEN_EXTENDED_HEADERS`.
   - Add:
     ```typescript
     // Defensive bound on total request payload size (sum of
     // Buffer.byteLength of every change.old_content and
     // change.new_content). Same 1 MiB ceiling as the prior
     // MAX_PATCH_BYTES, just measured on the new shape.
     export const MAX_CHANGE_BYTES = 1_048_576;
     ```

3. Replace `PatchChange` with `ContentChange`:

   ```typescript
   export type ContentChange = {
     canonical: string;        // canonical repo-relative path
     oldContent: string;
     newContent: string;
   };
   ```

4. Replace `ValidationSuccess.changes`:

   ```typescript
   export type ValidationSuccess = {
     ok: true;
     touchedFiles: string[];
     changes: ContentChange[];
   };
   ```

5. Rewrite `validateRequest`:

   - rationale non-empty (unchanged)
   - test_files cardinality (unchanged: empty for
     `edit_test_only_change`; non-empty for
     `TOOLS_REQUIRING_TEST_FILES`)
   - target_file path-safety (unchanged)
   - test_files path-safety (unchanged)
   - **changes cardinality**: `request.changes.length === 0` →
     warning `"changes must contain at least one entry"` (zod
     enforces this too, but defensive)
   - **total payload bound**: compute
     `total = Σ Buffer.byteLength(c.old_content,'utf8') + Buffer.byteLength(c.new_content,'utf8')`
     across all changes. If `total > MAX_CHANGE_BYTES`, fail with
     a clear message.
   - **per-change checks** (in a single loop):
     - path-safety on `change.file` via `checkPathSafety`. If
       fails, push warning. Continue (collect all warnings, then
       fail-closed).
     - reject NUL byte in `change.old_content` or
       `change.new_content`.
   - Build `touched` and `changes: ContentChange[]` from the
     successful path-safety results.
   - Patch scope: every `change.canonical` must be in `allowed`
     (= target_file canonical ∪ test_files canonicals; for
     `edit_test_only_change`, only `target_file`).
   - **No-duplicate-canonical** check (preserves prior multi-section
     dedup intent).
   - Return `{ ok: true, touchedFiles, changes }`.

6. Rewrite `makeApplyingHandler`:

   - Move `patch_size_bytes` calculation to BEFORE the apply call
     so we can record it on both the success and failure paths
     (the value is computed from request inputs, not from any
     disk read):
     ```typescript
     let synthesized = "";
     for (const c of args.changes) {
       synthesized += Diff.createTwoFilesPatch(
         c.file, c.file,
         c.old_content, c.new_content,
         "old", "new",
       );
     }
     const patchSize = Buffer.byteLength(synthesized, "utf8");
     ```
   - On validation failure: log entry has `applied: false`,
     `patch_size_bytes: patchSize`, and the validation warnings.
   - On validation success: pass `validation.changes` to
     `applyChanges`. Final `applied` reflects apply result;
     warnings forwarded.

### `src/tools/registry.ts`

7. Replace the hardcoded `inputSchema` (lines 14-43) with the new
   shape:

   ```typescript
   const inputSchema = {
     type: "object",
     required: ["target_file", "rationale", "risk_level", "test_files", "changes"],
     properties: {
       target_file: { type: "string", description: "Repository-relative path to the file being edited (or the primary file when changes touch multiple)." },
       rationale: { type: "string", description: "1-3 sentences explaining why this edit is being made." },
       risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
       test_files: { type: "array", items: { type: "string" }, description: "Repository-relative paths of test files relevant to this edit." },
       changes: {
         type: "array",
         minItems: 1,
         items: {
           type: "object",
           required: ["file", "old_content", "new_content"],
           properties: {
             file: { type: "string", description: "Repository-relative path of the file to modify. Modify-only — no create / delete / rename." },
             old_content: { type: "string", description: "Exact current content of the file. The server compares byte-for-byte at apply time and rejects the call if disk content differs." },
             new_content: { type: "string", description: "New content to write to the file." },
           },
           additionalProperties: false,
         },
       },
     },
     additionalProperties: false,
   } as const;
   ```

### `src/tools/apply.ts`

8. Update imports: drop `applyPatch` and `StructuredPatch`. Add
   `ContentChange` from `./common.js`.

9. Rewrite `applyChanges(repoRoot, changes: ContentChange[])`:

   The existing atomic-write helpers in `apply.ts` use a **sibling
   temp file** in the same directory as the target (e.g.
   `<target>.<random>.metaedit-tmp`), NOT `.meta-edit/tmp/`. This
   sidesteps the `isProtectedPath` concern (the temp is alongside
   the target, never in the protected `.meta-edit/tmp/`) and
   guarantees same-filesystem rename. We reuse this pattern.

   ```
   Phase 1 — preflight (no writes):
     For each change:
       - Re-canonicalize the resolved target via realpath (TOCTOU
         guard, same as the existing applyChanges).
       - Re-run isProtectedPath on the canonicalized form against
         target_file (rejects symlink-into-protected races).
       - Read disk content via fs.readFileSync(realAbs, "utf8").
         ENOENT → push warning "file does not exist; modify-only
         requires the file already exist".
         EACCES / other → push warning with errno.
       - If the file existed and read succeeded:
         compare current === old_content (byte-for-byte). On
         mismatch, push "stale old_content; disk content has
         changed since the request was prepared".
     If ANY warning collected in this phase → return
     { applied: false, warnings } WITHOUT WRITING ANYTHING.

   Phase 2 — sibling temp writes (no rename yet):
     For each change:
       - tempPath = path.join(parent_of_target, target_basename +
         "." + crypto.randomBytes(6).hex + ".metaedit-tmp")
       - openSync with O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW,
         mode 0o600.
       - writeSync new_content. fsyncSync the file. closeSync.
       - Record the (temp path, target real path) pair.
     If ANY temp-write failure → cleanup all temps written so far
     (unlinkSync each, ignoring ENOENT) and return
     { applied: false, warnings: [reason] }. NO TARGET FILE HAS
     BEEN MODIFIED at this point.

   Phase 3 — rename commits:
     For each (temp, target) pair, in order:
       - parentDriftCheck (existing helper) immediately before
         rename; if the canonical parent has shifted under us,
         abort and cleanup remaining temps.
       - renameSync(temp, target)  (atomic on POSIX, same FS)
       - fsyncSync the parent dir of target (durability)
     If a rename fails part-way, accumulate a warning that lists
     which renames committed before the failure (best-effort
     multi-file atomicity on POSIX) and return { applied: false,
     warnings }.
     Otherwise return { applied: true, warnings: [] }.
   ```

   Implementation note: `.meta-edit/tmp/` is **not** used. The
   `isProtectedPath` check applies to the request's `target_file`
   and `change.file` paths, which the caller controls. Apply's own
   temp files live next to the target and never trip protected-path
   enforcement.

10. Drop the `parsePatch`-era helpers / paths. Keep
    `ensureNoSymlinkOnPath`, the canonical-vs-repo-root checks, and
    the `O_NOFOLLOW` open from Phase 3 hardening.

### `docs/SPEC.md` §3 type block

11. Replace the TS type block in §3 (around lines 71-95). Validation-
    rules prose stays for now; Unit D rewrites it. The type block
    must be byte-identical with the new `EditToolRequestSchema`.

## Tests

This unit ships no new tests. Existing tests still reference
`patch` and will be red. Unit C closes that gap.

## Verification commands

```bash
bun run typecheck         # must be CLEAN (the unit's exit gate)
bun run build             # must succeed (validates ESM exports)
# bun test                # red — expected; Unit C closes
```

## Exit criteria

- `bun run typecheck` exits 0.
- `bun run build` exits 0.
- `git diff` touches only:
  `src/tools/common.ts`, `src/tools/registry.ts`,
  `src/tools/apply.ts`, `docs/SPEC.md`. No other files.

## Rollback

`git restore src/tools/common.ts src/tools/registry.ts src/tools/apply.ts docs/SPEC.md`.

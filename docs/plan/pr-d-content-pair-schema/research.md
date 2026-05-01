# Research & Reuse — PR D content-pair schema rewrite

## Sub-problems

1. **MCP request shape**: replace `patch: string` (unified diff) with
   `changes: [{file, old_content, new_content}]` (raw content pairs).
   18 tools share the same request shape.
2. **Validation**: rationale, test_files cardinality, path safety,
   patch scope, modify-only — preserve all of these but operate on
   the new shape.
3. **Apply**: read current file, assert `current === old_content`
   (precondition), atomically write `new_content`. TOCTOU re-realpath
   guarantee from Phase 3 hardening must continue to hold.
4. **Edit log**: keep field shape per `SPEC.md §6` (incl.
   `patch_size_bytes`); compute the value from a synthesized unified
   diff via `Diff.createTwoFilesPatch` for forensic continuity.
5. **Spec sync**: `docs/SPEC.md §3` updated verbatim; `descriptions.ts`
   §4 unaffected (descriptions never reference `patch` directly).
6. **Tests**: `common.test.ts`, `apply.test.ts`, `registry.test.ts`,
   integration tests under `src/tools/__tests__` if any; all rewritten
   to the new shape.

## Candidates

| id | source | type | license | fit % | notes |
|---|---|---|---|---|---|
| C1 | `diff` package (already in deps, ^9.x) `createTwoFilesPatch` | inline import | BSD-3 | 100% | Already used implicitly by `parsePatch`/`applyPatch`. The export exists in v9. Used to synthesize a unified diff string from old/new content for `patch_size_bytes` log forensics. |
| C2 | `zod` (already in deps) discriminated union | inline import | MIT | n/a | NOT NEEDED — user directive is "新形式のみ、patch 廃止"; the schema is a single-shape object, not a union. Drop `patch`, add `changes`. |
| C3 | `Buffer.byteLength(string, "utf8")` | inline | core | 100% | Already used at `common.ts:274` for `patch_size_bytes`; reuse unchanged on the synthesized diff string. |
| C4 | Existing `checkPathSafety` (common.ts:440) | inline | n/a | 100% | Reused on `target_file`, each `test_files` entry, and each `change.file`. No behavior change to `checkPathSafety` itself. |
| C5 | Existing `apply.ts` atomic-write path (`O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW`, fsync, rename, parent fsync) | inline | n/a | 100% | Reused. The input shape changes from `StructuredPatch[]` to `ContentChange[]`; the write phase is unchanged. The TOCTOU re-realpath check before each write also unchanged. |

## Verdicts

| sub-problem | adopt/port/wrap/build-new | rationale |
|---|---|---|
| 1 (MCP shape) | build-new | The schema *is* the breaking change; cannot be adopted. The TS / zod / JSON-Schema declaration is small (~40 lines) and replaces a similarly-sized old block. |
| 2 (validation) | port | Port the existing `validateRequest` validations from patch-based to content-pair-based. The non-patch checks (rationale, test_files cardinality, path safety, scope) are unchanged conceptually; the patch-format checks (`preValidatePatchInput`, `parsePatch`, `classifyPatchFile`) are dropped, replaced with a per-change preconditions read. |
| 3 (apply) | port + adopt C1 | Port the atomic-write path. Adopt `createTwoFilesPatch` for forensic-only diff bytes. Read-current + precondition compare is build-new (~10 lines). |
| 4 (edit log) | adopt | Reuse `EditLogEntrySchema` shape; populate `patch_size_bytes` from synthesized diff. No schema migration needed. |
| 5 (spec sync) | port | Replace SPEC §3 type / validation / patch-scope sections; descriptions §4 unchanged. |
| 6 (tests) | port | Rewrite each test to the new shape. The semantics being asserted are mostly preserved (path safety, scope, modify-only, atomicity). Stale-old-content is a new test class. |

`build-new` for sub-problem 1 is forced by the user directive — the
schema change *is* the deliverable; no candidate library resolves it.

## References

- Existing plan section: `~/.claude/plans/observed-failures-md-v0-2-v0-1-2-pr-code-snug-ember.md` "PR D" subsection.
- `OBSERVED-FAILURES.md` Phase 3 DX gap, Option B (the user-confirmed direction).
- `docs/SPEC.md §3` (current `EditToolRequest` definition + validation rules).
- `src/tools/common.ts` (current `EditToolRequestSchema`, `validateRequest`, `preValidatePatchInput`, `classifyPatchFile`, `makeApplyingHandler`).
- `src/tools/registry.ts:14-43` (hardcoded JSON Schema mirroring zod).
- `src/tools/apply.ts` (atomic write path, TOCTOU guard).
- `src/state/edit-log.ts` (TypeScript `EditLogEntry` interface on
  current main; PR C — open at #28 — adds `EditLogEntrySchema` zod
  schema. PR D does not depend on PR C; the log writer uses the
  `append(entry)` interface unchanged. If PR C merges first, no
  conflict; if not, no behavioral interaction either way.)

## Out of scope

- Backward compatibility for the old `patch` field. Per user
  directive: drop entirely, no deprecation.
- Migrating older `edits.jsonl` lines. The log shape is unchanged
  (only the *value* of `patch_size_bytes` changes meaning); old
  lines still parse.
- `EditLogEntrySchema` rename of `patch_size_bytes`. Keep field name
  for log compat; semantics shift to "synthesized unified diff size
  in bytes". Document the shift in IMPLEMENTATION-LOG.

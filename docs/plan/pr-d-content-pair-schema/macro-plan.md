# Macro plan — PR D: replace `patch` with content-pair schema

## Objective

Replace the `patch: string` field on the eighteen `edit_*` MCP tools
with a `changes: [{file, old_content, new_content}]` array. The server
validates each change against disk content (precondition: `current ===
old_content`), atomically writes `new_content`, and logs a synthesized
unified diff for forensic continuity. **Breaking change**:

- Drop `patch` entirely (no deprecation period).
- Drop server-side dependence on `parsePatch` / `applyPatch` /
  `classifyPatchFile` / `preValidatePatchInput`.
- Bump `package.json` and `.claude-plugin/plugin.json` to `0.1.2`
  (umbrella v0.1.2 milestone, per session plan).

## Non-goals

- No backward compatibility for clients still sending `patch`.
- No migration of existing `edits.jsonl`. Log shape unchanged; the
  `patch_size_bytes` value semantics shift to "synthesized unified
  diff size".
- No discriminated union (user directive: "新形式のみ、patch 廃止").
- No change to `descriptions.ts` text — the eighteen descriptions do
  not reference `patch` by name.

## Success criteria

1. The MCP server accepts the new request shape and rejects the old
   `patch` field with a clear error.
2. Validation parity: every check the old `validateRequest` ran
   (rationale, test_files cardinality, path safety, scope, modify-
   only, multi-section dedup) has an equivalent check on the new
   shape; semantically equivalent error messages.
3. Apply parity: atomic write contract preserved; TOCTOU re-realpath
   guarantee preserved; symlink defenses preserved; on stale
   `old_content` mismatch the call fails with `applied: false` and a
   clear warning, with NO disk writes performed.
4. Edit log entry shape unchanged (`SPEC.md §6`); `patch_size_bytes`
   is populated with the byte length of `Diff.createTwoFilesPatch(...)`
   joined across changes.
5. SPEC §3 verbatim-synced with code (`EditToolRequestSchema`).
6. `bun test` green; `bun run typecheck` clean; `bun run build` clean.
7. Codex MCP review (Phase 7 plans, Phase 10 impl) returns no
   blocker / no high.

## Work Units

| id | title | depends_on | parallel_with | blast_radius |
|---|---|---|---|---|
| AB | Schema + validation + apply rewrite (common.ts type/zod + validateRequest + makeApplyingHandler; registry.ts JSON Schema; apply.ts two-phase write) | — | — | HIGH (touches every tool's runtime path; merged from former A+B because typecheck must stay green within the unit) |
| C | Tests rewrite (common.test.ts, apply.test.ts, registry.test.ts; cover schema-rejection, scope, stale-content, ENOENT, EACCES, atomicity, multi-change) | AB | — | MEDIUM (test-only, ~30+ tests) |
| D | Docs: SPEC.md §3 type + validation rules + §6 patch_size_bytes note; OBSERVED-FAILURES.md item 9 → Resolved; IMPLEMENTATION-LOG.md PR D entry; README.md status/snippet updates; version bump in package.json + .claude-plugin/plugin.json; commit regenerated dist/ | AB | C | LOW (docs+config) |

Unit D is annotated `parallel_with C` but is small enough that the
main agent will interleave inline. Effective ordering: AB → C → D.

**Why merged AB**: Unit A alone (schema only) leaves
`validateRequest` referencing `request.patch` and `MAX_PATCH_BYTES`,
breaking typecheck. Codex Phase-7 LOW pointed out the conflicting
"keep MAX_PATCH_BYTES for B" instruction. Cleaner to do schema +
validation + apply in one commit so typecheck stays green inside the
unit. Tests in C reference the new shape; before C, tests are red,
which is acceptable because the unit boundary is "compile + lint +
build green; tests update next."

## Risks & rollback

| risk | mitigation | rollback |
|---|---|---|
| Server crashes on first new request after deploy | Comprehensive zod validation; reject malformed requests with `applied: false` + warnings, never throw out of the handler | Revert PR by reverting the merge commit |
| Stale-content precondition false-positives on whitespace differences | Use exact byte equality (`Buffer.equals` / `===` on string), document that callers must send exact current content (no normalization) | Same — caller-side issue, server returns clear warning |
| TOCTOU race window between read-current and atomic-write enlarged | Re-run `realpath` + `isProtectedPath` immediately before the write (same as Phase 3 contract); read-current uses the canonical path | Same |
| Multi-change apply leaves partial state on mid-batch write failure | **Two-phase commit**: write all `new_content` to per-change temp files first; if any temp write fails, cleanup all temps and return `applied: false` with NO original modified. Only after ALL temp writes succeed do we run the renames. (Rename failures after some renames succeeded are still possible but vanishingly rare on POSIX; warned and reported.) | Caller observes `applied: false` with warnings listing which files were renamed before failure |
| Missing file (ENOENT at apply) silently treated as create | Apply-time read returns `null`; `current === null && old_content !== ""` → fail with "file does not exist" warning. `current === null && old_content === ""` is also rejected — content-pair shape is modify-only, not create. | Caller-side error |
| Edit log forward-compat (older readers) breaks because synthesized patch bytes differ from old `patch.length` | Field name unchanged; older readers see only a number. Document the semantic shift in IMPLEMENTATION-LOG | None needed |
| 18 tools share the schema → schema bug propagates to every tool simultaneously | Tests in C cover all eighteen via parameterization of `TOOL_NAMES` | Revert PR |

## Validation commands

```bash
# Per work unit:
bun run typecheck
bun test src/tools/         # unit C completion
bun test                    # full suite, after unit C
bun run build               # dist/ regen

# End-to-end smoke (manual):
node dist/cli.js serve  # then drive a sample request from a test harness

# Diff vs main (for codex gate input):
git diff main -- '*.ts' '*.md' '*.json' :!dist/

# PR creation (Phase 10 pass):
gh pr create --title '...' --body '...'
```

## Phase 9 reviewer routing (per mmpi)

Diff is TypeScript-heavy and ≥150 LOC (full schema rewrite + apply
rewrite). The mmpi rule routes to `*-reviewer` for the dominant
language when it exists. Available subagent in this environment is
`feature-dev:code-reviewer` — use it as the Phase 9 reviewer (only
one invocation; specialist `typescript-reviewer` is not registered).

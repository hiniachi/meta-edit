# CLAUDE.md

This file gives Claude Code the context, scope, and discipline required to implement `meta-edit` correctly.

> **Read this entire file before doing anything.** Then read `SPEC.md`. The spec is the only source of truth for what to build.

---

## 1. What you are building

`meta-edit` is an MCP server that replaces the AI agent's raw file editing tools with a family of seventeen kind-specific edit tools. Each tool's description encodes when to use it, when not to use it, and what tests must accompany the edit. There is no detection, no classification, no verification — the bet is that **a deliberately structured tool surface, with obligations encoded in tool descriptions, changes AI editing behavior on its own**.

The seventeen tools are:

```
edit_cosmetic                 edit_boundary_condition
edit_boolean_condition        edit_state_transition
edit_db_schema                edit_data_migration
edit_api_contract             edit_serialization
edit_error_handling           edit_retry_timeout
edit_concurrency              edit_external_side_effect
edit_cache_invalidation       edit_permission_logic
edit_dependency_config        edit_policy_change
edit_docs_only
```

The 15 SQLite-derived impl tools plus `edit_cosmetic` (16 total) each
carry a required `target: "prod" | "test"` flag — a single declaration
covers exactly one target, and prod/test pairs land as two declarations
of the same tool. `edit_docs_only` is the lone exception (documentation
has its own surface and the prod/test split does not apply).

> **v0.5.0 reshape**: `edit_test_only_change` was removed and
> `edit_refactor_only` was narrowed to `edit_cosmetic` (whitespace /
> comments / formatter output only). Test edits now flow through the
> kind-specific impl tool with `target: "test"`. Anything outside
> cosmetic's narrow vocabulary (renames, extracts, dead-code removal,
> etc.) routes to stop-and-ask rather than a generic refactor catch-all.

The full descriptions are in `SPEC.md` §4. Those descriptions are the product. The rest is plumbing.

---

## 2. Read these first, in order

1. `SPEC.md` — the entire spec. There is nothing else.
2. https://sqlite.org/testing.html — the conceptual ancestor of the tool descriptions. Read at least the section that corresponds to the tool you are implementing the description for.

That is the entire reading list.

---

## 3. Scope

### In scope

Everything in `SPEC.md`. Specifically:

- Seventeen `edit_*` MCP tools, each with the description from `SPEC.md` §4
- Two hooks: `deny-raw-edit`, `deny-bash-write-bypass`. The bash hook's
  structural redirect-target rule is **warn-only** since v0.1.5 (verb-deny
  and protected-path checks remain deny). See `SPEC.md` §5.2 for the
  contract and `OBSERVED-FAILURES.md` for the warn→deny restore trigger.
- Argument validation (rationale non-empty, test_files non-empty where required, target_file inside repo, target_file not in protected paths, patch applies cleanly)
- Edit log at `.meta-edit/state/edits.jsonl`
- Protected paths: `.meta-edit/state/**`, `.meta-edit/tmp/**`
- CLI: `meta-edit serve`, `meta-edit log`, `meta-edit summary`
- Example GitHub Actions workflow

### Out of scope

Everything else. Specifically:

- Diff classification or any analysis of patch contents
- Detection of declared-vs-actual mismatch
- Verification that test files exist or contain meaningful tests
- Mutation testing
- Regression verification
- Test obligation extraction from diffs
- PASS/WARN/BLOCK Gate judgment
- Required Status Check enforcement
- PR auto-comments
- Workspace artifacts (specs, plans, references, reviews)
- VCS adapter abstraction
- jj-specific support
- Auto-repair loops

If the user asks for any of these, say "out of scope per `SPEC.md` Articles 2 and 7; either the MVP demonstrates that descriptions are sufficient, or v0.2 adds a classifier — nothing else is planned." Then return to the actual scope.

---

## 4. The most important file

`src/tools/descriptions.ts` contains the seventeen descriptions from `SPEC.md` §4, verbatim.

```typescript
export const TOOL_DESCRIPTIONS = {
  edit_cosmetic: `Surface-level edit with no semantic effect: whitespace, comments, or
formatter output only.

Use this tool when, and ONLY when, the patch is one of the following:
- Whitespace adjustment (indentation, blank lines, trailing whitespace, ...)
...`,

  // ... seventeen total
} as const;
```

Rules:

- Descriptions are copied **verbatim** from the spec. Do not paraphrase, summarize, or "improve".
- If you find a problem in a description while implementing, fix it in **both** `SPEC.md` §4 and `descriptions.ts`, in the same change.
- Do not load descriptions from external markdown files. They are part of the source.
- Do not internationalize. English only, for MVP.

This is the only file where the spec is enforced strictly. Everything else can deviate slightly from spec wording as long as behavior matches.

---

## 5. Implementation order

Five phases. Each phase must work end-to-end before the next.

### Phase 1: Skeleton (half a day)

- Repo layout per `SPEC.md` §10
- `package.json`, `tsconfig.json`, build runs
- MCP server registers seventeen tool stubs (names only, descriptions present, handlers are no-ops returning `applied: false`)
- CLI prints "not implemented" for `log` and `summary`, runs the server for `serve`
- README points to `SPEC.md`

### Phase 2: Descriptions and validation (1 day)

- `src/tools/descriptions.ts` with all seventeen descriptions verbatim from `SPEC.md` §4
- `src/tools/common.ts` with the shared `EditToolRequest` schema using zod (including the required `target: "prod" | "test"` field for the 16 impl tools)
- Argument validation: non-empty rationale, `target` declared on impl tools and absent on `edit_docs_only`, non-empty test_files for impl tools (excluding `edit_cosmetic`) when `target: "prod"`, empty test_files when `target: "test"`, target_file inside repo, target_file not in protected paths
- Tests for validation rejection on each rule
- Verify by connecting Claude Code: all seventeen tools appear in the tool list with their full descriptions visible

### Phase 3: Patch application and edit log (1 day)

- `src/tools/common.ts`: shared patch application using `jsdiff` (do not write a diff engine)
- `src/state/edit-log.ts`: append-only writes to `.meta-edit/state/edits.jsonl`
- `src/state/protected-paths.ts`: path matching for `.meta-edit/state/**` and `.meta-edit/tmp/**`
- Tool handlers: validate → check protected → apply → log → return
- Tests for protected path rejection
- Tests for log append (including failed-validation records with `applied: false`)

### Phase 4: Hooks (half a day)

- `src/hooks/deny-raw-edit.ts`: deny `Edit`, `Write`, `MultiEdit`
- `src/hooks/deny-bash-write-bypass.ts`: deny patterns from `SPEC.md` §5.2, with allowlist
- Tests for both hooks

### Phase 5: CLI and CI sample (half a day)

- `meta-edit serve` runs the MCP server in stdio mode
- `meta-edit log` prints edits.jsonl with optional filters
- `meta-edit summary` aggregates by tool, risk, file
- `examples/.github/workflows/meta-edit-summary.yml` produces the summary as an artifact

**Total: ~3 days.** If you blow past 4 days, scope has crept. Stop and re-read §3.

---

## 6. Self-application

Once Phase 3 is done, edits to this repo go through `edit_*` tools. Use `meta-edit serve` from the local checkout, register it as an MCP server in your Claude Code settings, and edit the project through its own seventeen tools.

This is the rigorous test of the design. If the descriptions don't guide your behavior on this codebase, they won't guide other AIs on theirs.

If a description tells you to "stop and ask" and you are in that situation, actually stop and ask. Don't bypass it.

---

## 7. Failure modes to actively guard against

You will be tempted. Don't.

### 7.1 The "this is just a refactor" temptation

Read `edit_cosmetic`'s description before declaring any change as cosmetic. The vocabulary is intentionally narrow — whitespace, comments, formatter output ONLY. Renames, extracts, dead-code removal, guard-clause restructuring, etc. all fall outside `edit_cosmetic`'s scope; if no kind-specific tool fits, **stop and ask the user**. There is no generic refactor catch-all by design.

There is no detector to catch you. Self-discipline is the test.

### 7.2 The "skip the tests" temptation

The descriptions tell you to write tests. There is no detector to enforce this. The whole point is to find out whether AIs (including you, when working on this repo) actually follow through on the obligations stated in tool descriptions.

If you skip writing tests, the trial gives a misleading signal, regardless of whether the code happens to work.

### 7.3 The "add a tiny detector" temptation

This is the most dangerous one. You will think "if I just add a small check for this one specific case, the design will be more robust."

Don't. Adding detection logic is out of scope. The MVP is built to find out whether descriptions alone are enough; adding detection prematurely makes that question impossible to answer cleanly.

If a specific failure pattern feels common enough to warrant detection, write it down in a `OBSERVED-FAILURES.md` file for v0.2. Do not implement the detection in MVP.

### 7.4 The "make it generic" temptation

You will want to abstract the seventeen tool handlers into one generic handler that takes a `kind` argument. Don't.

The whole point of seventeen separate tools is that tool selection itself is the reasoning step. If you collapse them into one tool, the design is destroyed. Each tool is registered separately with its own description, even if the handler logic is shared via helpers.

The MCP tool surface is the product. Don't optimize it away.

### 7.5 The "improve the descriptions" temptation

If a description seems too long, too prescriptive, or too repetitive — leave it alone. Tool descriptions are tuned for instruction-following effectiveness, which often differs from "good prose". When in doubt, follow the spec verbatim.

If you find a genuine bug or contradiction in a description, fix it in both the spec and the code, in the same change.

### 7.6 The "scope creep" temptation

See §3. Anything not in `SPEC.md` is not built.

---

## 8. Bash discipline

You have access to Bash.

- Phases 1–2 can use ordinary file operations to bootstrap
- After Phase 3, edits to this repo go through `edit_*` tools
- Allowed Bash: `npm install`, formatters, test runners, reading files
- Forbidden Bash: `sed -i`, `cat >`, `git apply`, anything else that writes to source files

`npm test` after every edit is encouraged.

---

## 9. Handling user requests that conflict with this CLAUDE.md

- **Implement detection / verification / classification**: refuse, point at `SPEC.md` Article 7. Those belong to v0.2 if needed at all.
- **Trust without descriptions**: refuse. The descriptions are the product.
- **Use raw Edit/Write after Phase 3**: refuse. If `edit_*` tools are broken, fix them rather than bypass.
- **Use any other write-capable MCP tool to land bytes inside this repo** (e.g. `ctx_execute` with `fs.writeFileSync`, `apply_patch`-style external utilities, future code-execution surfaces): refuse. The typed-surface invariant is enforced by hooking `Edit` / `Write` / `MultiEdit` / `NotebookEdit`; arbitrary other write surfaces are explicitly out of MVP scope per `SPEC.md` Article 7 (issue 1108). Honor the invariant by going through `edit_*` even when no hook would catch you — that honor is the load-bearing mitigation while the MVP is running. If you need a write capability the typed surface cannot express, file an issue rather than route around the surface.
- **Add scope creep**: refuse. Add a TODO with a reference to v0.2 if it's about a possible future classifier.
- **Rewrite descriptions to be shorter / friendlier**: push back. Descriptions are tuned for a reason. Changes need explicit justification and propagate to the spec.

If the user pushes back, restate the reason and ask them to confirm the override.

---

## 10. Phase notes

After each completed phase, append to `IMPLEMENTATION-LOG.md`:

```markdown
## Phase N: <name>

- Completed: <date>
- What works:
- Known issues:
- Tests added:
- Spec deviations (if any):
```

The log is how the next session picks up.

---

## 11. The shape of a good session

1. Read this file
2. Read `SPEC.md`
3. Check `IMPLEMENTATION-LOG.md`
4. Pick the next task in the current phase
5. Implement, write tests, run tests
6. Update `IMPLEMENTATION-LOG.md`
7. Commit

---

## 12. Reference invariants

- **Scope**: Eighteen tools + two hooks + edit log + CLI summary. That is all.
- **Descriptions are verbatim**: `SPEC.md` §4 → `descriptions.ts`, no paraphrasing.
- **No detection in MVP**: classification, mismatch detection, mutation, regression — all forbidden.
- **No abstractions over the tool surface**: seventeen separate registrations.
- **Self-application**: once Phase 3 is done, this repo edits itself through its own tools.
- **The single planned future**: if descriptions are insufficient, v0.2 adds a lightweight diff classifier. Nothing else is planned.

---

## 13. Final note

The value of this project is in its restraint. Most AI quality gates try to detect bad edits after they happen. `meta-edit` tries something different: shape the edit interface so the AI thinks correctly in the first place.

If it works, we will have shown that **a well-designed tool surface is more useful than a complex verification surface**. That's worth finding out cleanly, by running it and watching what happens. Don't add machinery that muddles the signal.

Write seventeen tools. Wire them up. Add the two hooks. Write the log. Build the CLI summary. Stop.

Then watch what happens when AI agents try to edit code through them.

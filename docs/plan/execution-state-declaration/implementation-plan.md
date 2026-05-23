# `execution_state` Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required `execution_state` declaration field (`"normal" | "repeating_failure" | "recovery"`) to all 21 meta-edit typed-edit tools, with a soft `(kind × execution_state)` audit matrix and reminder branching.

**Architecture:** `execution_state` mirrors the existing `provenance` field (v0.6.0) at every threading site: request schema, MCP input schema, validation matrix, tool descriptions, grant metadata, edit log, reminders, hook, and CLI. It is a self-declared field the server stores and trusts — no detection. The only behavioural surface beyond storage is (a) one `warn` audit cell (impl tool × `repeating_failure`) and (b) `execution_state`-aware reminder text.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Bun (`bun test` / `bun run typecheck` / `bun run build`), zod, MCP SDK.

**Source of truth:** `docs/plan/execution-state-declaration/design.md` (revised after two review rounds; see its §10 decision log). This plan implements design §4 exactly.

**Revision history:** This is the third revision. v1 caught CRITICAL helper-name issues; v2 caught a `listTools` placeholder, a snake/camelCase mismatch at the reminder site, a mis-chosen test fixture cell, a mid-phase RED commit, and a stray mid-plan `bun run build`. v3 (this revision) addresses all of those.

**Conventions** anchored in the actual codebase (verified 2026-05-23):
- Real fixture helpers: `modifyReq` (nested in `describe("validateRequest — disk + path-safety")` in `common.test.ts`), `workflowReq(kind, provenance, overrides)` (nested in `describe("validateRequest — kind × provenance integration (v0.6.0)")` in `common.test.ts`, with module-level `ctx()` and block-level `ctx2()`), `modifyRequest` (module-level in `handler.test.ts`), `makeHandler()` (module-level in `handler.test.ts` — returns `{ handler, log, grants }`), `issued` / `consumed` / `rejected` / `makeTmpRoot` / `cleanTmpRoot` / `writeFileIn` / `sha256Hex` / `HEX64_A` (exported from `src/test-helpers.ts`), `binding(file, before?)` (module-level in `grants.test.ts`), `createGrantsStore(tmpRoot)` (constructed per-test inline), `issueGrant(grants, editId, binding, declaration?)` (module-level in `raw-edit-policy.test.ts`), `writeFile(rel, content)` (module-level helper in `raw-edit-policy.test.ts` wrapping `writeFileIn`).
- Handler invocation: two-arg `await handler(toolName, args)`.
- `src/tools/apply.test.ts` does **not** exist. `apply.ts` is tested by `src/tools/handler.test.ts`.
- `src/version.ts` derives `VERSION` from `package.json` via `import pkg from "../package.json" with { type: "json" }` — no edit needed.
- Test runner: `bun test <path>` for a single file; `bun test` for the suite. Tests import from `"bun:test"`.

**Line numbers** below are from a codebase map dated 2026-05-23. Anchor every edit to the **named symbol or quoted code**, and re-verify the line against `HEAD` before editing — line numbers drift.

**Self-application note:** This repo edits itself through its own typed tools (CLAUDE.md §6). Each implementation edit is a `typed_edit` declaration + native write. Suggested kinds: `EditToolRequestSchema` / `inputSchema` → `edit_api_contract`; validation / matrix / reminder / CLI logic → the kind matching the change (often `edit_boolean_condition`); `descriptions.ts` + `docs/SPEC.md` + version files → `edit_policy_change`; `IMPLEMENTATION-LOG.md` → `edit_progress`; `OBSERVED-FAILURES.md` → `edit_observation`; READMEs → `edit_explanation`. A production edit and its test edit are two declarations of the same tool (`target: "prod"` then `target: "test"`).

---

## File Structure

**Modified (no new source files):**

| File | Responsibility for this change |
|------|--------------------------------|
| `src/tools/common.ts` | `ExecutionStateSchema` enum; `execution_state` on `EditToolRequestSchema`; `evaluateKindExecutionStateValidity`; 4th `AuditWarning` code; `1d` block in `validateRequest` |
| `src/tools/registry.ts` | `execution_state` property block; add to both `required` arrays |
| `src/state/edit-log.ts` | `execution_state_repeating_failure` in `AuditWarningEntrySchema` (Phase 1); `execution_state` (optional-on-read) on `IssuedEntrySchema` + `RejectedEntrySchema` (Phase 2) |
| `src/state/grants.ts` | `execution_state` on `GrantDeclaration`; optional check in `isGrantDeclaration` |
| `src/reminders/context.ts` | `executionState?` on `ReminderInput`; `executionStateLine` builder; `WORKFLOW_KINDS` / `ESCAPE_KINDS` sets |
| `src/tools/apply.ts` | thread `args.execution_state` through **seven** sites (six snake-case fields + one camelCase reminder arg) |
| `src/hooks/raw-edit-policy.ts` | pass `executionState` into the `write_allowed` reminder call |
| `src/tools/descriptions.ts` | `EXECUTION_STATE_FOOTER` const, interpolated into all 21 descriptions; escape paragraph in `edit_observation` |
| `src/cli/log-cmd.ts` | `--execution-state` filter (parse + filter) |
| `src/cli/summary-cmd.ts` | "By execution state" breakdown with `(pre-0.7.0)` bucket |
| `docs/SPEC.md` | Article 4 paragraph; §3 type block + validation rule; new §3.4 matrix; §4 footer ×21; §6 log schema |
| `package.json`, `.claude-plugin/plugin.json` | version `0.6.3` → `0.7.0` |
| `IMPLEMENTATION-LOG.md`, `OBSERVED-FAILURES.md`, `README*.md` | log entry; under-declaration entry; tool-surface text |

`src/opencode/plugin.ts` needs **no source change** — the reminder text flows through its existing `additionalContext` → `tool.execute.after` bridge (a test is still added).

**Test files touched:** `common.test.ts`, `registry.test.ts`, `reminders/context.test.ts`, `state/grants.test.ts`, `state/edit-log.test.ts`, `hooks/raw-edit-policy.test.ts`, `opencode/plugin.test.ts`, `cli/log-cmd.test.ts`, `cli/summary-cmd.test.ts`, `tools/handler.test.ts`.

**Phase greenness:** Phase 1 is one atomic breaking change committed in a single commit at the end of Task 1.2 (the strict schema change + the fixture sweep land together, so no commit on the branch is RED). Phases 2–7 are additive; the suite is green after every commit. **`dist/` is regenerated only in Phase 7 Task 7.2** — no `bun run build` runs in any earlier phase, because that would regenerate `dist/` with the new strict schema active before the description footer (Phase 5) and version bump (Phase 7) are in, breaking self-application if the MCP server is restarted mid-plan.

---

## Phase 1 — Schema, matrix, fixture sweep (atomic)

### Task 1.1: `ExecutionStateSchema` enum + matrix function + audit code

**Files:**
- Modify: `src/tools/common.ts` — enum next to `ProvenanceSchema` (~L49-56); matrix fns (`evaluateKindProvenanceValidity` ~L112, `evaluateAdditionalFiles` ends ~L189); `AuditWarning.code` union (~L294-301)
- Modify: `src/state/edit-log.ts` — `AuditWarningEntrySchema` `z.enum` (~L54-62)
- Test: `src/tools/common.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/tools/common.test.ts`. If `TOOLS_REQUIRING_TARGET` / `WORKFLOW_TOOLS` are not already imported from `./descriptions.js`, add them. Add `ExecutionStateSchema` and `evaluateKindExecutionStateValidity` to the existing `./common.js` import.

```typescript
describe("ExecutionStateSchema (design §4.1)", () => {
  it("accepts the three states", () => {
    for (const s of ["normal", "repeating_failure", "recovery"]) {
      expect(ExecutionStateSchema.safeParse(s).success).toBe(true);
    }
  });
  it("rejects any other value", () => {
    expect(ExecutionStateSchema.safeParse("uncertain").success).toBe(false);
  });
});

describe("evaluateKindExecutionStateValidity (SPEC §3.4)", () => {
  it("warns for every impl tool in repeating_failure", () => {
    for (const k of TOOLS_REQUIRING_TARGET) {
      expect(evaluateKindExecutionStateValidity(k, "repeating_failure")).toBe("warn");
    }
  });
  it("accepts every workflow tool in repeating_failure", () => {
    for (const k of WORKFLOW_TOOLS) {
      expect(evaluateKindExecutionStateValidity(k, "repeating_failure")).toBe("accept");
    }
  });
  it("accepts every tool in normal and recovery", () => {
    for (const k of [...TOOLS_REQUIRING_TARGET, ...WORKFLOW_TOOLS]) {
      expect(evaluateKindExecutionStateValidity(k, "normal")).toBe("accept");
      expect(evaluateKindExecutionStateValidity(k, "recovery")).toBe("accept");
    }
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `bun test src/tools/common.test.ts` → FAIL.

- [ ] **Step 3: Add the enum** — in `src/tools/common.ts`, immediately after `ProvenanceSchema` / `Provenance`:

```typescript
// design §4.1: every typed_edit declaration carries a required
// execution_state field naming the state of the agent's work loop.
export const ExecutionStateSchema = z.enum([
  "normal",
  "repeating_failure",
  "recovery",
]);
export type ExecutionState = z.infer<typeof ExecutionStateSchema>;
```

- [ ] **Step 4: Add the matrix function** — in `src/tools/common.ts`, immediately after `evaluateAdditionalFiles`. `TOOLS_REQUIRING_TARGET` is already imported from `./descriptions.js`:

```typescript
// SPEC §3.4: (kind × execution_state) audit matrix. The only non-accept
// cell is an impl tool (a fix attempt) declared in repeating_failure.
// No "reject" cell — soft per design Q3.
export function evaluateKindExecutionStateValidity(
  kind: ToolName,
  executionState: ExecutionState,
): MatrixVerdict {
  if (
    executionState === "repeating_failure" &&
    TOOLS_REQUIRING_TARGET.includes(kind)
  ) {
    return "warn";
  }
  return "accept";
}
```

- [ ] **Step 5: Add the audit-warning code (common.ts)** — extend the `AuditWarning.code` union:

```typescript
  code:
    | "kind_provenance_warn"
    | "additional_files_warn"
    | "citation_lint_missing"
    | "execution_state_repeating_failure";
```

- [ ] **Step 6: Add the audit-warning code (edit-log.ts)** — extend the `z.enum` inside `AuditWarningEntrySchema` with `"execution_state_repeating_failure"`. This MUST land in Phase 1 (Task 1.2 will make `validateRequest` emit it; `appendIssued` parses `audit_warnings` through `IssuedEntrySchema`, which uses this enum).

- [ ] **Step 7: Run test, verify it passes** — `bun test src/tools/common.test.ts` → PASS. `bun run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/tools/common.ts src/tools/common.test.ts src/state/edit-log.ts
git commit -m "feat(schema): add execution_state enum, matrix, and audit code"
```

### Task 1.2: Required `execution_state` field + `validateRequest` + registry + fixture sweep — atomic

This task is **one logical breaking change committed in a single final commit at Step 12** — the strict schema change and the fixture sweep land together so no commit on the branch is RED. Within the task, write tests first, then implement, then sweep, then verify, then commit.

**Files:**
- Modify: `src/tools/common.ts` — `EditToolRequestSchema` (the `.strict()` object, `provenance` field ~L262-267); `validateRequest` (after the `1c` citation-lint block, ~L458)
- Modify: `src/tools/registry.ts` — `implToolInputSchema.properties` + `.required` (~L46-53); `workflowToolInputSchema.required` (~L113-119)
- Modify: every `EditToolRequest` fixture site — at minimum `src/tools/common.test.ts` (`modifyReq` / `workflowReq` defaults + the inline `EditToolRequestSchema.safeParse({...})` literals in `describe("EditToolRequestSchema — zod surface")`), `src/tools/handler.test.ts` (`modifyRequest` default + the existing exact-match summary-string assertion stays as-is — Task 4.1 updates it), `src/tools/registry.test.ts` (the inline `arguments: {...}` payload in the `tools/call` test).
- Test: `src/tools/common.test.ts`, `src/tools/registry.test.ts`

- [ ] **Step 1: Write the failing tests.**

(a) In `src/tools/common.test.ts`, inside the existing `describe("EditToolRequestSchema — zod surface", ...)` block:

```typescript
  it("rejects a request missing execution_state (design §4.1)", () => {
    const r = EditToolRequestSchema.safeParse({
      target_file: "src/foo.ts",
      rationale: "ok",
      risk_level: "medium",
      target: "prod",
      provenance: "direct_observation",
      test_files: ["t.test.ts"],
    });
    expect(r.success).toBe(false);
  });
```

(b) In `src/tools/common.test.ts`, inside the existing `describe("validateRequest — disk + path-safety", ...)` block (this block defines `modifyReq` and the module-level `ctx()` is in scope):

```typescript
  it("records execution_state_repeating_failure for an impl tool in repeating_failure", () => {
    const res = validateRequest(
      "edit_boundary_condition",
      modifyReq({ execution_state: "repeating_failure" }),
      ctx(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(
        res.auditWarnings.some((w) => w.code === "execution_state_repeating_failure"),
      ).toBe(true);
    }
  });
```

(c) In `src/tools/common.test.ts`, inside the existing `describe("validateRequest — kind × provenance integration (v0.6.0)", ...)` block (this block defines `workflowReq(kind, provenance, overrides)`, `ctx2()`, and the `writeFile2(rel, content)` helper used by surrounding tests at ~L786/L802/L850):

```typescript
  it("does not warn for an escape edit_observation in repeating_failure", () => {
    writeFile2("docs/obs.md", "x\n");
    const res = validateRequest(
      "edit_observation",
      workflowReq("edit_observation", "direct_observation", {
        target_file: "docs/obs.md",
        execution_state: "repeating_failure",
      }),
      ctx2(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(
        res.auditWarnings.some((w) => w.code === "execution_state_repeating_failure"),
      ).toBe(false);
    }
  });
  it("records additional_files_warn but NOT execution_state_repeating_failure on a batched workflow declaration in repeating_failure", () => {
    // The pair (edit_proposal, direct_observation) is a WARN cell in
    // §3.3.2 — it produces additional_files_warn. The test confirms
    // execution_state_repeating_failure (impl-only) does NOT co-occur:
    // design §4.1's "never co-occur on one declaration" invariant.
    writeFile2("docs/a.md", "x\n");
    writeFile2("docs/b.md", "y\n");
    const res = validateRequest(
      "edit_proposal",
      workflowReq("edit_proposal", "direct_observation", {
        target_file: "docs/a.md",
        execution_state: "repeating_failure",
        rationale: "RFC sweep across docs/a.md and docs/b.md (direct observation)",
        additional_files: [{ file: "docs/b.md" }],
      }),
      ctx2(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(
        res.auditWarnings.some((w) => w.code === "additional_files_warn"),
      ).toBe(true);
      expect(
        res.auditWarnings.some((w) => w.code === "execution_state_repeating_failure"),
      ).toBe(false);
    }
  });
```

(d) In `src/tools/registry.test.ts`, add a new `it` that asserts the input schema. Mirror the existing `_requestHandlers` access pattern already in this file (used by the `tools/list` and `tools/call` tests). The exact snippet:

```typescript
  it("every tool's input schema requires execution_state", async () => {
    const server = new Server(
      { name: "test", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    registerTools(server, {
      context: { repoRoot: process.cwd() },
      handler: async () => ({
        token: "",
        expires_at: "",
        edit_id: "edit_20260523_0001",
        warnings: [],
      }),
    });
    const listHandler = (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get("tools/list");
    if (!listHandler) throw new Error("tools/list handler not registered");
    const result = (await listHandler({
      method: "tools/list",
      params: {},
    })) as { tools: Array<{ inputSchema: { required: string[] } }> };
    for (const tool of result.tools) {
      expect(tool.inputSchema.required).toContain("execution_state");
    }
  });
```

(`Server`, `registerTools`, and `EditToolResult` are already imported in `registry.test.ts`.)

- [ ] **Step 2: Run tests, verify they fail** — `bun test src/tools/common.test.ts src/tools/registry.test.ts` → the new cases FAIL.

- [ ] **Step 3: Add the field to the schema** — in `EditToolRequestSchema`, immediately after the `provenance: ProvenanceSchema,` line:

```typescript
    // design §4.1: required, no default — the forcing function dies
    // with a default. The .strict() schema rejects omission.
    execution_state: ExecutionStateSchema,
```

- [ ] **Step 4: Add the `1d` block to `validateRequest`** — immediately after the `1c` `accepted_artifact` citation-lint block, before block `2a`:

```typescript
  // ---- 1d. kind × execution_state validity (SPEC §3.4) ----------------
  if (
    evaluateKindExecutionStateValidity(toolName, request.execution_state) ===
    "warn"
  ) {
    auditWarnings.push({
      code: "execution_state_repeating_failure",
      message:
        `execution_state="repeating_failure" was declared on ${toolName}, ` +
        `an implementation fix attempt. This is a self-flagged loop signal, ` +
        `not a mismatch — group it by code, separate from §3.3 warnings. ` +
        `The escape move is edit_observation or edit_proposal: record the ` +
        `failure (reproduction conditions, recent changes, hypotheses) ` +
        `before stacking another fix.`,
    });
  }
```

- [ ] **Step 5: Add to the MCP input schema** — in `src/tools/registry.ts`, add to `implToolInputSchema.properties` (it is spread into `workflowToolInputSchema.properties`, so this one addition reaches both):

```typescript
    execution_state: {
      type: "string",
      enum: ["normal", "repeating_failure", "recovery"],
      description:
        "Required (v0.7.0). The state of your work loop: normal " +
        "(ordinary work, the default), repeating_failure (you have noticed " +
        "you are repeating the same class of failure — declare it on an " +
        "edit_observation/edit_proposal that records the failure), recovery " +
        "(you isolated a single hypothesis and are diagnosing deliberately). " +
        "See docs/SPEC.md §3.4.",
    },
```

Add `"execution_state"` to **both** `required` arrays — `implToolInputSchema.required` AND the separate literal `workflowToolInputSchema.required`.

- [ ] **Step 6: Verify the suite is now RED only for missing fixtures** — `bun test` and `bun run typecheck`. Every failure should be an `EditToolRequest` payload missing `execution_state` (the `.strict()` schema rejects it). The new tests from Step 1 should now PASS.

- [ ] **Step 7: Sweep fixtures** — add `execution_state: "normal"` to: the `modifyReq` default object body (in `common.test.ts`); the `workflowReq` default object body (in `common.test.ts`); the `modifyRequest` default object body (in `handler.test.ts`); the inline `EditToolRequestSchema.safeParse({...})` literals in `describe("EditToolRequestSchema — zod surface")`; the `arguments: {...}` literal in `registry.test.ts`'s `tools/call` test; and any other red request literal. Place the new field next to the existing `provenance` field. Do **not** change request literals that a test deliberately keeps invalid.

- [ ] **Step 8: Do NOT touch the existing exact-match summary-string assertion in `handler.test.ts`** — it currently reads `"edit_boundary_condition declared: src/foo.ts target=prod provenance=direct_observation bindings=1"`. The `execution_state=` token is added to the summary string in Phase 4 (Task 4.1); the assertion is updated there. Leaving it as-is is correct now (the produced summary has no `execution_state=` yet, matching the assertion).

- [ ] **Step 9: Verify green** — `bun test` → all pass. `bun run typecheck` → clean. Do NOT run `bun run build` (see Phase greenness).

- [ ] **Step 10: Commit (one atomic Phase 1 commit)** — explicit paths only; never `git add -A`:

```bash
git add src/tools/common.ts src/tools/common.test.ts src/tools/registry.ts src/tools/registry.test.ts src/tools/handler.test.ts
git commit -m "feat(schema): require execution_state on EditToolRequest (strict)"
```

---

## Phase 2 — Grant metadata + edit-log fields

### Task 2.1: `execution_state` on `GrantDeclaration`

**Files:**
- Modify: `src/state/grants.ts` — `GrantDeclaration` type (~L53-59); `isGrantDeclaration` (~L189-207)
- Test: `src/state/grants.test.ts`

- [ ] **Step 1: Write the failing tests** — in `src/state/grants.test.ts`, inside `describe("grants.issue", ...)`. Each test makes its own `const store = createGrantsStore(tmpRoot);` and uses the module-level `binding(file, before?)` helper:

```typescript
  it("round-trips execution_state in declaration metadata", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260523_0001",
      binding: [binding("src/foo.ts")],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "direct_observation",
        execution_state: "repeating_failure",
        target_file: "src/foo.ts",
        test_files: ["tests/foo.test.ts"],
      },
    });
    const looked = await store.lookup(g.token_id);
    expect(looked?.declaration?.execution_state).toBe("repeating_failure");
  });
  it("still validates a pre-0.7.0 declaration that omits execution_state", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260523_0002",
      binding: [binding("src/foo.ts")],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "direct_observation",
        target_file: "src/foo.ts",
        test_files: ["tests/foo.test.ts"],
      },
    });
    expect((await store.lookup(g.token_id))?.declaration).toBeDefined();
  });
```

- [ ] **Step 2: Run test, verify it fails** — `bun test src/state/grants.test.ts` → FAIL (type error on `execution_state`).

- [ ] **Step 3: Add the optional field to the type** — `GrantDeclaration`:

```typescript
export type GrantDeclaration = {
  kind: string;
  target?: "prod" | "test";
  provenance: string;
  execution_state?: string; // design §4.5: optional on read — pre-0.7.0 grants omit it
  target_file: string;
  test_files: string[];
};
```

- [ ] **Step 4: Add the optional check to `isGrantDeclaration`** — mirror the `target` *optional* pattern (NOT the required `provenance` pattern), so pre-0.7.0 grant files on disk still validate. After the `target` check:

```typescript
  if (v.execution_state !== undefined && typeof v.execution_state !== "string") {
    return false;
  }
```

- [ ] **Step 5: Run test, verify it passes** — `bun test src/state/grants.test.ts` → PASS. `bun run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/state/grants.ts src/state/grants.test.ts
git commit -m "feat(grants): persist execution_state in grant declaration metadata"
```

### Task 2.2: `execution_state` on the edit-log entry schemas

**Files:**
- Modify: `src/state/edit-log.ts` — import from `../tools/common.js` (~L5-9); `IssuedEntrySchema` (~L64-90, `provenance` field at ~L82); `RejectedEntrySchema` (~L100-122, `provenance` field after `target`)
- Test: `src/state/edit-log.test.ts`

- [ ] **Step 1: Write the failing test** — in `src/state/edit-log.test.ts`. `EditLog` is constructed inline as `new EditLog(tmpRoot)`; `issued` is imported from `../test-helpers.js`:

```typescript
  it("round-trips execution_state on an issued entry", () => {
    const log = new EditLog(tmpRoot);
    log.appendIssued(issued({ execution_state: "recovery" }));
    const all = log.readAll();
    const first = all[0];
    expect(first?.phase === "issued" && first.execution_state).toBe("recovery");
  });
  it("still validates a pre-0.7.0 issued entry that omits execution_state", () => {
    const log = new EditLog(tmpRoot);
    log.appendIssued(issued()); // issued() default carries no execution_state
    expect(log.readAll().length).toBe(1);
  });
  it("accepts an audit_warnings entry with the execution_state_repeating_failure code", () => {
    const log = new EditLog(tmpRoot);
    log.appendIssued(
      issued({
        audit_warnings: [
          { code: "execution_state_repeating_failure", message: "x" },
        ],
      }),
    );
    const first = log.readAll()[0];
    expect(first?.phase === "issued" && first.audit_warnings?.[0]?.code).toBe(
      "execution_state_repeating_failure",
    );
  });
```

- [ ] **Step 2: Run test, verify it fails** — `bun test src/state/edit-log.test.ts` → FAIL.

- [ ] **Step 3: Import the schema** — add `ExecutionStateSchema` to the existing import from `../tools/common.js`.

- [ ] **Step 4: Add the field** — in both `IssuedEntrySchema` and `RejectedEntrySchema`, immediately after the `provenance: ProvenanceSchema.optional(),` line:

```typescript
  // design §4.5: optional on read so pre-0.7.0 entries still validate.
  execution_state: ExecutionStateSchema.optional(),
```

(`AuditWarningEntrySchema` already carries `execution_state_repeating_failure` from Task 1.1.)

- [ ] **Step 5: Run test, verify it passes** — `bun test src/state/edit-log.test.ts` → PASS. `bun run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/state/edit-log.ts src/state/edit-log.test.ts
git commit -m "feat(edit-log): add execution_state field to issued and rejected entries"
```

---

## Phase 3 — Reminders

### Task 3.1: `executionStateLine` in `buildReminderContext`

**Files:**
- Modify: `src/reminders/context.ts` — `ReminderInput` type (~L3-14); `buildReminderContext` `lines` array (~L23-30); new `executionStateLine` builder + two module-level `Set` constants
- Test: `src/reminders/context.test.ts`

- [ ] **Step 1: Write the failing tests** — in `src/reminders/context.test.ts`, inside `describe("buildReminderContext", ...)`:

```typescript
  it("repeating_failure on an impl tool gives the corrective ordered procedure", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "repeating_failure",
    });
    expect(out).toContain("escape procedure");
    expect(out).toContain("(1)");
    expect(out).toContain("(4)");
    expect(out).toContain("primary sources");
  });
  it("repeating_failure on edit_observation gives supportive escape text", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_observation",
      executionState: "repeating_failure",
    });
    expect(out).toContain("this is the right move");
    expect(out).not.toContain("(1)");
  });
  it("repeating_failure on edit_progress adds no execution_state text", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_progress",
      executionState: "repeating_failure",
    });
    expect(out).not.toContain("escape procedure");
    expect(out).not.toContain("this is the right move");
  });
  it("recovery gives supportive recovery text", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "recovery",
    });
    expect(out).toContain("recovery");
  });
  it("normal adds no execution_state text", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "normal",
    });
    expect(out).not.toContain("escape procedure");
    expect(out).not.toContain("recovery");
  });
  it("write_allowed gives the post-hoc variant for repeating_failure x impl", () => {
    const out = buildReminderContext({
      phase: "write_allowed",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "repeating_failure",
    });
    expect(out).toContain("landed while");
  });
```

- [ ] **Step 2: Run test, verify it fails** — `bun test src/reminders/context.test.ts` → FAIL (`executionState` unknown on `ReminderInput`).

- [ ] **Step 3: Add `executionState` to `ReminderInput`** — add `executionState?: string;` to the type.

- [ ] **Step 4: Add the sets + builder** — in `src/reminders/context.ts`, module-level constants and a builder placed after `provenanceLine`. The branch keys on `kind` (NOT `target` presence) so the reminder cannot diverge from the §3.4 matrix:

```typescript
const WORKFLOW_KINDS: ReadonlySet<string> = new Set([
  "edit_progress",
  "edit_observation",
  "edit_proposal",
  "edit_decision",
  "edit_explanation",
]);
const ESCAPE_KINDS: ReadonlySet<string> = new Set([
  "edit_observation",
  "edit_proposal",
]);

function executionStateLine(input: ReminderInput): string | undefined {
  const state = input.executionState;
  if (state === undefined || state === "normal") return undefined;
  if (state === "recovery") {
    return (
      "I am in recovery — a deliberate diagnosis mode entered after " +
      "recognizing a failure. Verify assumptions against primary sources " +
      "(official documentation, etc.), confirm a single hypothesis, and " +
      "make the next fix only then. Keep steps small and reversible. " +
      "Return to normal once the failure is resolved."
    );
  }
  // state === "repeating_failure"
  const kind = input.kind;
  if (kind === undefined) return undefined;
  if (ESCAPE_KINDS.has(kind)) {
    return (
      "I have acknowledged repeating_failure and I am recording it — this " +
      "is the right move. Write reproduction conditions, recent changes, " +
      "and competing hypotheses as three separate items. Ground each " +
      "hypothesis by checking my assumptions against primary sources " +
      "before forming it, and do not return to implementation fixes until " +
      "a single hypothesis is isolated."
    );
  }
  if (WORKFLOW_KINDS.has(kind)) {
    // edit_progress / edit_decision / edit_explanation: not a fix attempt
    // and not the escape move — no execution_state text.
    return undefined;
  }
  // impl tool (a fix attempt)
  if (input.phase === "write_allowed") {
    return (
      "This fix landed while I had declared repeating_failure. If I have " +
      "not yet run the escape procedure — record the failure with " +
      "edit_observation, check my assumptions against primary sources, " +
      "isolate one hypothesis — I should do that before the next edit " +
      "instead of stacking another fix."
    );
  }
  return (
    "I was about to keep implementing while repeating the same kind of " +
    "failure. Before stacking another fix I should run the escape " +
    "procedure — (1) record it with edit_observation: write reproduction " +
    "conditions, recent changes, and competing hypotheses as separate " +
    "items; (2) re-read the error message literally and check my " +
    "assumptions against primary sources (official documentation, the " +
    "actual source, execution logs); (3) narrow to a single hypothesis " +
    "and verify it with a minimal reproduction; (4) only then decide the " +
    "next move."
  );
}
```

- [ ] **Step 5: Wire it into `buildReminderContext`** — add `executionStateLine(input)` to the `lines` array, immediately after `provenanceLine(input.provenance, input.phase)`.

- [ ] **Step 6: Run test, verify it passes** — `bun test src/reminders/context.test.ts` → PASS. `bun run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/reminders/context.ts src/reminders/context.test.ts
git commit -m "feat(reminders): branch reminder text on execution_state by kind"
```

---

## Phase 4 — Thread through apply.ts and the hook

### Task 4.1: Thread `execution_state` through `apply.ts` (seven sites — six snake_case + one camelCase)

**Files:**
- Modify: `src/tools/apply.ts` — the **seven** `args.provenance` sites
- Test: `src/tools/handler.test.ts` (apply.ts is tested here — `apply.test.ts` does not exist)

- [ ] **Step 1: Write the failing test** — in `src/tools/handler.test.ts`. The handler is two-arg `handler(toolName, args)`; `makeHandler()` returns `{ handler, log, grants }`:

```typescript
  it("threads execution_state into the summary and the issued log entry", async () => {
    const { handler, log } = makeHandler();
    const result = await handler(
      "edit_boundary_condition",
      modifyRequest({ execution_state: "recovery" }),
    );
    expect(result.summary).toContain("execution_state=recovery");
    const entry = log.readAll().find((e) => e.phase === "issued");
    expect(entry?.phase === "issued" && entry.execution_state).toBe("recovery");
  });
```

- [ ] **Step 2: Run test, verify it fails** — `bun test src/tools/handler.test.ts` → the new case FAILS.

- [ ] **Step 3: Thread the field at six snake_case sites in `apply.ts`** — at each site, add an `execution_state: args.execution_state` sibling next to the existing `provenance: args.provenance`. The six **snake_case** sites (where the receiving field name is `execution_state`):
  1. rejected-entry build (validation-fail path, ~L91) — `RejectedEntry.execution_state`
  2. rejected-entry build (grants.issue-fail path, ~L142) — `RejectedEntry.execution_state`
  3. `grants.issue` `declaration` argument (~L122) — `GrantDeclaration.execution_state`
  4. `IssuedEntry` build (~L179) — `IssuedEntry.execution_state`
  5. `declaredSummary` array (~L250-263) — add `` `execution_state=${args.execution_state}` `` immediately after the `provenance=...` entry and before `bindings=...`
  6. `rejectedSummary` array (~L265-278) — same pattern (after `provenance=...`, before `warnings=...`)

- [ ] **Step 4: Thread the field at the seventh camelCase site** — the `buildReminderContext` call in `apply.ts` (~L227) receives a `ReminderInput`, whose Task 3.1 field is **camelCase `executionState`**. Add **`executionState: args.execution_state`** (camelCase on the left, snake_case on the right — `args` is `EditToolRequest`, whose schema field is `execution_state`). `args.execution_state` is a required non-optional `ExecutionState`, so a plain assignment is correct here (the `...(x !== undefined ? {} : {})` spread is only needed for the genuinely-optional grant field in Task 4.2).

- [ ] **Step 5: Update the existing exact-match summary assertion** — in `src/tools/handler.test.ts`, the pre-existing assertion now reads (the `modifyRequest()` default carries `execution_state: "normal"` after Task 1.2 Step 7):

```typescript
    expect(result.summary).toBe(
      "edit_boundary_condition declared: src/foo.ts target=prod provenance=direct_observation execution_state=normal bindings=1",
    );
```

Update that assertion string. Audit `handler.test.ts` for any other exact-match `summary` / `rejected:` assertions and update them the same way.

- [ ] **Step 6: Run tests, verify pass** — `bun test src/tools/handler.test.ts` → PASS. `bun run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/tools/apply.ts src/tools/handler.test.ts
git commit -m "feat(apply): thread execution_state into log, grant, reminder, summary"
```

### Task 4.2: Hook `write_allowed` reminder branches on `execution_state`

**Files:**
- Modify: `src/hooks/raw-edit-policy.ts` — the `buildReminderContext` call inside `evaluateTokenedEdit` (~L405-422)
- Test: `src/hooks/raw-edit-policy.test.ts`, `src/opencode/plugin.test.ts`

- [ ] **Step 1: Write the failing tests.**

(a) In `src/hooks/raw-edit-policy.test.ts`, inside `describe("evaluateTokenedEdit — happy path", ...)`. Uses the module-level `issueGrant(grants, editId, binding, declaration?)`, `writeFile(rel, content)`, and `sha256` helpers:

```typescript
  it("write_allowed additionalContext branches on execution_state", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "hello\n");
    await issueGrant(
      grants,
      "edit_20260523_0200",
      [{ file: "src/foo.ts", before_sha256: sha256("hello\n") }],
      {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "direct_observation",
        execution_state: "repeating_failure",
        target_file: "src/foo.ts",
        test_files: ["tests/foo.test.ts"],
      },
    );
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "hello\n",
        new_string: "hi\n",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
    expect(r.additionalContext).toContain("landed while");
  });
  it("consumes a pre-0.7.0 grant whose declaration omits execution_state", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/bar.ts", "hello\n");
    await issueGrant(
      grants,
      "edit_20260523_0201",
      [{ file: "src/bar.ts", before_sha256: sha256("hello\n") }],
      {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "direct_observation",
        target_file: "src/bar.ts",
        test_files: ["tests/bar.test.ts"],
      },
    );
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/bar.ts"),
        old_string: "hello\n",
        new_string: "hi\n",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });
```

(b) In `src/opencode/plugin.test.ts`, inside `describe("tool.execute.after write-allowed reminder", ...)`, mirror the existing test in that block (write file → `createGrantsStore` + `grants.issue({ ..., declaration })` → `makeHooks()` → `tool.execute.before` → `tool.execute.after`), adding `execution_state: "repeating_failure"` to the declaration and asserting:

```typescript
    expect(afterOutput.output).toContain("landed while");
```

- [ ] **Step 2: Run tests, verify they fail** — `bun test src/hooks/raw-edit-policy.test.ts src/opencode/plugin.test.ts` → the new cases FAIL.

- [ ] **Step 3: Pass the field** — in the `buildReminderContext` call inside `evaluateTokenedEdit`, after the `provenance: grant.declaration.provenance,` line, add (the `exactOptionalPropertyTypes` spread IS required here — `grant.declaration.execution_state` is genuinely optional):

```typescript
          ...(grant.declaration.execution_state !== undefined
            ? { executionState: grant.declaration.execution_state }
            : {}),
```

- [ ] **Step 4: Run tests, verify pass** — `bun test src/hooks/raw-edit-policy.test.ts src/opencode/plugin.test.ts` → PASS. `bun run typecheck` → clean. **Do NOT run `bun run build` here.** The bundled `dist/` is regenerated only in Phase 7 Task 7.2 — running `bun build` mid-plan would regenerate `dist/` with the required-`execution_state` schema active before the description footer (Phase 5) and version bump (Phase 7) are in, breaking self-application if the MCP server is restarted mid-plan.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/raw-edit-policy.ts src/hooks/raw-edit-policy.test.ts src/opencode/plugin.test.ts
git commit -m "feat(hook): execution_state-aware write_allowed reminder"
```

---

## Phase 5 — Tool descriptions + SPEC §4

### Task 5.1: `EXECUTION_STATE_FOOTER` in all 21 descriptions

**Files:**
- Modify: `src/tools/descriptions.ts` — new const near `PROVENANCE_FOOTER` (~L122-146); 21 interpolation sites (each carries `${PROVENANCE_FOOTER}` already); `edit_observation` description body
- Modify: `docs/SPEC.md` §4 — the identical footer, verbatim, in all 21 tool descriptions (CLAUDE.md §4)
- Test: `src/tools/registry.test.ts`

- [ ] **Step 1: Write the failing tests** — in `src/tools/registry.test.ts` (this file already imports `TOOL_NAMES` and `TOOL_DESCRIPTIONS` and does content assertions on descriptions):

```typescript
  it("every description carries the Execution state block", () => {
    for (const name of TOOL_NAMES) {
      expect(TOOL_DESCRIPTIONS[name]).toContain("Execution state (required):");
      expect(TOOL_DESCRIPTIONS[name]).toContain("repeating_failure");
    }
  });
  it("edit_observation description carries the repeating_failure escape paragraph", () => {
    expect(TOOL_DESCRIPTIONS.edit_observation).toContain(
      "escaping a repeating_failure",
    );
  });
```

- [ ] **Step 2: Run test, verify it fails** — `bun test src/tools/registry.test.ts` → FAIL.

- [ ] **Step 3: Add the footer constant** — in `src/tools/descriptions.ts`, beside `PROVENANCE_FOOTER`:

```typescript
const EXECUTION_STATE_FOOTER = `Execution state (required):
Declare the state of your work loop for this edit. Pick exactly one of:
- \`normal\` — ordinary work; no active failure loop. The default;
  declare it unless one of the two below applies.
- \`repeating_failure\` — you have noticed you are repeating the same
  class of failure (two or more unresolved fix attempts at one failure).
  Declare it the moment you recognize the loop. The intended move is to
  declare it on an edit_observation (or edit_proposal) that records the
  failure — reproduction conditions, recent changes, and competing
  hypotheses as separate items. Declaring repeating_failure on another
  implementation fix attempt is recorded as an audit warning, and the
  reminder will redirect you to the escape procedure.
- \`recovery\` — you have recorded the failure and isolated a single
  hypothesis, and you are now making deliberate, hypothesis-driven
  diagnostic edits. Keep steps small and reversible. Return to normal
  once the failure is resolved for the understood reason.

The lifecycle is normal -> repeating_failure -> recovery -> normal.
recovery may be skipped if the escape observation immediately resolves
the failure; repeating_failure is never skipped on the path into
recovery.`;
```

- [ ] **Step 4: Interpolate into all 21 descriptions** — add `${EXECUTION_STATE_FOOTER}` to every description, on its own blank-line-separated paragraph **immediately after the `${PROVENANCE_FOOTER}` interpolation token** (consistent single anchor — do not anchor on `General principles`, whose distance from the footer varies per description). All 21 descriptions carry `${PROVENANCE_FOOTER}`.

- [ ] **Step 5: Add the escape paragraph to `edit_observation`** — in `edit_observation`'s description body (before the footers), add:

```
Escaping a repeating_failure spiral:
This is the tool to reach for first when you have noticed you are
repeating the same class of failure. Record the reproduction
conditions, the recent changes, and the competing hypotheses as
separate items, and verify your assumptions against primary sources
(official documentation, the actual source, execution logs) before
forming the next hypothesis. Declare this edit with
provenance: direct_observation — the reproduction conditions and
recent changes are directly observed, and the hypotheses are framed
as hedged prose — so the escape stays in this tool's typical
provenance cell and does not trip a kind/provenance warning.
```

- [ ] **Step 6: Sync `docs/SPEC.md` §4** — apply the identical `Execution state (required):` footer text to all 21 tool descriptions in `docs/SPEC.md` §4, and the identical `edit_observation` escape paragraph. CLAUDE.md §4: `descriptions.ts` and SPEC §4 must be verbatim-identical, in the same commit.

- [ ] **Step 7: Manual verbatim check** — there is no mechanical SPEC↔descriptions test (the project does not have one for `PROVENANCE_FOOTER` either; verbatim sync is manual discipline per CLAUDE.md §4). Diff the footer block text between `descriptions.ts` `EXECUTION_STATE_FOOTER` and one SPEC §4 description, and confirm the 21 SPEC §4 insertions are identical to each other. Treat any drift as a blocker.

- [ ] **Step 8: Run tests, verify pass** — `bun test src/tools/registry.test.ts` → PASS. `bun run typecheck` → clean.

- [ ] **Step 9: Commit**

```bash
git add src/tools/descriptions.ts docs/SPEC.md src/tools/registry.test.ts
git commit -m "feat(descriptions): add Execution state block to all 21 tools + SPEC §4 sync"
```

---

## Phase 6 — CLI

### Task 6.1: `meta-edit log --execution-state`

**Files:**
- Modify: `src/cli/log-cmd.ts` — `LogFilters` type (~L5-30, `provenance` field ~L22-27); `filterEntries` (`provenance` block ~L80-88); `parseLogArgs` (`--provenance` branch ~L135-155, the `seen` flags ~L103-108)
- Test: `src/cli/log-cmd.test.ts`

- [ ] **Step 1: Write the failing tests** — in `src/cli/log-cmd.test.ts`. The `filterEntries` fixture array is built from `issued({...})` overrides:

```typescript
  it("filters by --execution-state (single value)", () => {
    const entries = [
      issued({ edit_id: "edit_20260523_0001", execution_state: "recovery" }),
      issued({ edit_id: "edit_20260523_0002", execution_state: "normal" }),
    ];
    const out = filterEntries(entries, {
      executionState: new Set(["recovery"]),
    });
    expect(out.length).toBe(1);
    expect(out[0]?.edit_id).toBe("edit_20260523_0001");
  });
  it("parses --execution-state as a comma-separated set", () => {
    const p = parseLogArgs(["--execution-state", "repeating_failure,recovery"]);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.filters.executionState?.size).toBe(2);
  });
  it("rejects an invalid --execution-state value", () => {
    expect(parseLogArgs(["--execution-state", "bogus"]).ok).toBe(false);
  });
```

- [ ] **Step 2: Run test, verify it fails** — `bun test src/cli/log-cmd.test.ts` → FAIL.

- [ ] **Step 3: Implement** — mirror the `--provenance` implementation exactly:
  - Import `ExecutionStateSchema` and its inferred type from `../tools/common.js`.
  - Add `executionState?: ReadonlySet<ExecutionState> | undefined;` to `LogFilters`, next to `provenance`.
  - In `filterEntries`, immediately after the `provenance` block:

```typescript
    if (filters.executionState !== undefined) {
      if (e.phase === "consumed") return false;
      if (e.execution_state === undefined) return false;
      if (!filters.executionState.has(e.execution_state)) return false;
    }
```

  - In `parseLogArgs`, add a `--execution-state` branch mirroring the `--provenance` branch: comma-split, `ExecutionStateSchema.safeParse` per token, build the `Set`, with the same duplicate-flag / empty-value / invalid-value error messages, and an `executionStateSeen` flag.

- [ ] **Step 4: Run test, verify it passes** — `bun test src/cli/log-cmd.test.ts` → PASS. `bun run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/log-cmd.ts src/cli/log-cmd.test.ts
git commit -m "feat(cli): meta-edit log --execution-state filter"
```

### Task 6.2: `meta-edit summary` — "By execution state"

**Files:**
- Modify: `src/cli/summary-cmd.ts` — `byProvenance` computation (~L110-112); the "By provenance" render block (~L172-192)
- Test: `src/cli/summary-cmd.test.ts`

- [ ] **Step 1: Write the failing tests** — in `src/cli/summary-cmd.test.ts`:

```typescript
  it("renders a By execution state breakdown", () => {
    const entries = [
      issued({ edit_id: "edit_20260523_0001", execution_state: "recovery" }),
      issued({ edit_id: "edit_20260523_0002", execution_state: "normal" }),
    ];
    const text = formatSummary(entries, undefined);
    expect(text).toContain("By execution state:");
    expect(text).toContain("recovery");
  });
  it("buckets pre-0.7.0 entries under (pre-0.7.0)", () => {
    const text = formatSummary(
      [issued({ edit_id: "edit_20260523_0003" })], // no execution_state
      undefined,
    );
    expect(text).toContain("(pre-0.7.0)");
  });
```

- [ ] **Step 2: Run test, verify it fails** — `bun test src/cli/summary-cmd.test.ts` → FAIL.

- [ ] **Step 3: Implement** — mirror the `byProvenance` block. Use the distinct legacy label `(pre-0.7.0)` (design §4.5):

```typescript
  const byExecutionState = countBy(issuedEntries, (e) =>
    e.execution_state === undefined ? "(pre-0.7.0)" : e.execution_state,
  );
```

Add a render block immediately after the "By provenance" block:

```typescript
  lines.push("By execution state:");
  const executionStateOrder = [
    "normal",
    "repeating_failure",
    "recovery",
    "(pre-0.7.0)",
  ];
  let anyExecutionState = false;
  for (const s of executionStateOrder) {
    const count = byExecutionState.get(s) ?? 0;
    if (count === 0) continue;
    lines.push(
      `  ${s.padEnd(20)} ${String(count).padStart(4)}  (${pct(count, issuedEntries.length)})`,
    );
    anyExecutionState = true;
  }
  if (!anyExecutionState) {
    lines.push("  (no issued entries)");
  }
  lines.push("");
```

- [ ] **Step 4: Run test, verify it passes** — `bun test src/cli/summary-cmd.test.ts` → PASS. `bun run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/summary-cmd.ts src/cli/summary-cmd.test.ts
git commit -m "feat(cli): meta-edit summary By execution state breakdown"
```

---

## Phase 7 — SPEC sync, version, docs, final verification

### Task 7.1: `docs/SPEC.md` non-§4 sync

**Files:** Modify `docs/SPEC.md`.

- [ ] **Step 1: Article 4** — add a paragraph introducing the `execution_state` axis (parity with the existing "Provenance flag." paragraph): a required self-declared field on all 21 tools naming the state of the agent's work loop. State that it is a declaration (not detection), within Articles 1–2, and does not trigger the Article 7 / scope-expansion amendment bar.

- [ ] **Step 2: §3** — add `execution_state` to the `EditToolRequest` type block (after `provenance`); add a validation-rules bullet ("`execution_state` presence: required on every declaration; strict, no default").

- [ ] **Step 3: new §3.4** — add the `(kind × execution_state)` audit matrix (design §4.2): the table, the single `warn` group (16 impl tools × `repeating_failure`), no `REJ` cell, the `execution_state_repeating_failure` code and its distinct "self-flagged loop signal" semantics, and the escape set `{edit_observation, edit_proposal}`.

- [ ] **Step 4: §3 token issuance** — note grant metadata now also carries `execution_state` (optional on read).

- [ ] **Step 5: §6** — add `execution_state` to the edit-log entry schema (optional on read; pre-0.7.0 entries omit it, bucketed `(pre-0.7.0)` in `meta-edit summary`); add the `execution_state_repeating_failure` audit code.

- [ ] **Step 6: Verify + commit** — `bun test` → all pass.

```bash
git add docs/SPEC.md
git commit -m "docs(spec): sync SPEC for execution_state (Article 4, §3, §3.4, §6)"
```

### Task 7.2: Version bump + READMEs + OBSERVED-FAILURES + IMPLEMENTATION-LOG + final gate

**Files:** `package.json`, `.claude-plugin/plugin.json`, `README.md`, `README.ja.md`, `README.zh-CN.md`, `OBSERVED-FAILURES.md`, `IMPLEMENTATION-LOG.md`, `dist/`.

- [ ] **Step 1: Version** — `package.json` and `.claude-plugin/plugin.json` `0.6.3` → `0.7.0`. `src/version.ts` derives `VERSION` from `package.json` — no edit.

- [ ] **Step 2: READMEs** — add `execution_state` to the field list / tool-surface description in all three READMEs (mirror how `provenance` is described).

- [ ] **Step 3: `OBSERVED-FAILURES.md`** — add an entry "execution_state under-declaration — v0.2 cadence-counter candidate" (design §5). Promotion triggers, in the file's established style: (1) **Review signal** — AI-PR transcripts repeatedly show a fix→fail→fix loop with `repeating_failure` never declared; (2) **User-report signal**. Promotion = the cadence-counter (count consecutive same-file impl declarations from the edit log, prompt) — a v0.2 / classifier-class change.

- [ ] **Step 4: `IMPLEMENTATION-LOG.md`** — append a `## v0.7.0: execution_state declaration field` entry: what works, tests added, the Codex+Claude design review and the two implementation-plan review rounds, spec deviations (none).

- [ ] **Step 5: Final verification gate** — run all three and confirm:

```bash
bun test          # expect: all pass / 0 fail
bun run typecheck # expect: clean
bun run build     # expect: clean, dist/ regenerated
```

This is the ONLY `bun run build` in the whole plan.

- [ ] **Step 6: Commit** — this is the only commit that includes the regenerated `dist/`. Use explicit paths plus `dist/`:

```bash
git add package.json .claude-plugin/plugin.json README.md README.ja.md README.zh-CN.md OBSERVED-FAILURES.md IMPLEMENTATION-LOG.md dist/
git commit -m "chore: release execution_state field as v0.7.0"
```

---

## Self-Review (completed by plan author, third revision)

**Spec coverage** — design §4.1 → Task 1.2; §4.1.1 lifecycle → Task 5.1 footer; §4.2 matrix → Tasks 1.1/1.2 + §3.4 (7.1); §4.3 reminders → Task 3.1; §4.4 `edit_observation` paragraph → Task 5.1; §4.5 grant/log → Tasks 2.1/2.2, label `(pre-0.7.0)` → Task 6.2; §4.6 CLI + summary first-field → Tasks 6.1/6.2/4.1; §4.7 SPEC sync → Tasks 5.1/7.1; §4.8 version → Task 7.2; §5 OBSERVED-FAILURES → Task 7.2; §9 test plan — matrix incl. batch case → Task 1.2(c); reminder modes → Task 3.1; grant round-trip + pre-0.7 consume → Tasks 2.1/4.2; edit-log persist + legacy → Task 2.2; hook + opencode → Task 4.2; CLI → Tasks 6.1/6.2; descriptions → Task 5.1. All design sections map to a task.

**Placeholder scan** — no TBD / "handle edge cases" / `/* ... */` sketch snippets; every test snippet is concrete and uses verified helper names. The Task 1.2 fixture sweep (Step 7) is an atomic part of the same task that introduces the breaking change — no commit on the branch is RED, and git bisect remains usable. The registry-list snippet uses the actual `_requestHandlers` access pattern, not a `listTools()` helper.

**Type consistency** — `ExecutionStateSchema` / `ExecutionState` / `evaluateKindExecutionStateValidity`. On the wire, the schema, the log, and the grant: snake_case `execution_state` (matching `provenance`). Inside `ReminderInput` and the apply.ts `buildReminderContext` call: camelCase `executionState` (matching the module's existing `targetFile` / `declaredTestFiles` convention). Task 4.1 explicitly splits the six snake_case sites from the one camelCase site to make the convention boundary visible. The audit code `execution_state_repeating_failure` is identical across `common.ts` (`AuditWarning.code` union), `edit-log.ts` (`AuditWarningEntrySchema` enum), `validateRequest`, and the tests. The reminder's impl/escape/neutral branch keys on `kind` via `WORKFLOW_KINDS` / `ESCAPE_KINDS` — the same partition the §3.4 matrix uses (`TOOLS_REQUIRING_TARGET`) — so reminder and matrix cannot diverge.

**Phase greenness** — Task 1.2 commits the schema change and the fixture sweep together (Steps 3–9 land in one commit at Step 10), so no commit on the branch is RED. Phases 2–7 are additive and the suite is green after every commit. `dist/` regenerates ONLY in Phase 7 Task 7.2 Step 5; no earlier `bun run build` runs.

**Known manual risk** — the CLAUDE.md §4 verbatim sync of `EXECUTION_STATE_FOOTER` across `descriptions.ts` and 21 `docs/SPEC.md §4` descriptions has no mechanical test (consistent with `PROVENANCE_FOOTER`). Task 5.1 Step 7 is an explicit manual diff gate.

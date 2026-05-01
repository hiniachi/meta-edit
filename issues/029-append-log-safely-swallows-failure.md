---
id: a7-04
category: security/audit-integrity
severity: HIGH
affected_files:
  - src/tools/common.ts
test_file: src/tools/common.test.ts
---

# [SECURITY] `appendLogSafely` swallows log failures into untyped warnings, destroying audit integrity

## Summary

When `log.append` throws, `appendLogSafely` (lines 341-356 of `src/tools/common.ts`)
appends the failure message to the same `string[]` warnings array that carries
routine validation notices.  The handler returns:

```typescript
// src/tools/common.ts lines 333-337
return {
  applied: result.applied,
  edit_id: editId,
  warnings: finalWarnings,   // mixes validation warnings WITH log-failure message
};
```

A caller (another AI agent, an MCP client) cannot distinguish between:

1. A routine validation warning ("test_files should be non-empty").
2. A log-write failure — meaning **the edit was applied but not recorded**.

An edit that silently loses its audit trail is an integrity violation: the
operator believes the log is complete, but it has gaps.  There is also no
structured field to let monitoring code react differently to log failures.

Relevant code verbatim (lines 341-356):

```typescript
function appendLogSafely(
  log: EditLogLike,
  entry: import("../state/edit-log.js").EditLogEntry,
): string[] {
  try {
    log.append(entry);
    return entry.warnings;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    const msg = (e as Error | undefined)?.message ?? String(e);
    return [
      ...entry.warnings,
      `failed to append edit log entry "${entry.edit_id}" (${code ?? "ERR"}: ${msg}); the call result is reported but the audit record may be missing or incomplete`,
    ];
  }
}
```

And the call site (lines 327-337):

```typescript
const finalWarnings = appendLogSafely(log, { ...baseEntry, ... });
return {
  applied: result.applied,
  edit_id: editId,
  warnings: finalWarnings,
};
```

## Attack surface

- **Vector**: disk-full, permission error, or race condition on
  `.meta-edit/state/edits.jsonl`.
- **Impact**: An edit is applied to disk but the audit record is missing.
  Operators and downstream tools (e.g., `meta-edit summary`) see a false
  "complete" picture.  A monitoring script that checks `response.warnings` for
  strings cannot reliably detect log failures without string-matching heuristics.
- **Severity**: HIGH — audit integrity is a core guarantee of the tool.

## Reproducing failing test

Add to `src/tools/common.test.ts`:

```typescript
import { afterAll, beforeAll, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  makeApplyingHandler,
  type EditLogLike,
  type ValidationContext,
  type ApplyChangesFn,
  type EditToolRequest,
  type Change,
} from "./common.js";

// ---------------------------------------------------------------------------
// Minimal in-memory helpers
// ---------------------------------------------------------------------------

function makeRepoRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-logfail-"));
  // Create the target file so apply succeeds.
  fs.writeFileSync(path.join(dir, "src.ts"), "const x = 1;\n");
  return dir;
}

function makeChange(file: string, before: string, after: string): Change {
  return { file, before_content: before, after_content: after };
}

/** Fake log whose append always throws the supplied error. */
function makeFailingLog(error: Error): EditLogLike {
  let callCount = 0;
  return {
    nextEditId(_now?: Date): string {
      return `edit_20260501_${String(++callCount).padStart(4, "0")}`;
    },
    append(_entry): void {
      throw error;
    },
  };
}

/** Fake applyChanges that reports success without touching disk. */
const noopApply: ApplyChangesFn = (_repoRoot, _changes) => ({
  applied: true,
  warnings: [],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("appendLogSafely audit-integrity", () => {
  let repoRoot: string;

  beforeAll(() => { repoRoot = makeRepoRoot(); });
  afterAll(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("response.warnings contains the disk-full message when log.append throws", async () => {
    const diskFullError = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    const ctx: ValidationContext = { repoRoot };
    const handler = makeApplyingHandler({
      ctx,
      log: makeFailingLog(diskFullError),
      applyChanges: noopApply,
    });

    const request: EditToolRequest = {
      target_file: "src.ts",
      rationale: "tighten guard",
      risk_level: "low",
      test_files: ["tests/src.test.ts"],
      changes: [makeChange("src.ts", "const x = 1;\n", "const x = 2;\n")],
    };

    const result = await handler("edit_boundary_condition", request);
    expect(result.applied).toBe(true);

    // The current behaviour: log failure is buried in warnings[].
    // This assertion PASSES on current code (the message is there).
    expect(
      result.warnings.some((w) => w.includes("disk full")),
    ).toBe(true);

    // The proposed contract: a structured `log_error` field that is distinct
    // from routine validation warnings.  THIS ASSERTION FAILS on current code
    // because `log_error` does not exist.
    // It exists to motivate the structural change.
    expect((result as unknown as Record<string, unknown>).log_error).toBeDefined();
  });

  it("response.warnings does NOT mix log-failure with validation warnings", async () => {
    const diskFullError = new Error("disk full");
    const ctx: ValidationContext = { repoRoot };
    const handler = makeApplyingHandler({
      ctx,
      log: makeFailingLog(diskFullError),
      applyChanges: noopApply,
    });

    const request: EditToolRequest = {
      target_file: "src.ts",
      rationale: "tighten guard",
      risk_level: "low",
      test_files: ["tests/src.test.ts"],
      changes: [makeChange("src.ts", "const x = 1;\n", "const x = 2;\n")],
    };

    const result = await handler("edit_boundary_condition", request);

    // A caller using `response.warnings.length === 0` to check "clean" edits
    // will be misled when there is a log failure.  After the fix, log errors
    // should appear in `log_error`, not `warnings`, so warnings remains clean.
    // FAILS on current code because warnings is non-empty due to log failure.
    expect(result.warnings.length).toBe(0);
    expect((result as unknown as Record<string, unknown>).log_error).toMatch(/disk full/);
  });
});
```

**The second test and the `log_error` assertion in the first test currently
fail** because the response type has no `log_error` field and log failures are
merged into `warnings`.

## Expected vs actual

| Scenario | Expected | Actual |
|---|---|---|
| `log.append` throws | response has `log_error: string` field | no `log_error` field |
| `result.warnings` on clean apply with log failure | empty (no validation issues) | contains the log-failure string |
| Caller can distinguish log-failure from validation warning | yes, via `log_error` | no — must guess from string content |

## Suggested fix direction

1. Extend `EditToolResult` in `src/tools/common.ts`:
   ```typescript
   export type EditToolResult = {
     applied: boolean;
     edit_id: string;
     warnings: string[];
     log_error?: string;   // set iff log.append threw; absent on success
   };
   ```

2. Change `appendLogSafely` to return the structured result:
   ```typescript
   function appendLogSafely(
     log: EditLogLike,
     entry: EditLogEntry,
   ): { warnings: string[]; log_error?: string } {
     try {
       log.append(entry);
       return { warnings: entry.warnings };
     } catch (e) {
       const code = (e as NodeJS.ErrnoException | undefined)?.code;
       const msg = (e as Error | undefined)?.message ?? String(e);
       return {
         warnings: entry.warnings,
         log_error: `failed to append edit log entry "${entry.edit_id}" (${code ?? "ERR"}: ${msg}); audit record may be missing`,
       };
     }
   }
   ```

3. Update the call site to spread `log_error` into the return value:
   ```typescript
   const { warnings: finalWarnings, log_error } = appendLogSafely(log, { ... });
   return {
     applied: result.applied,
     edit_id: editId,
     warnings: finalWarnings,
     ...(log_error !== undefined ? { log_error } : {}),
   };
   ```

## Out of scope notes

Retrying the log write, rolling back the applied edit, or blocking the MCP
response until the log flush succeeds are all out of scope for MVP (see
`SPEC.md` §3).  The comment in `common.ts` lines 322-326 explicitly justifies
not throwing; this issue only asks for better signal, not a behaviour change.

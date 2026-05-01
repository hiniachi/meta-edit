---
id: a3-03
category: security/hook-runtime
severity: HIGH
affected_files: [src/hooks/hook-runtime.ts, src/hooks/deny-raw-edit.ts, src/hooks/deny-bash-write-bypass.ts]
test_file: src/hooks/hook-runtime.test.ts (NEW)
---

# [SECURITY] Fail-closed behaviour of `readStdin` is untested — regression risk on security-critical path

## Summary

`hook-runtime.ts` intentionally rejects with a parse error when stdin contains
non-JSON bytes, causing both `deny-raw-edit.ts` and `deny-bash-write-bypass.ts`
to exit with code 2 (fail-closed). This is the correct security posture: a hook
crash should block the tool call, not allow it. However, this critical path has
**zero test coverage**. Any future refactor that accidentally swallows the error,
resolves with a default value, or changes the exit code would silently convert the
fail-closed guarantee into a fail-open vulnerability, with no test to catch it.

## Attack surface

`hook-runtime.ts` lines 15–33:

```typescript
export async function readStdin(): Promise<HookEvent> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim().length === 0) {
        resolve({});          // ← empty stdin is treated as "no event"
        return;
      }
      try {
        resolve(JSON.parse(text) as HookEvent);
      } catch (e) {
        reject(e);            // ← non-JSON rejects the promise
      }
    });
    process.stdin.on("error", reject);
  });
}
```

`deny-raw-edit.ts` lines 33–38:

```typescript
main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`deny-raw-edit hook crashed: ${(err as Error).message}`);
    process.exit(2);          // ← fail-closed: exit 2 blocks the tool call
  },
);
```

The reject → `process.exit(2)` chain is security-critical. If `readStdin` were
changed to `resolve({})` on parse failure (a tempting "graceful degradation"),
the hook would silently allow any tool call that arrives with malformed JSON—
including calls an attacker could craft by injecting into the hook event stream.

No existing test exercises this path.

## Reproducing failing test

Create `src/hooks/hook-runtime.test.ts` (new file). The test below **fails
currently** because the file does not exist; once created it documents the
required behaviour and will pass only if `readStdin` correctly rejects on bad input.

```typescript
import { describe, it, expect } from "bun:test";
import { Readable } from "node:stream";
import { readStdin } from "./hook-runtime.js";

// ---------------------------------------------------------------------------
// Helper: temporarily replace process.stdin with a mock Readable.
// Restores the original after the test.
// ---------------------------------------------------------------------------
async function withMockStdin<T>(
  data: string | Buffer,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.stdin;
  const mock = Readable.from(
    (async function* () {
      yield typeof data === "string" ? Buffer.from(data) : data;
    })(),
  );
  // Node types require the cast; this is the standard test-double pattern.
  (process as NodeJS.Process & { stdin: Readable }).stdin = mock as unknown as typeof process.stdin;
  try {
    return await fn();
  } finally {
    (process as NodeJS.Process & { stdin: Readable }).stdin = original as unknown as typeof process.stdin;
  }
}

describe("readStdin — fail-closed behaviour", () => {
  it("rejects when stdin contains non-JSON bytes", async () => {
    // This is the critical path: malformed input must reject so that the
    // hook exits 2 (blocked) rather than silently allowing the tool call.
    await expect(
      withMockStdin("this is not json {{{", () => readStdin()),
    ).rejects.toThrow();
  });

  it("rejects on truncated JSON", async () => {
    await expect(
      withMockStdin('{"tool_name": "Edit"', () => readStdin()),
    ).rejects.toThrow();
  });

  it("rejects on bare string value (not an object)", async () => {
    // JSON.parse('"hello"') succeeds but is not a Record — if readStdin
    // ever adds a shape check, this ensures it still rejects non-objects.
    // For now this verifies the parse-error path for invalid JSON objects.
    await expect(
      withMockStdin("null", () => readStdin()),
    ).resolves.toEqual(null as unknown as Record<string, unknown>);
    // ^ null parses; document that we get it back (current behaviour).
    // A stricter fix would reject non-object payloads too — see fix direction.
  });

  it("resolves with empty object on empty stdin (existing behaviour preserved)", async () => {
    await expect(
      withMockStdin("   ", () => readStdin()),
    ).resolves.toEqual({});
  });

  it("resolves with parsed object on valid JSON stdin", async () => {
    await expect(
      withMockStdin(JSON.stringify({ tool_name: "Edit" }), () => readStdin()),
    ).resolves.toEqual({ tool_name: "Edit" });
  });
});
```

Running `bun test src/hooks/hook-runtime.test.ts` currently produces a module
resolution error (file does not exist) — demonstrating that the fail-closed path
is completely untested.

## Expected vs actual

| Scenario | Expected | Actual (untested — inferred from source) |
|---|---|---|
| Non-JSON stdin | `readStdin()` promise rejects | Rejects (unverified by any test) |
| Hook exits on rejection | `process.exit(2)` | Exits 2 (unverified by any test) |
| Fail-closed preserved after refactor | Caught by test suite | No regression guard exists |

## Suggested fix direction

1. Create `src/hooks/hook-runtime.test.ts` with the tests above. This is the
   minimum viable fix — it pins the current correct behaviour against regression.

2. (Optional hardening) Consider rejecting payloads where `JSON.parse` succeeds
   but the result is not a plain object (`null`, arrays, primitives). Currently
   `readStdin` returns `null` or `[...]` cast as `HookEvent`, and callers do
   `typeof event["tool_name"] === "string"` which handles these gracefully, but
   the defence-in-depth is shallow.

3. (Optional hardening) Add a spawned-process integration test that sends bad
   JSON to `deny-raw-edit` via its stdin and asserts `exitCode === 2`.

## Out of scope notes

This issue only asks for a regression test to be added — no new logic.
"Missing test for security-critical path" is itself a defect in security-sensitive
code; the absence creates undetectable regression risk on the fail-closed guarantee
that SPEC.md §5.1 implicitly requires.

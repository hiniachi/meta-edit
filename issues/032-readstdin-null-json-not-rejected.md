---
id: a8-03
category: security/hook-runtime
severity: MEDIUM
affected_files:
  - src/hooks/hook-runtime.ts
  - src/hooks/deny-raw-edit.ts
  - src/hooks/deny-bash-write-bypass.ts
test_file: src/hooks/hook-runtime.test.ts
---

# [BUG] `readStdin` resolves `null` JSON payload as `Record<string, unknown>`, crashing hook handlers

## Summary

`readStdin` in `src/hooks/hook-runtime.ts` parses the stdin JSON and casts the result
as `HookEvent = Record<string, unknown>`:

```typescript
// src/hooks/hook-runtime.ts lines 26-28
try {
  resolve(JSON.parse(text) as HookEvent);
} catch (e) {
  reject(e);
}
```

`JSON.parse("null")` returns the JavaScript value `null`, which is a valid parse result.
The cast `as HookEvent` is a TypeScript type assertion with no runtime effect — `null`
is returned from the promise as if it were a `Record<string, unknown>`.

The hook handlers that consume this value immediately access object properties:

```typescript
// src/hooks/deny-raw-edit.ts (pattern)
const toolName = event["tool_name"];

// src/hooks/deny-bash-write-bypass.ts (pattern)
const input = event["tool_input"] as { command?: string } | undefined;
```

In JavaScript, `null["tool_name"]` throws `TypeError: Cannot read properties of null
(reading 'tool_name')`. This uncaught exception propagates up to the hook entry point,
which exits with code 2 (fail-closed) — blocking the tool use.

**The fail-closed outcome is correct behavior** — the hook does not allow the tool
call. However:

1. The error message surfaced to the user is a raw `TypeError`, not a descriptive
   message explaining why the hook rejected the input.
2. The test at `hook-runtime.test.ts` lines 45-53 documents this as "current behaviour"
   without asserting it is correct:
   ```typescript
   await expect(
     withMockStdin("null", () => readStdin()),
   ).resolves.toEqual(null as unknown as Record<string, unknown>);
   // ^ null parses; document that we get it back (current behaviour).
   // A stricter fix would reject non-object payloads too — see fix direction.
   ```
   The comment acknowledges the gap but the test asserts the wrong thing: it verifies
   `readStdin` resolves to `null` rather than verifying it rejects.
3. `"\"hello\""` (a bare JSON string) has the same problem — `JSON.parse('"hello"')`
   returns a string, not an object, which also causes a `TypeError` downstream with an
   unhelpful message.

## Attack surface / impact

- **Vector**: Claude Code sends a malformed hook event (e.g. the hook protocol changes,
  or a test harness sends `null`).
- **Impact**: Hook crashes with `TypeError` instead of a structured denial. The tool
  call is still blocked (exit 2), so there is no security bypass. The problem is
  **diagnostic quality**: the operator sees a confusing stack trace rather than
  `"hook received non-object JSON payload"`.
- **Severity**: MEDIUM — no security bypass, but the test actively documents incorrect
  behavior as acceptable and will mislead future maintainers who try to tighten the
  contract.

## Reproducing failing test

Add to `src/hooks/hook-runtime.test.ts` in the `"readStdin — fail-closed behaviour"` describe block:

```typescript
it("rejects when stdin contains JSON null (not a Record)", async () => {
  // JSON.parse("null") === null is valid JSON but not a HookEvent object.
  // readStdin must reject so the caller gets a descriptive error rather
  // than a downstream TypeError when accessing event["tool_name"].
  //
  // This FAILS on current code: readStdin resolves to null instead of
  // rejecting.
  await expect(
    withMockStdin("null", () => readStdin()),
  ).rejects.toThrow(/non-object|not an object|HookEvent/i);
});

it("rejects when stdin contains a bare JSON string (not a Record)", async () => {
  // JSON.parse('"hello"') === "hello" — a string is not a HookEvent object.
  // Same structural gap as null: passes TypeScript cast but crashes downstream.
  //
  // This FAILS on current code: readStdin resolves to "hello".
  await expect(
    withMockStdin('"hello"', () => readStdin()),
  ).rejects.toThrow(/non-object|not an object|HookEvent/i);
});
```

Also update the existing test at lines 45-53 to assert the reject (not resolve)
behavior. The current test asserts the wrong outcome — it passes today only because it
says `resolves.toEqual(null ...)` which is truthy. After the fix it should say `rejects`.

Run with:

```
bun test src/hooks/hook-runtime.test.ts
```

Both new tests currently fail (readStdin resolves instead of rejecting).

## Expected vs actual

| Input | Expected | Actual |
|---|---|---|
| `"null"` stdin | `readStdin()` rejects with descriptive error | `readStdin()` resolves with `null`, downstream handler crashes with `TypeError` |
| `'"hello"'` stdin | `readStdin()` rejects with descriptive error | `readStdin()` resolves with `"hello"`, downstream handler crashes with `TypeError` |
| `"42"` stdin | `readStdin()` rejects with descriptive error | `readStdin()` resolves with `42`, downstream handler crashes with `TypeError` |

## Suggested fix direction

Add a shape check after `JSON.parse`:

```typescript
export async function readStdin(): Promise<HookEvent> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim().length === 0) {
        resolve({});
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        reject(e);
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        reject(
          new TypeError(
            `hook-runtime: readStdin expected a JSON object but got ${
              parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed
            }`,
          ),
        );
        return;
      }
      resolve(parsed as HookEvent);
    });
    process.stdin.on("error", reject);
  });
}
```

Also update the test at lines 45-53 from `resolves.toEqual(null ...)` to
`rejects.toThrow(...)` to match the corrected contract.

## Out of scope notes

The fail-closed consequence (exit 2 blocks the tool call) is already correct. This
issue is about diagnostic quality and test correctness, not a security bypass.
Arrays (`JSON.parse("[]")`) have the same shape-check gap and should be handled
by the same fix.

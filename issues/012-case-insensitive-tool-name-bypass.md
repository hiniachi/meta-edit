---
id: a3-01
category: security/raw-edit-bypass
severity: HIGH
affected_files: [src/hooks/raw-edit-policy.ts]
test_file: src/hooks/raw-edit-policy.test.ts
---

# [SECURITY] Case-sensitive tool name set allows bypass via alternate casing

## Summary

`RAW_EDIT_TOOLS` is a `Set<string>` populated with exactly `"Edit"`, `"Write"`,
and `"MultiEdit"`. The guard `RAW_EDIT_TOOLS.has(toolName)` performs a strict
byte-for-byte comparison. Any host environment (or future Claude Code version)
that delivers tool names in a different case—`"edit"`, `"WRITE"`, `"multiedit"`,
etc.—silently bypasses the deny gate and the raw edit proceeds unchecked.

## Attack surface

`raw-edit-policy.ts` lines 8–12 and 20:

```typescript
// line 8
export const RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
]);

// line 20
if (RAW_EDIT_TOOLS.has(toolName)) {
```

The set lookup is case-sensitive. An agent (or a shim in front of Claude Code)
that sends `tool_name: "edit"` or `tool_name: "WRITE"` receives `decision:
"allow"` instead of `"deny"`.

Claude Code's current behaviour is to pass exactly `"Edit"` / `"Write"` /
`"MultiEdit"`, but this is an empirical observation, not a documented guarantee.
The spec (§5.1) states the hook is "triggered on `PreToolUse` for `Edit`, `Write`,
`MultiEdit`" without specifying the casing contract. The implementation should be
robust to casing rather than relying on an undocumented host-side guarantee.

## Reproducing failing test

Add the following tests to `src/hooks/raw-edit-policy.test.ts`.
All three `expect` calls **currently pass** with `"allow"` but **should** be
`"deny"` once the fix is applied — i.e. they are failing assertions that
document the desired (not yet implemented) behaviour.

```typescript
// Add inside the existing describe("evaluateRawEdit", ...) block

it("denies lowercase 'edit' (case-insensitive contract)", () => {
  // Currently returns "allow" — this is the defect.
  const r = evaluateRawEdit("edit");
  expect(r.decision).toBe("deny");
});

it("denies uppercase 'WRITE' (case-insensitive contract)", () => {
  // Currently returns "allow" — this is the defect.
  const r = evaluateRawEdit("WRITE");
  expect(r.decision).toBe("deny");
});

it("denies mixed-case 'multiedit' (case-insensitive contract)", () => {
  // Currently returns "allow" — this is the defect.
  const r = evaluateRawEdit("multiedit");
  expect(r.decision).toBe("deny");
});
```

## Expected vs actual

| Input | Expected | Actual |
|---|---|---|
| `"edit"` | `deny` | `allow` |
| `"WRITE"` | `deny` | `allow` |
| `"multiedit"` | `deny` | `allow` |

## Suggested fix direction

Normalise the tool name to lower-case before the set lookup, and store the set
members in lower-case:

```typescript
const LOWER_RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "multiedit",
]);

export function evaluateRawEdit(toolName: string): HookDecision {
  if (LOWER_RAW_EDIT_TOOLS.has(toolName.toLowerCase())) {
    return {
      decision: "deny",
      reason: `meta-edit forbids the raw "${toolName}" tool. ...`,
    };
  }
  return { decision: "allow" };
}
```

The `RAW_EDIT_TOOLS` export used in the existing "exposes the exact denied set"
test would need updating or that test's assertion adjusted to lower-case members.

## Out of scope notes

This issue does not propose adding detection logic or classification.
The fix is purely defensive normalisation on a security-critical string comparison,
consistent with MVP scope (§3).

---
id: a4-03
category: security/protected-paths
severity: MEDIUM
affected_files:
  - src/state/protected-paths.ts
test_file: src/state/protected-paths.test.ts
---

# [SECURITY] Exact directory name without trailing slash not matched by isProtectedPath

## Summary

`isProtectedPath` checks `norm.startsWith(".meta-edit/state/")` and
`norm.startsWith(".meta-edit/tmp/")`. Both prefixes carry a trailing slash.
A caller that passes the bare directory name — `".meta-edit/state"` or
`".meta-edit/tmp"` — without a trailing slash will receive `false`, because
`"meta-edit/state"` does not start with `".meta-edit/state/"` (the trailing
slash is absent from the input).

This matters when:

1. A tool or hook receives a path that refers to the protected directory itself
   (e.g., `rmdir .meta-edit/state`, `chmod 777 .meta-edit/state`, or an edit
   tool invoked with `target_file: ".meta-edit/state"`).
2. A shell redirect writes to what is ostensibly a directory path without a
   trailing slash — some shells accept `cat foo > dir` if `dir` is a regular
   file that was renamed to a directory name.
3. Future callers (e.g., a `mkdir -p` guard) pass the directory path to
   `isProtectedPath` as a pre-creation check.

The guard must return `true` for the exact directory names as well as for
paths beneath them.

## Attack surface

- **Entry point**: any call to `isProtectedPath` with a path that is exactly
  the protected directory name (no trailing slash, no child path).
- **Affected function**: `isProtectedPath` in `src/state/protected-paths.ts`.
- **All callers inherit the gap**: `touchesProtectedPath` (bash hook),
  `checkPathSafety` (tools/common.ts), and any future callers.
- **Severity**: MEDIUM — exploiting this requires the caller to produce the
  bare directory path rather than a file path beneath it, which is less common
  than file-path attacks. However, the gap is trivially fixable and the current
  behaviour is semantically wrong.

## Reproducing failing test

Add to `src/state/protected-paths.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// C3 — Exact directory name without trailing slash
// ---------------------------------------------------------------------------
describe("isProtectedPath — exact directory name without trailing slash (C3)", () => {
  it("returns true for '.meta-edit/state' (no trailing slash)", () => {
    // The protected prefix is ".meta-edit/state/". The bare directory name
    // ".meta-edit/state" is semantically within the protected set but the
    // startsWith check fails because the input has no trailing slash.
    expect(isProtectedPath(".meta-edit/state")).toBe(true);
  });

  it("returns true for '.meta-edit/tmp' (no trailing slash)", () => {
    expect(isProtectedPath(".meta-edit/tmp")).toBe(true);
  });

  it("returns true for './.meta-edit/state' (leading ./ stripped, no trailing slash)", () => {
    expect(isProtectedPath("./.meta-edit/state")).toBe(true);
  });

  it("returns true for './.meta-edit/tmp' (leading ./ stripped, no trailing slash)", () => {
    expect(isProtectedPath("./.meta-edit/tmp")).toBe(true);
  });
});
```

**Why these tests currently fail**:

- `normalizeRepoRelative(".meta-edit/state")` → `".meta-edit/state"`.
- `".meta-edit/state".startsWith(".meta-edit/state/")` → `false` (no trailing
  slash on the input, but the prefix requires one).
- The function returns `false`.

## Expected vs actual

| Input | Expected | Actual |
|---|---|---|
| `".meta-edit/state"` | `true` | `false` |
| `".meta-edit/tmp"` | `true` | `false` |
| `"./.meta-edit/state"` | `true` | `false` |
| `"./.meta-edit/tmp"` | `true` | `false` |

## Suggested fix direction

Extend `isProtectedPath` to also match when the normalized path equals a
protected directory name (i.e., the prefix minus its trailing slash):

```typescript
export function isProtectedPath(p: string): boolean {
  const norm = normalizeRepoRelative(p);
  const folded = norm.toLowerCase();
  return PROTECTED_PREFIXES.some((prefix) => {
    const dir = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return (
      norm.startsWith(prefix) ||
      folded.startsWith(prefix) ||
      norm === dir ||
      folded === dir
    );
  });
}
```

This is a pure-string change with no filesystem access and no impact on
existing passing tests.

## Out of scope notes

- Trailing-slash normalization on `PROTECTED_PREFIXES` themselves is not needed;
  the fix should be in the comparison logic, not the constants, so that
  `PROTECTED_PREFIXES` remains the authoritative prefix list for other consumers.
- The bash hook also benefits from this fix because `touchesProtectedPath` calls
  `isProtectedPath` directly; no separate hook-layer change is required for
  this issue.

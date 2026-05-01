---
id: a2-01
category: security/bash-bypass
severity: HIGH
affected_files: [src/hooks/bash-write-policy.ts]
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] Unicode whitespace `tee` bypass via U+00A0 non-breaking space

## Summary

`DENY_SUBSTRINGS` blocks `"tee "` (U+0020), `"tee\t"` (U+0009), and `"tee -a"`, but not `"tee "` (U+00A0 NON-BREAKING SPACE) or other Unicode whitespace separators (e.g. U+2009 THIN SPACE, U+202F NARROW NO-BREAK SPACE). A shell such as bash passes `tee src/foo.ts` to `/usr/bin/tee` with the argument `src/foo.ts` after the kernel strips the UTF-8 byte sequence in argv, so the file write succeeds at runtime while `evaluateBashCommand` returns `"allow"`.

## Attack surface

An agent or user constructs a piped command using a non-breaking space between `tee` and the target path. The substring scan at `bash-write-policy.ts:233-239` does a simple `normalized.includes(needle)` check on each entry in `DENY_SUBSTRINGS`. Because none of the three `tee` entries include U+00A0, the check passes.

Relevant code — `bash-write-policy.ts:42-55` (DENY_SUBSTRINGS declaration):

```typescript
export const DENY_SUBSTRINGS: readonly string[] = [
  // …
  "tee ",   // U+0020 only
  "tee\t",  // U+0009 only
  "tee -a",
  // …
];
```

And `bash-write-policy.ts:233-239` (scan site):

```typescript
for (const needle of DENY_SUBSTRINGS) {
  if (normalized.includes(needle)) {
    return { decision: "deny", reason: denyReason(needle) };
  }
}
```

## Reproducing failing test

```typescript
import { describe, it, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

describe("evaluateBashCommand — unicode whitespace tee bypass (A2-01)", () => {
  it("denies tee with non-breaking space (U+00A0)", () => {
    // U+00A0 between "tee" and "src/foo.ts" — not matched by "tee " or "tee\t"
    const r = evaluateBashCommand("echo x | tee src/foo.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies tee with thin space (U+2009)", () => {
    const r = evaluateBashCommand("echo x | tee src/foo.ts");
    expect(r.decision).toBe("deny");
  });
});
```

Both tests currently return `"allow"` because neither `"tee "` nor `"tee "` appears in `DENY_SUBSTRINGS`.

## Expected vs actual

| Input | Expected | Actual |
|---|---|---|
| `echo x \| tee src/foo.ts` | `deny` | `allow` |
| `echo x \| tee src/foo.ts` | `deny` | `allow` |

## Suggested fix direction

Two options:

1. **Explicit Unicode whitespace entries**: Add `"tee "`, `"tee "`, `"tee "`, etc. to `DENY_SUBSTRINGS`. This is fragile — the Unicode whitespace category has 25+ code points.

2. **Token-based verb detection for `tee`**: After the substring scan, extract the verb of each pipe segment (reusing `extractCommandVerb`) and deny on `tee` as a verb. This is more robust: it catches any separator between `tee` and its argument, normalizes absolute paths (`/usr/bin/tee`), and handles wrappers (`sudo tee`).

Option 2 is preferable. Move `tee` from `DENY_SUBSTRINGS` into `DENY_VERBS` (which already contains `mv`, `cp`, `patch`) so it is matched by the verb-extraction path rather than the raw substring path.

## Out of scope notes

Detection of whether the tee target is inside the repo is out of scope for MVP (SPEC §11). The current design denies `tee` unconditionally regardless of target path, consistent with how other write verbs are treated.

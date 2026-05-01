---
id: a2-04
category: security/bash-bypass
severity: HIGH
affected_files: [src/hooks/bash-write-policy.ts]
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] `>|` noclobber-override redirect not detected by `redirectsToProtected`

## Summary

`redirectsToProtected` recognizes `>` and `>>` redirect operators and specially-cases `>&` (fd-duplication). It does **not** handle `>|` (the POSIX noclobber-override operator). `cat foo >| .meta-edit/state/edits.jsonl` writes to the protected edit log path and returns `"allow"` today.

## Attack surface

When a shell runs with `set -o noclobber` (which prevents accidental overwrites), `>` would fail if the target exists. `>|` overrides this safety. An agent command using `>|` to redirect output to `.meta-edit/state/edits.jsonl` or `.meta-edit/tmp/` bypasses both the noclobber guard and the meta-edit policy hook simultaneously.

The `cat` verb is in `READ_ONLY_VERBS`, so the path through `evaluateBashCommand` for `cat foo >| .meta-edit/state/edits.jsonl` is:

1. `touchesProtectedPath(normalized)` → `true` (path contains `.meta-edit/state/`)
2. `extractCommandVerb` → `"cat"`
3. `READ_ONLY_VERBS.has("cat")` → `true`
4. `redirectsToProtected(normalized)` → **`false`** (bug: `>|` is not handled)
5. Because `isReadOnly && !writeTargetsProtected`, the function returns `"allow"`.

Relevant code — `redirectsToProtected` at `bash-write-policy.ts:617-624`:

```typescript
// c is `>` outside quotes. Skip fd-duplication (`>&`).
if (s[i + 1] === "&") {
  i += 2;
  continue;
}
// Skip past the redirect operator (one or two `>`s).
let j = i + 1;
if (s[j] === ">") j++;   // handles >> but not >|
```

When `s[i]` is `>` and `s[i+1]` is `|`, the `>&` check at line 618 does not match, and `j` advances to `i+1` (pointing at `|`). The `if (s[j] === ">") j++` on line 624 does not match `|`. The code then reads whitespace and the token — but the token starts at `|`, which is a shell delimiter and terminates the token-read loop immediately (line 635: `tc === "|"` breaks). `target` is an empty string, and `containsAsPathComponent("", needle)` returns false. The redirect is silently skipped.

## Reproducing failing test

```typescript
import { describe, it, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

describe("evaluateBashCommand — >| noclobber-override redirect (A2-04)", () => {
  it("denies cat redirected with >| to protected state path", () => {
    // cat is READ_ONLY_VERBS; only redirectsToProtected() can deny this.
    // >| is not handled — currently returns "allow".
    const r = evaluateBashCommand(
      "cat foo >| .meta-edit/state/edits.jsonl",
    );
    expect(r.decision).toBe("deny");
  });

  it("denies echo redirected with >| to protected tmp path", () => {
    const r = evaluateBashCommand(
      "echo payload >| .meta-edit/tmp/scratch.json",
    );
    expect(r.decision).toBe("deny");
  });

  it("still allows cat reading from protected path without redirect", () => {
    // Regression guard: read-only access must remain allowed.
    const r = evaluateBashCommand("cat .meta-edit/state/edits.jsonl");
    expect(r.decision).toBe("allow");
  });
});
```

The first two tests currently return `"allow"` (bypass). The third must remain `"allow"` after the fix.

## Expected vs actual

| Input | Expected | Actual |
|---|---|---|
| `cat foo >\| .meta-edit/state/edits.jsonl` | `deny` | `allow` (bypass) |
| `echo payload >\| .meta-edit/tmp/scratch.json` | `deny` | `allow` (bypass) |
| `cat .meta-edit/state/edits.jsonl` (no redirect) | `allow` | `allow` (correct) |

## Suggested fix direction

In `redirectsToProtected`, after the `>&` skip check, add a parallel check for `>|`:

```typescript
// Skip fd-duplication (`>&`).
if (s[i + 1] === "&") {
  i += 2;
  continue;
}
// Handle noclobber-override `>|` — treat as a write redirect.
let j = i + 1;
if (s[j] === "|") {
  j++;  // consume the `|`, then fall through to token-read below
} else if (s[j] === ">") {
  j++;  // handle `>>`
}
```

After this change, `>|` is correctly treated as a write redirect operator and the target token (`.meta-edit/state/edits.jsonl`) is extracted and checked against `PROTECTED_PATH_NEEDLES`.

## Out of scope notes

Other exotic redirect forms (e.g. `{fd}>`, `&>`, process substitutions `>(cmd)`) are out of scope for MVP. The `>|` case is specifically high-priority because it is the standard shell idiom for bypassing noclobber and is available in all POSIX-compliant shells.

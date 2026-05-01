---
id: a2-03
category: security/bash-bypass
severity: MEDIUM
affected_files: [src/hooks/bash-write-policy.ts]
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] `env -i` wrapper verb-extraction regression test (env -i mv / cp / patch bypass)

## Summary

`env` is in `WRAPPER_VERBS`. `WRAPPER_VALUE_OPTS.env` lists `-u`, `-C`, and `-S` as value-bearing options but does **not** list `-i` (`--ignore-environment`). Reading `extractCommandVerb` at lines 705-743: after peeling `env`, the loop at line 723-738 consumes flags matching `^(-[^\s-]\S*|--[^\s=]+(?:=\S*)?)`. `-i` matches `^(-[^\s-]\S*)` (it is a single-char flag), and because `-i` is NOT in `WRAPPER_VALUE_OPTS.env`, the loop does **not** consume the next token as a value. Control falls through to `continue` on line 739, and the next iteration picks up `mv` (or `cp`, or `patch`) as the word, which is correctly identified as a `DENY_VERBS` member.

This means `env -i mv src/a.ts src/b.ts` is **currently denied correctly**. However, there is no regression test for this specific flag combination. A future refactor of the flag-skip loop (e.g. adding `-i` to `WRAPPER_VALUE_OPTS.env` by mistake) would silently reintroduce a bypass.

## Attack surface

If `-i` were mistakenly added to `WRAPPER_VALUE_OPTS.env`, `extractCommandVerb("env -i mv src/a.ts src/b.ts")` would consume `mv` as the value of `-i`, leave `src/a.ts` as the remaining word, and return `src/a.ts` as the verb. `src/a.ts` is not in `DENY_VERBS`, so the decision would be `"allow"` — a file-rename bypass.

The flag-skip loop in `extractCommandVerb` (lines 723-738):

```typescript
while (true) {
  const optMatch = s.match(/^(-[^\s-]\S*|--[^\s=]+(?:=\S*)?)/);
  if (optMatch === null || optMatch[0] === undefined) break;
  const opt = optMatch[0];
  s = s.slice(opt.length).replace(/^\s+/, "");
  if (
    valueOpts !== undefined &&
    !opt.includes("=") &&
    valueOpts.has(opt)      // ← -i is NOT here for env; loop skips it cleanly
  ) {
    const valMatch = s.match(/^\S+/);
    if (valMatch !== null && valMatch[0] !== undefined) {
      s = s.slice(valMatch[0].length).replace(/^\s+/, "");
    }
  }
}
```

`WRAPPER_VALUE_OPTS.env` at line 522:

```typescript
env: new Set(["-u", "-C", "-S"]),  // -i is absent — correct
```

## Reproducing failing test

The following test **passes today** but is absent from the test suite. Filing as a required regression test to lock the current correct behavior.

```typescript
import { describe, it, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

describe("evaluateBashCommand — env -i wrapper regression (A2-03)", () => {
  it("denies env -i mv (env -i must not consume mv as value of -i)", () => {
    const r = evaluateBashCommand("env -i mv src/a.ts src/b.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies env -i cp", () => {
    const r = evaluateBashCommand("env -i cp src/foo.ts src/bar.ts");
    expect(r.decision).toBe("deny");
  });

  it("denies env -i patch", () => {
    const r = evaluateBashCommand("env -i patch -p1 < changes.diff");
    expect(r.decision).toBe("deny");
  });

  it("denies env --ignore-environment mv (long form)", () => {
    const r = evaluateBashCommand("env --ignore-environment mv src/a.ts src/b.ts");
    expect(r.decision).toBe("deny");
  });
});
```

All four assertions pass today. If `-i` is ever mistakenly added to `WRAPPER_VALUE_OPTS.env`, the first three will fail and catch the regression.

## Expected vs actual

| Input | Expected | Actual |
|---|---|---|
| `env -i mv src/a.ts src/b.ts` | `deny` | `deny` (correct, no test) |
| `env -i cp src/foo.ts src/bar.ts` | `deny` | `deny` (correct, no test) |
| `env --ignore-environment mv src/a.ts src/b.ts` | `deny` | `deny` (correct, no test) |

## Suggested fix direction

Add the four regression tests above to `src/hooks/bash-write-policy.test.ts`. No source change required — the current logic is correct. The issue is the absence of a test that would catch a future accidental addition of `-i` to `WRAPPER_VALUE_OPTS.env`.

Additionally, add a comment next to `WRAPPER_VALUE_OPTS.env` explicitly noting that `-i` / `--ignore-environment` is a **flag** (no value argument) and must NOT be added to this set.

## Out of scope notes

Enumerating every `env` flag is out of scope for MVP. The regression test is a targeted guard against the specific known-dangerous misclassification.

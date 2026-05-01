---
id: a1-03
category: security/bash-bypass
severity: HIGH
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] `dd of=<file>` writes to source files without triggering any deny pattern

## Summary

`dd if=/dev/stdin of=src/foo.ts` overwrites an arbitrary source file. `dd` appears in a
comment at line 552 explicitly noting the `of=` write mode, yet it is absent from
`DENY_VERBS`, `DENY_SUBSTRINGS`, and `READ_ONLY_VERBS`. Only the protected-path gate
(`.meta-edit/state/**`) would stop a `dd` write — but a write to an ordinary source file
such as `src/foo.ts` is silently allowed. The existing test at line 591 only covers `dd
of=.meta-edit/state/exfil`, which is caught by the protected-path guard, not by any `dd`-
specific rule; writing to non-protected paths is completely unguarded.

## Attack surface

- File:line: `src/hooks/bash-write-policy.ts:496-497` and `549-554`

```typescript
// Verbs whose mere invocation is denied.
const DENY_VERBS: ReadonlySet<string> = new Set(["mv", "cp", "patch"]);
```

```
//   - `dd`       has `of=...`
```

`dd` is documented as a write-capable verb but deliberately (or accidentally) omitted from
`DENY_VERBS`. The comment reads like a warning that was never followed up on.

## Reproducing failing test

File: `src/hooks/bash-write-policy.test.ts` (append)

```ts
import { test, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

test("denies dd of=src/foo.ts (source file write via dd)", () => {
  expect(
    evaluateBashCommand("dd if=/dev/urandom of=src/foo.ts bs=4k count=1").decision,
  ).toBe("deny");
});

test("denies dd of=<file> even without explicit if= argument", () => {
  expect(
    evaluateBashCommand("echo 'hello' | dd of=src/foo.ts").decision,
  ).toBe("deny");
});
```

**Expected (after fix):** `decision === "deny"`
**Actual (current):** `decision === "allow"`

## Suggested fix direction

Add `"dd"` to `DENY_VERBS` so any `dd` invocation (bare, wrapped via `sudo`, or at an
absolute path) is denied. Alternatively add `"of="` to `DENY_SUBSTRINGS` as a narrower
check, but this would miss `dd` invocations where `of=` uses alternate spacing. Adding to
`DENY_VERBS` is simpler and consistent with how `mv`, `cp`, and `patch` are handled.
`dd` has no legitimate read-only use in an agent edit workflow.

## Out of scope notes

`dd` is occasionally used as a progress-monitoring disk-read tool (`dd if=/dev/sda bs=1M
count=0`), but in agent-driven workflows this is vanishingly rare and the false-positive
cost of blocking it is negligible. No allowlist carve-out is needed.

---
id: a1-06
category: security/bash-bypass
severity: HIGH
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] `busybox mv` / `busybox sed -i` bypasses deny patterns — `busybox` not a WRAPPER_VERB

## Summary

`busybox mv src/a.ts src/b.ts` renames a source file. `busybox sed -i 's/x/y/' src/foo.ts`
performs an in-place edit. In both cases `extractCommandVerb` resolves the leading token
to `"busybox"` (not in `WRAPPER_VERBS`), returns immediately with verb `"busybox"`, and
checks `DENY_VERBS.has("busybox")` — which is false. Neither the `mv`/`sed` deny nor any
`DENY_SUBSTRINGS` match fires. Docker and other minimal container images ship only
`busybox`; in CI/agent environments this is a realistic vector.

## Attack surface

- File:line: `src/hooks/bash-write-policy.ts:479-494` (`WRAPPER_VERBS`) and `705-743` (`extractCommandVerb`)

```typescript
const WRAPPER_VERBS: ReadonlySet<string> = new Set([
  "sudo",
  "doas",
  "env",
  "xargs",
  "nice",
  "ionice",
  "nohup",
  "time",
  "command",
  "exec",
  "eval",
  "stdbuf",
  "chrt",
  "taskset",
]);
```

`busybox` is absent. `extractCommandVerb` returns `"busybox"` without peeling the next
token, so `mv`, `cp`, `sed`, etc. never become the evaluated verb.

## Reproducing failing test

File: `src/hooks/bash-write-policy.test.ts` (append)

```ts
import { test, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

test("denies busybox mv (busybox wrapper not recognized)", () => {
  expect(
    evaluateBashCommand("busybox mv src/a.ts src/b.ts").decision,
  ).toBe("deny");
});

test("denies busybox sed -i (busybox wrapper not recognized)", () => {
  expect(
    evaluateBashCommand("busybox sed -i 's/x/y/' src/foo.ts").decision,
  ).toBe("deny");
});

test("denies busybox cp (busybox wrapper not recognized)", () => {
  expect(
    evaluateBashCommand("busybox cp src/foo.ts src/bar.ts").decision,
  ).toBe("deny");
});
```

**Expected (after fix):** `decision === "deny"` for all three
**Actual (current):** `decision === "allow"` for all three

## Suggested fix direction

Add `"busybox"` to `WRAPPER_VERBS`. Since `busybox <applet> [args]` has the same
`<wrapper> <subcommand> [args]` structure as `sudo <command>` and `env <command>`,
no changes to option-stripping logic are needed — the existing wrapper-peeling loop in
`extractCommandVerb` will correctly resolve the sub-applet as the verb. After the fix,
`busybox mv a b` will resolve to verb `mv`, which is in `DENY_VERBS`, and
`busybox sed -i` will remain caught by `DENY_SUBSTRINGS` after the full segment is
re-evaluated. Also consider `toybox` (Android minimal utils) for the same treatment.

## Out of scope notes

`busybox sh -c "…"` would then peel to verb `sh`, which is not currently denied.
That is a separate bypass (nested shell via `sh -c`) and should be tracked independently.
The fix here is strictly adding `busybox` to `WRAPPER_VERBS`.

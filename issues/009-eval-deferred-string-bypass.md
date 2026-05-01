---
id: a2-02
category: security/bash-bypass
severity: HIGH
affected_files: [src/hooks/bash-write-policy.ts]
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] `eval` deferred-string bypass via base64-encoded payload

## Summary

`eval` is in `WRAPPER_VERBS` (`bash-write-policy.ts:490`), so `extractCommandVerb` peels it and attempts to resolve the inner verb. For a literal string like `eval "cat > src/foo.ts"`, the `cat >` substring is matched by `DENY_SUBSTRINGS` via the raw-scan path before verb extraction even runs, so that specific form is correctly denied. However, `eval "$(echo Y2F0ID4gc3JjL2Zvby50cwo= | base64 -d)"` defers the payload entirely to runtime: the static text contains no deny-pattern substring and the verb resolution of `$(…)` produces `null`. The command allows a full file write with zero static signal.

## Attack surface

An agent or adversarial command encodes a deny-pattern payload in base64 (or any other encoding) and passes it to `eval` via command substitution. The policy evaluator has no runtime semantics and cannot expand `$(…)`, so the static analysis gap is fundamental. The concern is that the policy provides a false sense of security: a model that knows the deny patterns can trivially route around them via `eval "$(…)"`.

Relevant code:

`bash-write-policy.ts:484-493` — `eval` is in `WRAPPER_VERBS`:

```typescript
const WRAPPER_VERBS: ReadonlySet<string> = new Set([
  "sudo", "doas", "env", "xargs", "nice", "ionice",
  "nohup", "time", "command", "exec",
  "eval",          // ← treated as a transparent wrapper
  "stdbuf", "chrt", "taskset",
]);
```

`bash-write-policy.ts:705-743` — `extractCommandVerb` peels wrapper verbs and recurses; for `eval "$(…)"` the next word after peeling is `$(…)`, which does not match any `DENY_VERBS` or `DENY_SUBSTRINGS` on its own.

## Reproducing failing test

### Part A — literal eval (currently denied, confirmed working)

```typescript
import { describe, it, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

describe("evaluateBashCommand — eval bypass (A2-02)", () => {
  it("denies eval with literal cat-redirect string", () => {
    // Caught by DENY_SUBSTRINGS "cat >" raw substring scan — currently works.
    const r = evaluateBashCommand('eval "cat > src/foo.ts"');
    expect(r.decision).toBe("deny");
  });

  // Part B — deferred / base64 payload: currently ALLOWS, should DENY
  it("denies eval with base64-encoded cat-redirect (deferred bypass)", () => {
    // base64("cat > src/foo.ts\n") = "Y2F0ID4gc3JjL2Zvby50cwo="
    // The static text has no deny substring; the policy returns "allow".
    const r = evaluateBashCommand(
      'eval "$(echo Y2F0ID4gc3JjL2Zvby50cwo= | base64 -d)"',
    );
    // This assertion FAILS today — actual decision is "allow".
    expect(r.decision).toBe("deny");
  });
});
```

## Expected vs actual

| Input | Expected | Actual |
|---|---|---|
| `eval "cat > src/foo.ts"` | `deny` | `deny` (correct) |
| `eval "$(echo Y2F0ID4gc3JjL2Zvby50cwo= \| base64 -d)"` | `deny` | `allow` (bypass) |

## Suggested fix direction

Two directions (neither requires runtime eval semantics):

1. **Deny `eval` with non-literal arguments**: If the argument to `eval` contains `$(`, `` ` ``, or `$VAR` (i.e. anything beyond a bare literal string), deny outright. Rationale: `eval` with a dynamically-constructed argument is almost never a legitimate formatter or codegen invocation, so the false-positive cost is low. Add to documentation that `eval` of literals is allowed and `eval` of computed strings is denied.

2. **Document as known gap and remove `eval` from `WRAPPER_VERBS`**: Since `eval` cannot be safely "peeled" in a static analysis context, removing it from `WRAPPER_VERBS` means `eval <anything>` is treated as an unknown verb (not denied by `DENY_VERBS`, but also not transparently expanded). This is conservative: `eval "cat > src/foo.ts"` would then be passed to the raw-substring scan which would still catch `cat >`. The base64 case remains a gap but is no longer silently "allowed" via the wrapper-peel path.

Option 1 is preferable for MVP hardening. Option 2 is a safe minimal fallback.

## Out of scope notes

Full dynamic analysis or shell emulation is out of scope for MVP (SPEC §11). This issue documents the static analysis gap so that a v0.2 classifier can address it.

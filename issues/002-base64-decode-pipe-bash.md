---
id: a1-02
category: security/bash-bypass
severity: HIGH
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] `base64 -d | bash` executes arbitrary commands, bypassing all deny patterns

## Summary

`echo SGVsbG8= | base64 -d | bash` decodes a base64 payload and pipes it directly into
a shell interpreter at runtime. None of the resulting write operations appear in the
original command string that `evaluateBashCommand` inspects, so every deny pattern
(including `sed -i`, `cat >`, `mv`, etc.) is evaded in one shot. The file header
acknowledges this class of bypass ("base64-encoded commands") as a known limitation, but
no test pins the current allow behavior or documents the boundary, leaving a future partial
fix free to introduce a regression in the wrong direction.

## Attack surface

- File:line: `src/hooks/bash-write-policy.ts:1-7`

```typescript
// This is a *best-effort* substring filter. Determined attackers can
// always bypass it (heredocs in alternative languages, base64-encoded
// commands, indirect invocations through aliases or wrappers, etc.). The
// goal is to make the obvious bypasses higher-friction than reaching for
// an edit_* tool — not to provide a sandbox.
```

`base64 -d | bash` is the canonical "encode any shell command, run it" exploit.
`evaluateBashCommand` sees only `base64` as the verb after splitting on `|`, which is
neither in `DENY_VERBS` nor matched by any `DENY_SUBSTRINGS` entry, so the command is
unconditionally allowed.

## Reproducing failing test

File: `src/hooks/bash-write-policy.test.ts` (append)

```ts
import { test, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

// The payload decodes to: sed -i 's/x/y/' src/foo.ts
// but that string never appears in the command evaluated by the hook.
test("denies base64 -d | bash (arbitrary command execution bypass)", () => {
  expect(
    evaluateBashCommand(
      "echo 'c2VkIC1pIHMveC95LyBzcmMvZm9vLnRzCg==' | base64 -d | bash",
    ).decision,
  ).toBe("deny");
});
```

**Expected (after fix):** `decision === "deny"`
**Actual (current):** `decision === "allow"`

## Suggested fix direction

Add `"base64 -d |"` and `"base64 --decode |"` to `DENY_SUBSTRINGS`. This catches the
most common form without false positives (legitimate base64 decode into `grep`, `cat`,
`jq`, etc. pipes remain allowed because their verbs come *after* `|` and do not include
`bash`/`sh`/`zsh`). A broader pattern that catches any `base64 -d | <shell>` could
use a targeted regex: if a segment matches `/base64\s+(--decode|-d)\s*\|\s*(ba)?sh\b/`,
deny it. This is narrow enough to avoid hitting `base64 -d | hexdump` or similar
read-only downstream consumers.

## Out of scope notes

Encoding variants (`base32`, `xxd -r`, `openssl enc -d -base64`) are related but
separate bypasses. A minimal fix should target the most obvious `base64 -d | bash`
pattern only; a broader encoded-execution detector is out of scope for MVP per
`SPEC.md §11`.

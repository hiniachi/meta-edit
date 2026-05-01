---
id: a1-01
category: security/bash-bypass
severity: HIGH
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] Heredoc redirect `cat <<EOF > file` bypasses DENY_SUBSTRINGS

## Summary

`DENY_SUBSTRINGS` contains `"cat >"` (space-separated redirect), but the heredoc form
`cat <<EOF > src/foo.ts\nhello\nEOF` places the redirect operator *after* the heredoc
marker rather than directly after `cat`. The substring `cat >` never appears in that
layout because the token order is `cat <<EOF > target`, so the check fires on nothing and
the command is allowed. An agent can use this to overwrite any source file while avoiding
the deny gate entirely.

## Attack surface

- File:line: `src/hooks/bash-write-policy.ts:42-55`

```typescript
export const DENY_SUBSTRINGS: readonly string[] = [
  "sed -i",
  "sed --in-place",
  "perl -pi",
  "perl -i",
  "cat >",
  "cat >>",
  // ...
];
```

The `"cat >"` entry only matches when the redirect directly follows `cat` with a space.
In `cat <<EOF > target` the characters between `cat` and `>` are `" <<EOF "`, so
`indexOf("cat >")` returns -1 and the substring gate is skipped entirely.

## Reproducing failing test

File: `src/hooks/bash-write-policy.test.ts` (append)

```ts
import { test, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

test("denies heredoc redirect: cat <<EOF > src/foo.ts", () => {
  expect(
    evaluateBashCommand("cat <<EOF > src/foo.ts\nhello\nEOF").decision,
  ).toBe("deny");
});
```

**Expected (after fix):** `decision === "deny"`
**Actual (current):** `decision === "allow"`

## Suggested fix direction

Add `"<<EOF >"`, `"<<'EOF' >"`, `'<<"EOF" >'`, and a generic `/<< *\S+ *>/` regex scan to
`DENY_SUBSTRINGS` or a dedicated heredoc-redirect check. The simplest targeted fix is to
add the additional substring `" > "` only when the segment already contains `"<<EOF"` or
any `<<` heredoc marker. Alternatively, add a regex that matches `<<\s*\w+\s*>` anywhere
in the segment and, if found, returns deny because the combination always writes a file.
False-positive risk is low: `<<EOF` without `>` is read-only.

## Out of scope notes

Single-quoted (`<<'EOF'`) and double-quoted (`<<"EOF"`) heredoc markers are also common;
any fix should cover those variants. Do not expand `DENY_SUBSTRINGS` too aggressively —
`cat <<EOF | grep foo` (heredoc piped into grep) is read-only and must not be denied.

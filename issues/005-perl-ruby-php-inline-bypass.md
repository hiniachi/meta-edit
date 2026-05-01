---
id: a1-05
category: security/bash-bypass
severity: HIGH
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] `perl -e`, `ruby -e`, `php -r` inline writes not detected by `matchesPythonNodeWrite`

## Summary

`matchesPythonNodeWrite` covers `python -c` and `node -e` inline script execution with
file-write detection. The equivalent flags for `perl -e`, `ruby -e`, and `php -r` are
absent. An agent can write arbitrary content to source files using
`perl -e 'open(F,">","src/foo.ts");print F "x"'`, `ruby -e 'File.write("src/foo.ts","x")'`,
or `php -r 'file_put_contents("src/foo.ts","x");'` and the hook returns `"allow"` in all
three cases. Note: `perl -pi` and `perl -i` are already covered by `DENY_SUBSTRINGS`, but
`perl -e` (non-in-place inline script) is not.

## Attack surface

- File:line: `src/hooks/bash-write-policy.ts:848-905` (`matchesPythonNodeWrite`)

```typescript
function matchesPythonNodeWrite(normalized: string, raw: string): boolean {
  // python -c / python3 -c (long form `--command` does not exist).
  if (/(?:^|[\s;&|(])python3?\s+-c\b/.test(normalized)) {
    // ...
  }
  // node -e and its long-form equivalent.
  if (NODE_INVOCATION_RE.test(normalized)) {
    // ...
  }
  return false;
}
```

Neither `perl -e`, `ruby -e`, nor `php -r` is matched. All three are returned as `false`
unconditionally, so any file write embedded in their inline scripts is invisible to the
hook.

## Reproducing failing test

File: `src/hooks/bash-write-policy.test.ts` (append)

```ts
import { test, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

test("denies perl -e with open write (inline bypass)", () => {
  expect(
    evaluateBashCommand(
      "perl -e 'open(my $fh, \">\", \"src/foo.ts\"); print $fh \"x\"; close $fh'",
    ).decision,
  ).toBe("deny");
});

test("denies ruby -e with File.write (inline bypass)", () => {
  expect(
    evaluateBashCommand(
      "ruby -e 'File.write(\"src/foo.ts\", \"x\")'",
    ).decision,
  ).toBe("deny");
});

test("denies php -r with file_put_contents (inline bypass)", () => {
  expect(
    evaluateBashCommand(
      "php -r 'file_put_contents(\"src/foo.ts\", \"x\");'",
    ).decision,
  ).toBe("deny");
});
```

**Expected (after fix):** `decision === "deny"` for all three
**Actual (current):** `decision === "allow"` for all three

## Suggested fix direction

Extend `matchesPythonNodeWrite` (or rename to `matchesInlineInterpreterWrite`) to cover:
- `perl -e` / `perl -E`: write patterns `open.*[">"]`, `print.*>`, `write` syscall wrappers
- `ruby -e`: `File.write`, `File.open.*"w"`, `IO.write`
- `php -r` / `php -B` / `php -R`: `file_put_contents`, `fwrite`, `fputs`

For each language, add an invocation regex (similar to `NODE_INVOCATION_RE`) and a
write-keyword regex (similar to `PYTHON_WRITE_RE`). Apply the same string-literal masking
approach used for python/node to avoid false positives on write keywords appearing only
inside string literals.

## Out of scope notes

`perl -pi` / `perl -i` (in-place edit flags) are already denied via `DENY_SUBSTRINGS`
and should not be double-denied. Only `perl -e` (script as argument, no `-i`) is the
gap. False-positive risk from `perl -e 'print "hello"'` should be zero if the write-
keyword regex is sufficiently specific.

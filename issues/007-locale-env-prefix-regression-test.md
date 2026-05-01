---
id: a1-07
category: security/bash-bypass
severity: HIGH
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] Missing regression test: locale env-var prefix `LC_ALL=... sed -i` has no test coverage

## Summary

`stripLeadingEnvAssignments` correctly handles single-quoted locale values such as
`LC_ALL='en_US.UTF-8'`, peeling the assignment to expose `sed -i 's/x/y/' src/foo.ts`
and triggering the deny. However, there is no test that pins this behavior. A future
refactor to `stripLeadingEnvAssignments` — e.g., changing the single-quote handling,
adding a new branch, or altering the name-character set — could silently regress this
protection without any failing test. Given that locale prefixes are a natural idiom
(`LC_ALL=C`, `LANG=en_US.UTF-8`, `LC_CTYPE=UTF-8`), this is a gap worth closing.

## Attack surface

- File:line: `src/hooks/bash-write-policy.ts:753-815` (`stripLeadingEnvAssignments`)

```typescript
function stripLeadingEnvAssignments(s: string): string {
  let i = 0;
  while (i < s.length) {
    // ...
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
      continue;
    }
    // ...
  }
  return "";
}
```

The single-quote branch at line 793-796 is the only code path that allows `LC_ALL='en_US.UTF-8'`
to be consumed as a value. No test asserts that this path executes correctly and produces
a deny outcome. If the branch is accidentally removed or broken, the env assignment would
not be fully consumed, `sed` would no longer be the resolved verb, and the command would
silently become `"allow"`.

## Reproducing failing test

The test below is written as the correct **regression guard**. It passes today (the deny
works) but will FAIL if a future change to `stripLeadingEnvAssignments` breaks locale-
prefix stripping. Additionally, a separate test asserts that `LC_ALL=C sed -i` (unquoted
simple value) is also denied, since that sub-path (no quotes at all) is also currently
untested.

File: `src/hooks/bash-write-policy.test.ts` (append)

```ts
import { test, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

// Regression: stripLeadingEnvAssignments must peel single-quoted locale values
// before the deny pattern fires on sed -i.
test("denies LC_ALL='en_US.UTF-8' sed -i (locale env-var prefix, single-quoted value)", () => {
  expect(
    evaluateBashCommand(
      "LC_ALL='en_US.UTF-8' sed -i 's/x/y/' src/foo.ts",
    ).decision,
  ).toBe("deny");
});

test("denies LC_ALL=C sed -i (locale env-var prefix, bare value)", () => {
  expect(
    evaluateBashCommand("LC_ALL=C sed -i 's/x/y/' src/foo.ts").decision,
  ).toBe("deny");
});

test("denies LANG=en_US.UTF-8 mv src/a.ts src/b.ts (multi-locale prefix before mv)", () => {
  expect(
    evaluateBashCommand("LANG=en_US.UTF-8 mv src/a.ts src/b.ts").decision,
  ).toBe("deny");
});
```

**Expected (after fix or regression):** all three `decision === "deny"`
**Actual (current):** all three already return `"deny"` — these are regression guards, not new fixes.

**NOTE:** The first two tests will PASS against current code. They serve as regression
guards. If a future patch to `stripLeadingEnvAssignments` breaks locale-value stripping,
the tests will FAIL, surfacing the regression immediately. File this as a test-coverage
gap, not a bypass.

## Suggested fix direction

Add the three tests above to the existing `"strips leading env assignments"` describe
block or a new `"locale env-var prefix"` block. No source code changes are needed.
The coverage gap is in the test suite, not the implementation.

## Out of scope notes

`LC_ALL=C.UTF-8` (no quotes, dotted value) would fail to strip because the `.` character
is not in the allowed name character set and the value stops at the dot. Investigate
whether `LC_ALL=C.UTF-8 sed -i` actually returns `"deny"` (it would not be stripped, so
the raw segment contains `LC_ALL=C.UTF-8 sed -i` and `DENY_SUBSTRINGS` scan on the full
normalized string would still catch `sed -i`). This edge case is worth a separate test.

---
id: a1-04
category: security/bash-bypass
severity: HIGH
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [SECURITY] `find -exec sed -i` bypasses deny patterns via unrecognized outer verb

## Summary

`find . -name "*.ts" -exec sed -i 's/x/y/' {} \;` runs `sed -i` on every matched file.
`find` is not in `DENY_VERBS` and not in `DENY_SUBSTRINGS`. `splitSegments` splits only
on `;`, `&&`, `||`, `|`, `\n`, and command substitutions (`$(…)` / `` `…` ``). The
`-exec … ;` block is not a shell segment separator, so `-exec sed -i` is never extracted
as a standalone segment and the `sed -i` substring match is never reached. The full
command returns `"allow"`.

## Attack surface

- File:line: `src/hooks/bash-write-policy.ts:279-293` (`splitSegments`) and `42-55` (`DENY_SUBSTRINGS`)

```typescript
function splitSegments(cmd: string): string[] {
  const main = primarySplitSegments(cmd);
  const result: string[] = [];
  for (const seg of main) {
    result.push(seg);
    for (const inner of extractSubstitutionInners(seg)) {
      for (const innerSeg of splitSegments(inner)) {
        result.push(innerSeg);
      }
    }
  }
  return result;
}
```

`-exec sed -i 's/x/y/' {} \;` is not a command substitution, so `extractSubstitutionInners`
never sees it. The `;` terminator of `-exec` is also consumed as a literal argument to
`find`, not as a shell segment boundary (it follows `\`).

## Reproducing failing test

File: `src/hooks/bash-write-policy.test.ts` (append)

```ts
import { test, expect } from "bun:test";
import { evaluateBashCommand } from "./bash-write-policy.js";

test("denies find -exec sed -i (exec bypass via outer find verb)", () => {
  expect(
    evaluateBashCommand(
      "find . -name '*.ts' -exec sed -i 's/x/y/' {} \\;",
    ).decision,
  ).toBe("deny");
});

test("denies find -exec cp (exec bypass via outer find verb)", () => {
  expect(
    evaluateBashCommand(
      "find src/ -name '*.ts' -exec cp {} /tmp/backup \\;",
    ).decision,
  ).toBe("deny");
});
```

**Expected (after fix):** `decision === "deny"`
**Actual (current):** `decision === "allow"`

## Suggested fix direction

Add `"find"` to a new `SCAN_INNER_VERBS` set (verbs that carry embedded commands in
positional args). After the normal segment scan, if the verb is `find`, extract the
content of every `-exec`/`-execdir` argument block (everything between `-exec`/`-execdir`
and the terminating `\;` or `+`) and re-evaluate each as a command segment. A simpler
but coarser fix is to add `"-exec "` and `"-execdir "` to `DENY_SUBSTRINGS` unconditionally,
which would catch all `find -exec` usages at the cost of blocking benign read-only
`-exec cat {}` forms. Recommend the targeted approach (extract and evaluate inner command).

## Out of scope notes

`find -exec cat {} \;` (read-only inner verb) should remain allowed. Any fix must
evaluate the inner command, not unconditionally block `-exec`. `find -delete` on a
non-protected path is also worth considering but is a separate issue.

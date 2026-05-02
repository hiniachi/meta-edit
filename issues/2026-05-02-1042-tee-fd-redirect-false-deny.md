---
id: a9-01
category: bug/hook-policy
severity: MEDIUM
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [BUG] `matchesDangerousTee` false-positive: fd-redirect tokens treated as write targets

## Summary

`matchesDangerousTee` in `src/hooks/bash-write-policy.ts` (lines ~1139–1161) incorrectly
denies commands like `tee /tmp/log 2>&1` because it classifies the fd-redirect token
`2>&1` as a repo write target.

The function tokenizes the segment on whitespace only (via `tokenizeSegment`), then
iterates tokens after the `tee` verb:

```typescript
for (; i < tokens.length; i++) {
  const tok = tokens[i]!;
  if (tok.startsWith("-")) continue;  // skip flags
  if (isInRepoWriteTarget(tok)) return true;
}
```

The token `"2>&1"` does not start with `"-"`, so the flag check does not skip it.
`isInRepoWriteTarget("2>&1")` returns `true` because the path does not start with `"/"`,
is not in `SAFE_EXACT_TARGETS`, and the function treats any relative-looking string as
an in-repo path.

The same false positive fires for any fd-redirect that appears in positional position:
`2>/dev/null` (relative `"2>"` prefix before `"/"` would normally be caught by absolute
check, but `"2>/dev/null"` is treated as a single token, not as redirect + path),
`>&2`, `1>file`, `3>&1`, etc.

Note: `iterRedirectTargets`, used elsewhere in the file, correctly handles `2>&1` by
checking `s[i+1] === "&"` and skipping. `matchesDangerousTee` does not use
`iterRedirectTargets` — it has its own ad-hoc token loop that lacks this logic.

## Attack surface / impact

- **Vector**: Legitimate shell pipelines that redirect stderr, e.g.
  `build 2>&1 | tee build.log`, are denied by the hook even when the tee target is
  outside the repo (e.g. `/tmp/build.log`).
- **Impact**: False positive — safe commands are blocked. The hook becomes
  overly restrictive, degrading usability. Engineers are incentivized to work around
  the hook rather than use it.
- **No security bypass**: the false positive is in the deny direction, not allow.

## Reproducing failing test

Add to `src/hooks/bash-write-policy.test.ts` in the `tee` section:

```typescript
it("allows tee writing to /tmp when stderr is redirected with 2>&1", () => {
  // "2>&1" is an fd-duplication operator, not a file path.
  // matchesDangerousTee must not treat it as a repo write target.
  //
  // FAILS on current code: evaluateBashCommand returns { decision: "deny" }
  // because "2>&1" passes isInRepoWriteTarget (relative-path fallback).
  expect(
    evaluateBashCommand("echo hi | tee /tmp/build.log 2>&1").decision,
  ).toBe("allow");
});

it("allows tee writing to /tmp when stderr is redirected with 2>/dev/null", () => {
  // "2>/dev/null" tokenizes as a single token; isInRepoWriteTarget sees it
  // as a relative path ("2>...") and wrongly returns true.
  //
  // FAILS on current code: evaluateBashCommand returns { decision: "deny" }.
  expect(
    evaluateBashCommand("npm test 2>/dev/null | tee /tmp/test.log").decision,
  ).toBe("allow");
});
```

Run with:

```
bun test src/hooks/bash-write-policy.test.ts
```

Both tests currently fail. The first returns `{ decision: "deny" }`, the second also
returns `{ decision: "deny" }`.

## Expected vs actual

| Command | Expected | Actual |
|---|---|---|
| `echo hi \| tee /tmp/build.log 2>&1` | `allow` (tee target is `/tmp/`, safe sink) | `deny` (false positive on `2>&1`) |
| `npm test 2>/dev/null \| tee /tmp/test.log` | `allow` (tee target is `/tmp/`, safe sink) | `deny` (false positive on `2>/dev/null` token) |
| `build \| tee ./out.txt 2>&1` | `deny` (tee target `./out.txt` is in-repo) | `deny` (correctly denied, but for wrong reason includes `2>&1`) |

## Suggested fix direction

Before calling `isInRepoWriteTarget(tok)`, skip tokens that look like fd-redirect
operators. A token is an fd-redirect if it matches `/^\d*>&?\d*/` or starts with `>&`
or `>` followed by a digit, or is an exact fd-duplication like `>&1`:

```typescript
// Skip fd-redirect tokens like "2>&1", ">&2", "1>", "2>/dev/null"
if (/^\d*>/.test(tok) || tok.startsWith(">&")) continue;
```

Alternatively, refactor `matchesDangerousTee` to use the existing `iterRedirectTargets`
generator, which already handles these cases correctly for other command patterns.

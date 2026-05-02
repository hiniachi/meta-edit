---
id: a9-02
category: security/hook-policy
severity: MEDIUM
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [BUG] `rsync` in `DENY_SUBSTRINGS` not hardened against Unicode whitespace separators

## Summary

`DENY_SUBSTRINGS` in `src/hooks/bash-write-policy.ts` (lines 65–67) contains:

```typescript
"rsync ",   // ASCII space only
"rsync\t",  // tab only
```

These two entries rely on literal substring matching via `scanText.includes(...)`.
A command like `rsync -a src/ dst/` (U+00A0 NON-BREAKING SPACE between verb and
first flag) is not matched by either substring and falls through to `DENY_VERBS`
detection. However, `"rsync"` is not in `DENY_VERBS`, so the command is allowed.

This is the same class of bypass that was fixed for `tee` (see issue #008). The commit
message for that fix noted that `tee` was moved from `DENY_SUBSTRINGS` to verb-based
detection specifically because Unicode whitespace separators bypassed literal matching.
`rsync` was not migrated at the same time.

`extractCommandVerb` uses `/\S+/` to find the verb token, which correctly extracts
`"rsync"` from `"rsync -a src/ dst/"` (U+00A0 is matched by `\S` when the verb
is isolated that way). But `extractCommandVerb` only returns the verb — it does not
interact with `DENY_VERBS` for `rsync` because `rsync` is not in that set.

Any Unicode whitespace character that is not ASCII space (U+0020) or tab (U+0009) can
be used to bypass the `rsync` entries: U+00A0 (non-breaking space), U+2009 (thin
space), U+3000 (ideographic space), U+000B (vertical tab), etc.

## Attack surface / impact

- **Vector**: An attacker-controlled or confused AI invokes
  `rsync -a --delete src/ /repo/dst/` to overwrite repo files, bypassing the hook
  because no substring or verb check fires.
- **Impact**: `rsync` can copy or overwrite arbitrary files. The `--delete` flag removes
  destination files not present in the source. This is a write-bypass in the security
  hook.
- **Severity**: MEDIUM — requires that the bypassing character appears in the command.
  In practice AI agents copy commands from documentation or generate them programmatically;
  Unicode whitespace can appear in either context.

## Reproducing failing test

Add to `src/hooks/bash-write-policy.test.ts` in the `rsync` section (or alongside the
existing Unicode whitespace tests):

```typescript
it("denies rsync with non-breaking space separator (U+00A0)", () => {
  // U+00A0 between "rsync" and "-a" bypasses both DENY_SUBSTRINGS entries
  // ("rsync " and "rsync\t"), which use literal substring matching.
  // rsync is not in DENY_VERBS, so it is incorrectly allowed.
  //
  // FAILS on current code: evaluateBashCommand returns { decision: "allow" }.
  expect(
    evaluateBashCommand("rsync -a src/ dst/").decision,
  ).toBe("deny");
});

it("denies rsync with thin space separator (U+2009)", () => {
  // Same bypass as above with U+2009 THIN SPACE.
  //
  // FAILS on current code: evaluateBashCommand returns { decision: "allow" }.
  expect(
    evaluateBashCommand("rsync --delete src/ /repo/target/").decision,
  ).toBe("deny");
});
```

Run with:

```
bun test src/hooks/bash-write-policy.test.ts
```

Both tests currently fail. Each returns `{ decision: "allow" }` when `"deny"` is expected.

## Expected vs actual

| Command | Expected | Actual |
|---|---|---|
| `"rsync -a src/ dst/"` | `deny` | `allow` (DENY_SUBSTRINGS miss; not in DENY_VERBS) |
| `"rsync --delete src/ /repo/"` | `deny` | `allow` (same path) |
| `"rsync -a src/ dst/"` (ASCII space) | `deny` | `deny` (correct — substring match fires) |

## Suggested fix direction

Move `rsync` detection from `DENY_SUBSTRINGS` to `DENY_VERBS`, following the same
pattern used when `tee` was fixed (issue #008):

```typescript
// Before (fragile):
export const DENY_SUBSTRINGS: readonly string[] = [
  ...
  "rsync ",
  "rsync\t",
];

// After (robust):
export const DENY_VERBS: readonly string[] = [
  ...existing verbs...,
  "rsync",
];
```

Then remove the two `"rsync "` / `"rsync\t"` entries from `DENY_SUBSTRINGS`.
`extractCommandVerb` already strips leading env assignments and handles Unicode
whitespace via `/\S+/`, so verb-based detection is immune to this bypass.

Also update `src/hooks/bash-write-policy.test.ts` to add Unicode whitespace coverage
for all entries remaining in `DENY_SUBSTRINGS` (e.g. `"cat >"`, `"git apply"`,
`"perl -pi"`) to prevent the same regression from appearing for them.

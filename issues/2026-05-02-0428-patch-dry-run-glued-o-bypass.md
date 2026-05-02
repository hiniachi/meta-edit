---
id: a9-01
category: security/bash-write-policy
severity: HIGH
affected_files:
  - src/hooks/bash-write-policy.ts
test_file: src/hooks/bash-write-policy.test.ts
---

# [BUG] `hasSafetyFlag` misses glued `-oFILE` form — `patch --dry-run -oFILE` allowed

## Summary

`hasSafetyFlag` in `src/hooks/bash-write-policy.ts` is supposed to withdraw the
`patch --dry-run` / `--check` safety carve-out when the command also specifies
`-o`/`--output` (which writes patched content to a file regardless of dry-run
mode). The detection regex requires whitespace, `=`, or end-of-string after `-o`:

```typescript
// src/hooks/bash-write-policy.ts lines 1627–1629
const hasOutput = /(?:^|\s)(?:-o(?:\s|=|$)|--output(?:\s|=|$))/.test(
  segment,
);
```

POSIX short-option grammar allows a glued argument where the option letter and
its value are concatenated without any separator: `-oFILE` is equivalent to
`-o FILE`. The regex does not match this form because after `-o` it requires
`\s`, `=`, or `$` — none of which are present in `-oFILE`.

Result: `patch --dry-run -osrc/new.ts < changes.diff` returns `{ decision:
"allow" }` instead of `{ decision: "deny" }`. An agent or user can write an
arbitrary in-repo file using `patch` while bypassing the bash-write hook.

## Reproducing failing tests

Add to `src/hooks/bash-write-policy.test.ts` in the
`"patch — hasSafetyFlag"` describe block (or equivalent):

```typescript
it("denies patch --dry-run -oFILE (glued short option)", () => {
  // POSIX allows -oFILE with no separator; the regex currently misses this.
  // This test FAILS on current code: decision is "allow".
  const r = evaluateBashCommand("patch --dry-run -osrc/new.ts < changes.diff");
  expect(r.decision).toBe("deny");
});

it("denies patch --check -oFILE (glued short option)", () => {
  // Same gap via --check variant.
  // This test FAILS on current code: decision is "allow".
  const r = evaluateBashCommand("patch --check -ofile.ts < changes.diff");
  expect(r.decision).toBe("deny");
});
```

Run with:

```
bun test src/hooks/bash-write-policy.test.ts
```

Both tests currently fail (return `"allow"`).

## Expected vs actual

| Command | Expected | Actual |
|---|---|---|
| `patch --dry-run -o src/new.ts < d.diff` | `deny` | `deny` ✓ |
| `patch --dry-run -osrc/new.ts < d.diff` | `deny` | `allow` ✗ |
| `patch --check -o file.ts < d.diff` | `deny` | `deny` ✓ |
| `patch --check -ofile.ts < d.diff` | `deny` | `allow` ✗ |

## Suggested fix direction

Change the `hasOutput` regex so `-o` followed by **any non-whitespace character**
also matches (the glued form):

```typescript
const hasOutput =
  /(?:^|\s)(?:-o(?:\S|\s|=|$)|--output(?:\s|=|$))/.test(segment);
```

Or more precisely — `-o` should match when followed by `=`, whitespace, end of
string, **or any non-whitespace character** (the glued value):

```typescript
const hasOutput =
  /(?:^|\s)(?:-o(?:[^\s]|\s|$)|--output(?:\s|=|$))/.test(segment);
```

The simplest correct form: after `-o` accept anything except the flag being
embedded inside a longer word (e.g., `--foo-output` shouldn't match):

```typescript
// -o followed by one char of value, or = or whitespace/end
const hasOutput =
  /(?:^|\s)(?:-o(?:=|\s|$|[^-\s])|-o[^\s]|--output(?:=|\s|$))/.test(segment);
```

The safest minimal fix is to replace `-o(?:\s|=|$)` with `-o(?:\s|=|$|\S)` — the
`\S` arm captures glued values:

```typescript
const hasOutput = /(?:^|\s)(?:-o(?:\s|=|\S)|--output(?:\s|=|$))/.test(segment);
```

This matches `-osrc/new.ts`, `-o=FILE`, `-o FILE`, and bare `-o` at end of
string (which would be unusual but valid as an empty output filename).

After the fix both new tests must pass, and the existing space-separated tests
(`patch --dry-run -o src/new.ts`) must still pass.

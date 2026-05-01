---
id: a5-01
category: security/validation
severity: HIGH
affected_files: [src/tools/common.ts, src/tools/apply.ts, src/tools/apply.test.ts]
test_file: src/tools/apply.test.ts
---

# [SECURITY] Missing regression test: TOCTOU symlink on non-existent leaf is rejected by apply-time re-check

## Summary

`common.ts` documents a deliberate TOCTOU window at `checkPathSafety` (lines 421–435): when
`target_file` does not exist on disk, `realpathOfDeepestExisting` resolves only the deepest
existing ancestor and re-attaches the missing tail lexically. A symlink could be placed at that
tail between validation and the write. The Phase 3 `applyChanges` contract is supposed to close
this window by re-realpathsing the target before every open/rename. However, **no test exercises
the specific pattern of a non-existent file path whose parent directory exists, where a symlink is
injected into the missing path after validation but before apply**. The existing
`apply.test.ts` symlink tests all cover files that already exist at validation time
(lines 148–203). The non-existent-leaf path diverges in `applyChanges` at line 112:
`fs.realpathSync(lexicalAbs)` throws `ENOENT`, causing the `apply-time canonicalization failed`
warning and an `applied: false` return. This is the correct behavior, but it is untested for the
TOCTOU scenario where the leaf is created as a symlink between calls.

## Attack surface

1. Attacker (or rogue tool call) submits a request with `target_file: "src/new-file.ts"` where
   `src/` exists but `new-file.ts` does not.
2. `validateRequest` lexically resolves `src/new-file.ts` as safe (inside repo, not protected).
3. Between validation and apply, attacker creates `src/new-file.ts -> /etc/passwd`.
4. `applyChanges` re-realpaths the target, but because the leaf now exists it resolves to
   `/etc/passwd`, which escapes the repo root — the containment check at line 121–129 of
   `apply.ts` fires and rejects. The file is **not** written.
5. The defect is that this protective behavior is unverified by a test: a future refactor
   could silently break the re-realpath path without a failing test to catch it.

## Reproducing failing test

Place in `src/tools/apply.test.ts`. The test currently **passes** (the apply-time re-check works)
but is missing — this is a regression-test gap that would fail if the re-realpath guard were
removed or weakened.

```typescript
it("rejects a symlink placed at a previously non-existent target after validation-time lexical resolution", () => {
  // Setup: parent dir exists, but the target file does not yet.
  // This replicates the TOCTOU documented in common.ts:421-435:
  // validateRequest would have accepted "src/new.ts" lexically because
  // realpathOfDeepestExisting resolves "src/" and re-attaches "new.ts".
  fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });

  const outsideFile = path.join(os.tmpdir(), `meta-edit-toctou-${Date.now()}.txt`);
  fs.writeFileSync(outsideFile, "outside\n", "utf8");

  try {
    // Simulate the race: inject symlink at the path after lexical validation
    // but before apply (here we just set it up before calling applyChanges,
    // which is the worst-case of the race window being already lost).
    fs.symlinkSync(outsideFile, path.join(tmpRoot, "src/new.ts"));

    const result = applyChanges(tmpRoot, [
      change("src/new.ts", "old\n", "new\n"),
    ]);

    // apply.ts re-realpaths the target at line 112; the symlink resolves to
    // outsideFile which is outside repoRoot, triggering the "escapes the
    // repository root" guard (lines 121-128 of apply.ts).
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) =>
            w.includes("escapes the repository root") ||
            w.includes("canonicalization failed") ||
            w.includes("differs from validated canonical"),
        ),
      ).toBe(true);
    }
    // The outside file must not have been modified.
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside\n");
  } finally {
    try { fs.unlinkSync(outsideFile); } catch { /* ignore */ }
  }
});
```

## Expected vs actual

**Expected:** `applyChanges` returns `{ applied: false }` with a warning citing path escape or
canonicalization failure when the target is a symlink to an outside-repo path.

**Actual (current behavior):** The behavior is correct — the apply-time re-realpath at
`apply.ts:112` (`fs.realpathSync(lexicalAbs)`) resolves the symlink and the containment check at
lines 121–129 rejects. **But there is no test covering this specific path**, so the protection
is invisible to the test suite. A future change to `applyChanges` that skips the re-realpath for
performance or "simplification" would pass all existing tests while reintroducing the vulnerability.

## Suggested fix direction

Add the test above to `src/tools/apply.test.ts`. No source code change is needed — the protection
already works. The test serves as a locked regression gate for the TOCTOU contract.

## Out of scope notes

Full closure of the TOCTOU window requires `openat(2)` with an fd-pinned parent directory, which
Node's `fs` API does not expose. This is acknowledged in `apply.ts:32-38`. The test above
validates the documented partial mitigation. Per CLAUDE.md §3, adding a kernel-level TOCTOU
mitigation is out of scope for MVP.

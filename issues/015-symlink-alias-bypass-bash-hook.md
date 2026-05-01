---
id: a4-01
category: security/protected-paths
severity: HIGH
affected_files:
  - src/state/protected-paths.ts
  - src/hooks/bash-write-policy.ts
test_file: src/state/protected-paths.test.ts
---

# [SECURITY] Symlink alias bypasses protected-path check at bash-hook layer

## Summary

`isProtectedPath` is a purely lexical function: it normalizes the string and
runs `startsWith` against the two protected prefixes. The bash hook's
`touchesProtectedPath` call (in `bash-write-policy.ts`) calls this function
directly on the shell-command text after only cosmetic normalization
(`collapsePathDoublings`, backslash-strip). No `realpath` resolution is
performed at the hook layer. Consequently, a symlink whose name does not start
with `.meta-edit/` gives a false `false` from `isProtectedPath`, and the bash
hook lets the command through.

Example attack:

```sh
ln -s .meta-edit link          # link → .meta-edit
cat foo > link/state/edits.jsonl   # NOT denied — "link/state/edits.jsonl"
                                    # fails all PROTECTED_PREFIXES startsWith checks
```

The path `link/state/edits.jsonl` does not start with `.meta-edit/state/` or
`.meta-edit/tmp/`, so `isProtectedPath` returns `false`. The bash hook emits
`decision: "allow"`, and the shell write corrupts the append-only edit log.

## Attack surface

- **Entry point**: any Bash command processed by `deny-bash-write-bypass` hook.
- **Affected call site**: `bash-write-policy.ts` line that calls
  `touchesProtectedPath(normalized)` — this is a string-match over the raw
  command text; it never calls `fs.realpathSync`.
- **Not affected**: `checkPathSafety` in `tools/common.ts` (uses
  `realpathOfDeepestExisting` before calling `isProtectedPath` on the
  canonical relative path).
- **Impact**: complete bypass of edit-log integrity protection via any
  user-chosen symlink name.

## Reproducing failing test

Add to `src/state/protected-paths.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isProtectedPath } from "./protected-paths.js";

// ---------------------------------------------------------------------------
// C1 — Symlink alias bypass
// ---------------------------------------------------------------------------
describe("isProtectedPath — symlink alias (C1)", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true for a path routed through a symlink that resolves to .meta-edit/state/", () => {
    // Create a temp dir that mirrors a repo layout
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-c1-"));
    const metaEditDir = path.join(tmpDir, ".meta-edit");
    const stateDir = path.join(metaEditDir, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    // Create a symlink: link -> .meta-edit
    const linkPath = path.join(tmpDir, "link");
    fs.symlinkSync(metaEditDir, linkPath);

    // The path as the bash hook would see it (repo-relative)
    const viaSymlink = "link/state/edits.jsonl";

    // Currently returns false — the symlink alias defeats the lexical guard.
    // This test documents the defect: the guard SHOULD return true (fail-closed)
    // when the path traverses a symlink that resolves into a protected prefix,
    // OR the bash hook must resolve realpath before calling isProtectedPath.
    expect(isProtectedPath(viaSymlink)).toBe(true);
  });
});
```

**Why this test currently fails**: `isProtectedPath("link/state/edits.jsonl")`
normalizes to `"link/state/edits.jsonl"`. Neither `norm.startsWith(".meta-edit/state/")` nor
`folded.startsWith(".meta-edit/state/")` is true. The function returns `false`.

## Expected vs actual

| | Value |
|---|---|
| **Expected** | `isProtectedPath("link/state/edits.jsonl")` → `true` (fail-closed) OR bash hook resolves realpath before the call |
| **Actual** | `isProtectedPath("link/state/edits.jsonl")` → `false` |

## Suggested fix direction

Two valid approaches (either is sufficient; belt-and-suspenders would apply both):

1. **Fix at the bash hook layer** (preferred for minimal blast radius): in
   `bash-write-policy.ts`, after extracting each path token from the command,
   call `fs.realpathSync` on `path.resolve(repoRoot, token)` (catching errors)
   and rerun `isProtectedPath` on the relative form of the resolved path. This
   is already the pattern in `checkPathSafety`.

2. **Fix at `isProtectedPath`** (broader coverage): accept an optional
   `{ repoRoot: string }` second parameter; when provided, attempt realpath
   resolution and run the prefix check on the canonical relative path. Falls
   back to lexical-only when `repoRoot` is absent (preserving pure-function
   behaviour for callers that operate without a repo root).

Do **not** make `isProtectedPath` perform filesystem access unconditionally —
it is also called from pure-validation paths (unit tests, schema checks) where
no filesystem is available.

## Out of scope notes

- Auto-detection of symlink presence in the repo tree is out of scope for MVP
  (SPEC.md §11).
- The TOCTOU race already noted in `checkPathSafety` is a separate, pre-existing
  issue documented in the source comments; this issue is about the bash-hook
  layer, not the tool-handler layer.

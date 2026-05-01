---
id: a6-04
category: security/audit-log
severity: MEDIUM
affected_files: [src/state/edit-log.ts]
test_file: src/state/edit-log.test.ts
---

# [SECURITY] `.meta-edit/state/` directory created with world-readable mode (0755)

## Summary

`append()` at `src/state/edit-log.ts:76` creates the state directory with
`fs.mkdirSync(this.statePath, { recursive: true })`.  No `mode` option is
passed, so Node.js uses the default `0o777` masked by the process umask.
On a typical Linux system the effective mode is `0o755`
(world-readable + world-executable).

The log file itself is correctly created with mode `0600` (line 98), so
unprivileged users cannot read its contents directly.  However, a
world-readable directory allows any local user to:

- **Enumerate** that `.meta-edit/state/` exists (confirming the tool is
  active in this repo).
- **Stat** `edits.jsonl` to learn its size, inode, mtime, and number of
  hardlinks — metadata that leaks timing and activity patterns without
  reading the file.
- **Watch** the directory with `inotify` to observe when new log entries are
  written, leaking the rate and timing of edit operations.

On shared developer machines (CI runners, pair-programming environments,
corporate workstations) other local users are a realistic threat.

## Affected code

```typescript
// edit-log.ts:76
fs.mkdirSync(this.statePath, { recursive: true });
// No mode specified → inherits 0o777 & ~umask → typically 0o755
```

Compare with the file open at lines 91-99:
```typescript
fd = fs.openSync(
  this.logPath,
  fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | O_NOFOLLOW,
  0o600,   // ← file is correctly restricted
);
```

The directory is not similarly restricted.

## Reproducing failing test

This test is expected to **FAIL** on a default-umask Linux/macOS system.

```typescript
// Add inside describe("EditLog.append / readAll", ...) in edit-log.test.ts

it("state directory is created with mode 0700 (not world-readable)", () => {
  // Platform guard: permission bits are meaningful on POSIX systems only.
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return; // skip on Windows
  }

  const log = new EditLog(tmpRoot);
  log.append({
    edit_id: "edit_20260430_0001",
    timestamp: "2026-04-30T10:00:00+09:00",
    tool_name: "edit_refactor_only",
    target_file: "src/foo.ts",
    rationale: "mode check",
    risk_level: "low",
    test_files: [],
    patch_size_bytes: 1,
    applied: true,
    warnings: [],
  });

  const statePath = path.join(tmpRoot, ".meta-edit", "state");
  const stat = fs.statSync(statePath);
  // Mask to the permission bits only (strip file-type bits).
  const mode = stat.mode & 0o777;

  // The directory must not be readable or traversable by "other".
  // 0o007 covers o+r, o+w, o+x.
  expect(mode & 0o007).toBe(0);

  // Also verify group bits are restricted (0o070 covers g+r, g+w, g+x).
  // At minimum, group should not be writable.
  expect(mode & 0o020).toBe(0); // no g+w

  // Log the actual mode for diagnostics.
  const octal = mode.toString(8).padStart(3, "0");
  if (mode & 0o007) {
    throw new Error(
      `state directory mode 0o${octal} is world-readable; expected 0o700 or 0o750`,
    );
  }
});
```

**Why the test fails today:** `mkdirSync` with no `mode` on a system with
`umask 0022` creates the directory at `0o755`.  The assertion
`(mode & 0o007) === 0` evaluates to `(0o755 & 0o007) === 0o005 !== 0` and
the test fails.

## Expected vs actual

**Expected:** `.meta-edit/state/` is created at mode `0700` (owner-only
read/write/execute); no other users can list or stat the directory.

**Actual:** `.meta-edit/state/` is created at `0o777 & ~umask`, typically
`0o755`, making it world-readable and world-traversable.

## Suggested fix direction

Pass an explicit `mode` to `mkdirSync`:

```typescript
// edit-log.ts:76 — proposed fix
fs.mkdirSync(this.statePath, { recursive: true, mode: 0o700 });
```

Note: `{ recursive: true }` with an explicit `mode` sets the mode on all
**newly** created directories.  If `.meta-edit/` already exists at a wider
mode, its permissions are not narrowed by this call — that is acceptable for
MVP since the parent is created by the same code path on first use.

Also ensure the `.meta-edit/` parent itself is created at `0o700` if this
code is responsible for creating it (depends on whether it exists before
`statePath` is created).  The `recursive: true` option will apply `mode` to
all newly created ancestors.

## Out of scope notes

Retroactively `chmod`-ing an existing `.meta-edit/state/` directory at
startup (to repair repos initialised with the old wide-open mode) is a
separate concern and is not required for the fix.  A note in the changelog
advising users to run `chmod 700 .meta-edit/state` is sufficient for
existing deployments.

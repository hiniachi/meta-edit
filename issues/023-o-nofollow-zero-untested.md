---
id: a6-02
category: security/audit-log
severity: MEDIUM
affected_files: [src/state/edit-log.ts]
test_file: src/state/edit-log.test.ts
---

# [SECURITY] `O_NOFOLLOW === 0` fail-closed path is untestable without dependency injection

## Summary

`append()` contains an explicit fail-closed guard at lines 83-88 of
`src/state/edit-log.ts`:

```typescript
// edit-log.ts:83-88
const O_NOFOLLOW = fs.constants.O_NOFOLLOW;
if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
  throw new Error(
    "this platform does not expose O_NOFOLLOW; meta-edit refuses to append to the edit log without symlink-leaf protection",
  );
}
```

On Linux, `fs.constants.O_NOFOLLOW` is `131072` (non-zero), so this branch
is **structurally unreachable** in the current test suite.  The branch cannot
be exercised without either:

1. Running on a platform where `O_NOFOLLOW` is absent (impossible to simulate
   portably), or
2. Mocking `fs.constants.O_NOFOLLOW = 0` before the module resolves the
   constant — which is blocked by the fact that the constant is read
   **inside** `append()` on every call, but `fs.constants` is a live object
   reference, so `Object.defineProperty` could work in theory (see below).

The consequence is that the security guarantee "meta-edit refuses to run on
platforms lacking O_NOFOLLOW" is untested.  If the guard were accidentally
deleted (e.g. during a refactor), no test would fail.

## Attack surface

Without O_NOFOLLOW, the final `fs.openSync` call would silently follow a
symlink that replaces `edits.jsonl` between the pre-open `ensureNoSymlinkOnPath`
check and the `open` syscall (a TOCTOU race).  An attacker with write access
to the `.meta-edit/state/` directory could win this race and redirect log
writes to an arbitrary file.

The guard is the last line of defence after the two `ensureNoSymlinkOnPath`
calls.  It must be tested.

## Reproducing failing test

### Option A — `Object.defineProperty` mock (viable in bun:test, no DI needed)

`fs.constants` is a plain object; its properties are configurable.  We can
override `O_NOFOLLOW` for the duration of the test:

```typescript
// Add inside describe("EditLog.append symlink defense", ...) in edit-log.test.ts

it("throws a descriptive error when O_NOFOLLOW is 0 (platform lacks support)", () => {
  // Save original value.
  const original = fs.constants.O_NOFOLLOW;

  try {
    // Override: pretend the platform reports O_NOFOLLOW = 0.
    Object.defineProperty(fs.constants, "O_NOFOLLOW", {
      value: 0,
      configurable: true,
      writable: true,
    });

    const log = new EditLog(tmpRoot);
    expect(() => log.append(entry())).toThrow(
      /this platform does not expose O_NOFOLLOW/,
    );
  } finally {
    // Restore unconditionally to avoid poisoning other tests.
    Object.defineProperty(fs.constants, "O_NOFOLLOW", {
      value: original,
      configurable: true,
      writable: true,
    });
  }
});

it("throws a descriptive error when O_NOFOLLOW is non-numeric (platform lacks support)", () => {
  const original = fs.constants.O_NOFOLLOW;
  const originalDescriptor = Object.getOwnPropertyDescriptor(fs.constants, "O_NOFOLLOW");

  try {
    Object.defineProperty(fs.constants, "O_NOFOLLOW", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const log = new EditLog(tmpRoot);
    expect(() => log.append(entry())).toThrow(
      /this platform does not expose O_NOFOLLOW/,
    );
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(fs.constants, "O_NOFOLLOW", originalDescriptor);
    } else {
      Object.defineProperty(fs.constants, "O_NOFOLLOW", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  }
});
```

### Option B — Dependency injection refactor (if Option A is not viable)

If `fs.constants` turns out to be non-configurable in a future Bun/Node
version, a minimal DI refactor makes the path testable without any mocking:

```typescript
// Proposed change to edit-log.ts:
export class EditLog {
  // Injected for testing; defaults to the real platform constant.
  private readonly _O_NOFOLLOW: number | undefined;

  constructor(
    repoRoot: string,
    opts: { _O_NOFOLLOW?: number } = {},
  ) {
    this.statePath = path.join(repoRoot, ".meta-edit", "state");
    this.logPath   = path.join(this.statePath, "edits.jsonl");
    this._O_NOFOLLOW = opts._O_NOFOLLOW ?? fs.constants.O_NOFOLLOW;
    // ...
  }

  append(entry: EditLogEntry): void {
    // ...
    const O_NOFOLLOW = this._O_NOFOLLOW;
    if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
      throw new Error("this platform does not expose O_NOFOLLOW; ...");
    }
    // ...
  }
}
```

Test with DI:

```typescript
it("throws when injected O_NOFOLLOW is 0", () => {
  const log = new EditLog(tmpRoot, { _O_NOFOLLOW: 0 });
  expect(() => log.append(entry())).toThrow(/O_NOFOLLOW/);
});
```

## Expected vs actual

**Expected:** `append()` throws with a message matching
`/this platform does not expose O_NOFOLLOW/` when `fs.constants.O_NOFOLLOW`
is `0` or not a number.

**Actual:** The branch is unreachable in all current tests; its deletion would
go unnoticed.

## Suggested fix direction

Prefer **Option A** (no production change needed).  Only fall back to
Option B if `Object.defineProperty` on `fs.constants` proves non-configurable
under the project's runtime.  In either case, the two new test cases above
cover both the `=== 0` and `typeof !== "number"` sub-conditions.

## Out of scope notes

Platform-level enforcement (refusing to install on platforms without
`O_NOFOLLOW`) is out of scope for MVP.  The test only verifies that the
existing runtime guard behaves correctly.

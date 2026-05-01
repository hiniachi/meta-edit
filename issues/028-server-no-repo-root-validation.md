---
id: a7-03
category: bug/server
severity: HIGH
affected_files:
  - src/server.ts
test_file: src/server.test.ts (NEW)
---

# [BUG] `createServer` accepts any directory as `repoRoot` without checking for a repo sentinel

## Summary

`createServer` in `src/server.ts` accepts whatever `process.cwd()` (or the
caller-supplied `options.repoRoot`) returns, with no check that the directory
is actually a repository:

```typescript
// src/server.ts line 17
export function createServer(options: CreateServerOptions = {}): Server {
  const repoRoot = options.repoRoot ?? process.cwd();   // no validation
  const context: ValidationContext = { repoRoot };
  const log = new EditLog(repoRoot);
  ...
}
```

If an operator accidentally launches `meta-edit serve` from `/tmp`, `/home`,
or any non-project directory, the server silently treats that directory as the
repository root.  Every subsequent edit-tool call resolves file paths relative
to that directory, and the path-safety check in `validateRequest` considers
those paths valid (they are inside the declared root).  The audit log is also
written there (`.meta-edit/state/edits.jsonl`), polluting arbitrary
directories.

## Attack surface

- **Vector**: `meta-edit serve` invoked from a misconfigured working directory
  (misconfigured shell, systemd unit without `WorkingDirectory=`, Docker image
  without `WORKDIR`).
- **Impact**: an AI agent operating through the server could read and write
  files anywhere under the unexpected root.  If the root is `/`, the entire
  filesystem becomes the edit target.  Audit logs appear in unexpected
  locations.
- **Severity**: HIGH — the consequence of silent acceptance is unconstrained
  file-write scope for the MCP server.

## Reproducing failing test

Create `src/server.test.ts` (NEW):

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer } from "../server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmpDir(suffix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `meta-edit-srv-${suffix}-`));
}

// A directory that looks like a git repo (has a .git sentinel).
function mkGitRepo(): string {
  const dir = mkTmpDir("repo");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

// A directory with no repo sentinel.
function mkBareDir(): string {
  return mkTmpDir("bare");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createServer repoRoot validation", () => {
  let gitRepo: string;
  let bareDir: string;

  beforeAll(() => {
    gitRepo = mkGitRepo();
    bareDir = mkBareDir();
  });

  afterAll(() => {
    fs.rmSync(gitRepo, { recursive: true, force: true });
    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it("succeeds when repoRoot contains a .git directory", () => {
    // Should not throw.
    expect(() => createServer({ repoRoot: gitRepo })).not.toThrow();
  });

  it("throws a descriptive error when repoRoot has no repo sentinel", () => {
    // CURRENTLY FAILS: createServer silently accepts any directory.
    // The expected behaviour after the fix is to throw with a message
    // mentioning the missing sentinel and the supplied path.
    expect(() => createServer({ repoRoot: bareDir })).toThrow(
      /not a (git )?repository|no \.git|repo sentinel/i,
    );
  });

  it("throws when repoRoot is a system directory like /tmp", () => {
    // /tmp exists but is not a repository.
    expect(() => createServer({ repoRoot: os.tmpdir() })).toThrow(
      /not a (git )?repository|no \.git|repo sentinel/i,
    );
  });
});
```

**The second and third tests currently fail** because `createServer` performs
no sentinel check and returns a fully functional `Server` object regardless of
the directory.

## Expected vs actual

| Scenario | Expected | Actual |
|---|---|---|
| `createServer({ repoRoot: "/tmp" })` | throws with clear message | returns a Server silently |
| `createServer({ repoRoot: "<git repo>" })` | succeeds | succeeds (ok) |

## Suggested fix direction

Add a sentinel check inside `createServer` before constructing anything:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

function assertIsRepo(dir: string): void {
  const sentinels = [".git", ".jj"];
  const found = sentinels.some((s) =>
    fs.existsSync(path.join(dir, s))
  );
  if (!found) {
    throw new Error(
      `meta-edit: "${dir}" does not appear to be a repository root ` +
      `(no .git or .jj directory found). ` +
      `Start the server from the repository root or pass --repo-root.`,
    );
  }
}

export function createServer(options: CreateServerOptions = {}): Server {
  const repoRoot = options.repoRoot ?? process.cwd();
  assertIsRepo(repoRoot);          // <-- new guard
  ...
}
```

The check is intentionally shallow (existence of `.git`/`.jj`) and does not
validate full git integrity, which is out of scope for MVP.

## Out of scope notes

Full git repository validation (e.g., checking `git rev-parse --git-dir`) is
out of scope per `SPEC.md` §3.  The sentinel check is the minimum guard needed
to prevent silent misconfiguration.  Tracking alternative VCS sentinels (`.hg`,
`.svn`) is also out of scope for MVP.

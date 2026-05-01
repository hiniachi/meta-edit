---
id: a7-02
category: bug/cli
severity: MEDIUM
affected_files:
  - src/cli.ts
test_file: src/cli/cli.test.ts (NEW)
---

# [BUG] `cli.ts` unknown-subcommand path is untested; `main` not callable from tests

## Summary

`src/cli.ts` contains a `main(argv)` function that is never exported — the
module only calls `main(process.argv)` at the bottom.  This makes the function
impossible to import in a test without spawning a subprocess.  The
unknown-subcommand branch (which returns exit code 64) is therefore entirely
uncovered.  If a future change inadvertently alters the exit code or the error
message, no test will catch the regression.

Relevant lines in `src/cli.ts`:

```typescript
// line 12
async function main(argv: string[]): Promise<number> {
  ...
  default:
    err.write(`meta-edit: unknown subcommand "${subcommand}"\n`);
    printHelp();
    return 64;           // line 82
  }
}

// line 105 — module-level call; main is never exported
main(process.argv).then(
  (code) => { process.exit(code); },
  (err)  => { console.error(err); process.exit(1); },
);
```

## Attack surface

Not a security issue.  The risk is correctness: a caller relying on exit code
64 (standard Unix `EX_USAGE`) for scripting would silently break if the code
changed to 1 or 0.

## Reproducing failing test

The test cannot even be written without a refactor because `main` is not
exported.  The test file therefore pins **both** the missing export (import
will fail) **and** the exit-code contract.

Create `src/cli/cli.test.ts` (NEW):

```typescript
import { describe, it, expect } from "bun:test";
import * as childProcess from "node:child_process";
import * as path from "node:path";

// Path to the compiled CLI entry point.  Adjust if dist layout changes.
const CLI_SCRIPT = path.resolve(
  import.meta.dirname ?? __dirname,
  "../../dist/cli.js",
);

// ---------------------------------------------------------------------------
// Subprocess helper — avoids importing cli.ts directly (main is not exported)
// ---------------------------------------------------------------------------

function runCli(args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(
      process.execPath, // node / bun
      [CLI_SCRIPT, ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cli unknown subcommand", () => {
  it("exits with code 64 (EX_USAGE)", async () => {
    const { code } = await runCli(["bogus"]);
    // FAILS today if dist/cli.js does not exist or main is not exported.
    // The expected value pins the Unix EX_USAGE contract.
    expect(code).toBe(64);
  });

  it("writes a useful error to stderr", async () => {
    const { stderr } = await runCli(["bogus"]);
    expect(stderr).toContain("unknown subcommand");
    expect(stderr).toContain("bogus");
  });

  it("includes help text when the subcommand is unknown", async () => {
    const { stdout } = await runCli(["bogus"]);
    expect(stdout).toContain("Usage:");
  });
});
```

> **Note**: The subprocess approach works even before `main` is exported, but
> it depends on a built artifact.  The preferred fix below makes `main`
> importable so a faster in-process test can replace the subprocess test.

## Expected vs actual

| Scenario | Expected | Actual |
|---|---|---|
| `meta-edit bogus` exit code | 64 | (uncovered — could be changed silently) |
| `main` importable from test | yes | no — not exported |
| stderr message | contains `"unknown subcommand"` and the bad subcommand | (uncovered) |

## Suggested fix direction

1. Export `main` from `src/cli.ts`:
   ```typescript
   export async function main(argv: string[]): Promise<number> { ... }
   ```
2. Move the module-level call into a guard:
   ```typescript
   if (import.meta.url === `file://${process.argv[1]}`) {
     main(process.argv).then(
       (code) => process.exit(code),
       (err)  => { console.error(err); process.exit(1); },
     );
   }
   ```
3. Replace the subprocess test with an in-process test that passes mock
   `argv`, `stdout`, and `stderr` streams — matching the pattern used in
   `log-cmd.test.ts` and `summary-cmd.test.ts`.

## Out of scope notes

Testing the `serve` subcommand (which starts a long-lived MCP server) is out of
scope for this issue.  Cover only the argument-parsing and error-exit paths.

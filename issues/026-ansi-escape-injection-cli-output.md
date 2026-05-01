---
id: a7-01
category: security/cli-output
severity: HIGH
affected_files:
  - src/cli/log-cmd.ts
  - src/cli/summary-cmd.ts
test_file: src/cli/log-cmd.test.ts
---

# [SECURITY] ANSI escape injection in `meta-edit log` and `meta-edit summary` output

## Summary

`runLogCommand` writes entries directly via `JSON.stringify(e) + "\n"` and
`runSummaryCommand` builds its text table from raw entry fields (e.g.,
`target_file`, `tool_name`) without stripping ANSI escape sequences.  When a
rationale, tool name, or file path contains control sequences such as
`\x1b[2J` (clear screen) or `\x1b]0;TITLE\x07` (OSC title injection), any
terminal that renders the output executes those sequences.  An attacker who can
cause an audit entry to be appended — e.g., by sending a crafted MCP request —
can manipulate the operator's terminal session when they run `meta-edit log` or
`meta-edit summary`.

## Attack surface

- **Vector**: malicious `rationale` or `target_file` value in an edit-tool
  call whose log entry is later displayed by the CLI.
- **Impact**: clear-screen, fake status lines, OSC title injection, cursor
  repositioning, or (on misconfigured terminals) arbitrary command injection
  via DECSET `\x1b[?1049h` / bracketed-paste manipulation.
- **Who is affected**: any operator who pipes `meta-edit log` into a terminal.

## Reproducing failing test

Add to (or create alongside) `src/cli/log-cmd.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLogCommand } from "./log-cmd.js";
import { EditLog } from "../state/edit-log.js";
import type { EditLogEntry } from "../state/edit-log.js";

// Helpers ----------------------------------------------------------------

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-ansi-"));
  fs.mkdirSync(path.join(dir, ".meta-edit", "state"), { recursive: true });
  return dir;
}

function poisonEntry(repoRoot: string, rationale: string): void {
  const e: EditLogEntry = {
    edit_id: "edit_20260501_0001",
    timestamp: "2026-05-01T12:00:00+09:00",
    tool_name: "edit_boundary_condition",
    target_file: "src/foo.ts",
    rationale,
    risk_level: "medium",
    test_files: ["tests/foo.test.ts"],
    patch_size_bytes: 42,
    applied: true,
    warnings: [],
  };
  const log = new EditLog(repoRoot);
  log.append(e);
}

function captureLogOutput(repoRoot: string): string {
  const chunks: string[] = [];
  const out = {
    write(chunk: string) { chunks.push(chunk); return true; },
  } as unknown as NodeJS.WritableStream;
  const err = {
    write(_chunk: string) { return true; },
  } as unknown as NodeJS.WritableStream;
  runLogCommand({ repoRoot, filters: {}, out, err });
  return chunks.join("");
}

// Tests ------------------------------------------------------------------

describe("ANSI escape injection — runLogCommand", () => {
  it("does NOT emit raw ANSI escape sequences from rationale", () => {
    const repoRoot = tmpRepo();
    try {
      // Rationale containing a colour-reset sequence and a clear-screen
      poisonEntry(repoRoot, "\x1b[31mFAKE_ERROR\x1b[0m");
      const output = captureLogOutput(repoRoot);
      // Raw ESC byte must not appear in stdout
      expect(output).not.toContain("\x1b");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does NOT emit OSC title injection from target_file", () => {
    const repoRoot = tmpRepo();
    try {
      const logPath = path.join(repoRoot, ".meta-edit", "state", "edits.jsonl");
      const e: EditLogEntry = {
        edit_id: "edit_20260501_0002",
        timestamp: "2026-05-01T12:00:00+09:00",
        tool_name: "edit_boundary_condition",
        target_file: "\x1b]0;INJECTED_TITLE\x07",
        rationale: "normal rationale",
        risk_level: "low",
        test_files: [],
        patch_size_bytes: 10,
        applied: true,
        warnings: [],
      };
      fs.appendFileSync(logPath, JSON.stringify(e) + "\n");
      const output = captureLogOutput(repoRoot);
      expect(output).not.toContain("\x1b");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
```

And a parallel section in (or alongside) `src/cli/summary-cmd.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSummaryCommand } from "./summary-cmd.js";
import { EditLog } from "../state/edit-log.js";
import type { EditLogEntry } from "../state/edit-log.js";

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-ansi-sum-"));
  fs.mkdirSync(path.join(dir, ".meta-edit", "state"), { recursive: true });
  return dir;
}

describe("ANSI escape injection — runSummaryCommand", () => {
  it("does NOT emit raw ANSI escape sequences from target_file in summary table", () => {
    const repoRoot = tmpRepo();
    try {
      const logPath = path.join(repoRoot, ".meta-edit", "state", "edits.jsonl");
      const e: EditLogEntry = {
        edit_id: "edit_20260501_0003",
        timestamp: "2026-05-01T12:00:00+09:00",
        tool_name: "edit_boundary_condition",
        target_file: "\x1b[2Jsrc/evil.ts",
        rationale: "\x1b[31mFAKE_ERROR\x1b[0m",
        risk_level: "high",
        test_files: ["tests/evil.test.ts"],
        patch_size_bytes: 99,
        applied: true,
        warnings: [],
      };
      fs.appendFileSync(logPath, JSON.stringify(e) + "\n");
      const chunks: string[] = [];
      const out = {
        write(chunk: string) { chunks.push(chunk); return true; },
      } as unknown as NodeJS.WritableStream;
      const err = {
        write(_chunk: string) { return true; },
      } as unknown as NodeJS.WritableStream;
      runSummaryCommand({ repoRoot, out, err });
      const output = chunks.join("");
      expect(output).not.toContain("\x1b");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
```

**These tests currently fail** because `runLogCommand` emits raw JSON (including
the escape sequences verbatim) and `formatSummary` interpolates `target_file`
directly into the text table at `summary-cmd.ts:80`.

## Expected vs actual

| | Expected | Actual |
|---|---|---|
| `runLogCommand` stdout | No raw `\x1b` bytes | Raw ESC bytes present |
| `runSummaryCommand` stdout | No raw `\x1b` bytes | Raw ESC bytes present |

## Suggested fix direction

1. Add a small helper `stripAnsi(s: string): string` that removes sequences
   matching `/\x1b(\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g`.
2. In `runLogCommand`, apply `stripAnsi` to all string fields before
   serialising (or sanitise after `JSON.stringify` by stripping bare ESC
   bytes: `output.replace(/\x1b/g, "\\x1b")`).
3. In `formatSummary` / `runSummaryCommand`, apply `stripAnsi` to
   `target_file` and `tool_name` before embedding in table rows.

The fix for `log` output is intentionally visible to a structured consumer:
prefer escaping (`\\x1b`) over stripping so the raw value survives in JSON for
non-terminal consumers who pipe `meta-edit log` into another tool.

## Out of scope notes

Sanitising ANSI in the edit log file itself (`.meta-edit/state/edits.jsonl`) is
out of scope; the log is the ground-truth audit record and must preserve the
original value.  Only the CLI display layer needs sanitisation.

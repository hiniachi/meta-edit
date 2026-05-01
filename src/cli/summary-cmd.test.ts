import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { formatSummary, parseSummaryArgs, runSummaryCommand } from "./summary-cmd.js";
import type { EditLogEntry } from "../state/edit-log.js";

function entry(overrides: Partial<EditLogEntry> = {}): EditLogEntry {
  return {
    edit_id: "edit_20260430_0001",
    timestamp: "2026-04-30T10:00:00+09:00",
    tool_name: "edit_boundary_condition",
    target_file: "src/foo.ts",
    rationale: "test",
    risk_level: "medium",
    test_files: ["tests/foo.test.ts"],
    patch_size_bytes: 42,
    applied: true,
    warnings: [],
    ...overrides,
  };
}

describe("formatSummary", () => {
  it("renders zero edits", () => {
    const text = formatSummary([], undefined);
    expect(text).toContain("Total edits: 0");
    expect(text).toContain("Applied successfully: 0");
    expect(text).toContain("Validation failures:  0");
    expect(text).toContain("(no edits yet)");
    // edit_policy_change is always shown even with zero count.
    expect(text).toContain("edit_policy_change");
  });

  it("counts applied vs failed", () => {
    const text = formatSummary(
      [
        entry({ applied: true }),
        entry({ applied: true }),
        entry({ applied: false }),
      ],
      undefined,
    );
    expect(text).toContain("Total edits: 3");
    expect(text).toContain("Applied successfully: 2");
    expect(text).toContain("Validation failures:  1");
  });

  it("aggregates by tool, risk, and target_file", () => {
    const text = formatSummary(
      [
        entry({ tool_name: "edit_boundary_condition", risk_level: "low", target_file: "src/a.ts" }),
        entry({ tool_name: "edit_boundary_condition", risk_level: "low", target_file: "src/a.ts" }),
        entry({ tool_name: "edit_permission_logic", risk_level: "critical", target_file: "src/b.ts" }),
      ],
      undefined,
    );
    expect(text).toContain("edit_boundary_condition");
    expect(text).toContain("edit_permission_logic");
    expect(text).toMatch(/low\s+2/);
    expect(text).toMatch(/critical\s+1/);
    expect(text).toMatch(/src\/a\.ts\s+2/);
    expect(text).toMatch(/src\/b\.ts\s+1/);
  });

  it("renders the since label when provided", () => {
    const text = formatSummary([], new Date("2026-04-30T00:00:00+09:00"));
    expect(text).toContain("since 2026-04-29T15:00:00.000Z");
  });
});

describe("parseSummaryArgs", () => {
  it("parses --since YYYY-MM-DD", () => {
    const r = parseSummaryArgs(["--since", "2026-04-30"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.since).toBeInstanceOf(Date);
    }
  });

  it("rejects unknown flag", () => {
    const r = parseSummaryArgs(["--bogus"]);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid date", () => {
    const r = parseSummaryArgs(["--since", "yesterday"]);
    expect(r.ok).toBe(false);
  });

  it("rejects rollover dates like 2026-02-31", () => {
    const r = parseSummaryArgs(["--since", "2026-02-31"]);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate --since flags", () => {
    const r = parseSummaryArgs(["--since", "2026-04-01", "--since", "2026-04-30"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("only appear once");
  });

  it("rejects extra positional args even after a valid --since", () => {
    const r = parseSummaryArgs(["--since", "2026-04-01", "stray-arg"]);
    expect(r.ok).toBe(false);
  });

  it("rejects ISO 8601 timestamps with rollover dates (2026-02-31T00:00:00Z)", () => {
    const r = parseSummaryArgs(["--since", "2026-02-31T00:00:00Z"]);
    expect(r.ok).toBe(false);
  });

  it("accepts a valid ISO 8601 timestamp", () => {
    const r = parseSummaryArgs(["--since", "2026-04-30T12:34:56Z"]);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// a7-01 — ANSI escape injection in `meta-edit summary` output
// ---------------------------------------------------------------------------

function tmpRepoForSummary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-ansi-sum-"));
  fs.mkdirSync(path.join(dir, ".meta-edit", "state"), { recursive: true });
  return dir;
}

describe("ANSI escape injection - runSummaryCommand", () => {
  it("does NOT emit raw ANSI escape sequences from target_file in summary table", () => {
    const repoRoot = tmpRepoForSummary();
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

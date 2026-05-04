import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { filterEntries, parseLogArgs, runLogCommand } from "./log-cmd.js";
import { EditLog, type IssuedEntry } from "../state/edit-log.js";
import type { EditLogEntry } from "../state/edit-log.js";
import { issued, makeTmpRoot, cleanTmpRoot } from "../test-helpers.js";

describe("filterEntries", () => {
  const all: EditLogEntry[] = [
    issued({ edit_id: "edit_20260428_0001", kind: "edit_boundary_condition", risk_level: "low",  ts: "2026-04-28T10:00:00+09:00" }),
    issued({ edit_id: "edit_20260429_0001", kind: "edit_permission_logic",   risk_level: "high", ts: "2026-04-29T10:00:00+09:00" }),
    issued({ edit_id: "edit_20260430_0001", kind: "edit_boundary_condition", risk_level: "high", ts: "2026-04-30T10:00:00+09:00" }),
  ];

  it("returns all when no filter is set", () => {
    expect(filterEntries(all, {}).length).toBe(3);
  });

  it("filters by tool", () => {
    const r = filterEntries(all, { tool: "edit_boundary_condition" });
    expect(r.length).toBe(2);
  });

  it("filters by risk", () => {
    const r = filterEntries(all, { risk: "high" });
    expect(r.length).toBe(2);
  });

  it("filters by since (inclusive)", () => {
    const r = filterEntries(all, { since: new Date("2026-04-29T00:00:00+09:00") });
    expect(r.length).toBe(2);
  });

  // Regression-guard for issue 2026-05-02-0428: pin the inclusive --since
  // boundary so a future change from `t < since` to `t <= since`
  // (exclusive) fails loudly. The existing inclusive test only covers
  // ts > since; this one covers ts === since exactly.
  it("keeps an entry whose ts is exactly equal to --since (inclusive boundary)", () => {
    const exactEntry = issued({
      edit_id: "edit_exact_0001",
      ts: "2026-04-29T00:00:00+09:00",
    });
    const r = filterEntries([exactEntry], {
      since: new Date("2026-04-29T00:00:00+09:00"),
    });
    expect(r.length).toBe(1);
    expect(r[0]?.edit_id).toBe("edit_exact_0001");
  });

  it("combines filters with AND", () => {
    const r = filterEntries(all, {
      tool: "edit_boundary_condition",
      risk: "high",
      since: new Date("2026-04-29T00:00:00+09:00"),
    });
    expect(r.length).toBe(1);
    expect(r[0]?.edit_id).toBe("edit_20260430_0001");
  });

  it("excludes consumed records when --tool is set (consumed has no kind)", () => {
    const mixed: EditLogEntry[] = [
      issued({ edit_id: "edit_20260430_0010", kind: "edit_boundary_condition" }),
      {
        edit_id: "edit_20260430_0010",
        ts: "2026-04-30T10:00:11+09:00",
        phase: "consumed",
        consuming_tool: "Edit",
      },
    ];
    const r = filterEntries(mixed, { tool: "edit_boundary_condition" });
    // Only the issued record carries `kind`; the consumed sibling drops out.
    expect(r.length).toBe(1);
    expect(r[0]?.phase).toBe("issued");
  });

  // Closes issue 2026-05-02-1041-invalid-timestamp-silently-dropped-by-since-filter.
  // filterEntries used to drop unparseable ts only when --since was set,
  // creating a count discrepancy between filtered and unfiltered views.
  // Now invalid ts is dropped unconditionally.
  it("drops entries with unparseable ts even without --since (inversion test)", () => {
    const bad = issued({ edit_id: "edit_bad_0001", ts: "not-a-date" });
    const r = filterEntries([bad], {});
    // OLD behavior: kept (length 1). NEW behavior: dropped (length 0).
    expect(r.length).toBe(0);
  });

  it("drops entries with unparseable ts when --since is set (existing path, now unified)", () => {
    const bad = issued({ edit_id: "edit_bad_0002", ts: "not-a-date" });
    const r = filterEntries([bad], {
      since: new Date("2026-04-29T00:00:00+09:00"),
    });
    expect(r.length).toBe(0);
  });

  it("keeps entries with valid ts regardless of --since (regression-free)", () => {
    const good = issued({ edit_id: "edit_good_0001", ts: "2026-04-30T10:00:00+09:00" });
    expect(filterEntries([good], {}).length).toBe(1);
    expect(filterEntries([good], { since: new Date("2026-04-29T00:00:00+09:00") }).length).toBe(1);
  });

  it("excludes non-issued records when --risk is set (only issued carries risk_level)", () => {
    const mixed: EditLogEntry[] = [
      issued({ edit_id: "edit_20260430_0020", risk_level: "high" }),
      {
        edit_id: "edit_20260430_0021",
        ts: "2026-04-30T10:01:00+09:00",
        phase: "rejected",
        kind: "edit_boundary_condition",
        target_file: "src/foo.ts",
        audit_error: "rationale must be non-empty",
      },
    ];
    const r = filterEntries(mixed, { risk: "high" });
    expect(r.length).toBe(1);
    expect(r[0]?.phase).toBe("issued");
  });
});

describe("parseLogArgs", () => {
  it("parses --tool / --risk / --since", () => {
    const r = parseLogArgs(["--tool", "edit_boundary_condition", "--risk", "high", "--since", "2026-04-29"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filters.tool).toBe("edit_boundary_condition");
      expect(r.filters.risk).toBe("high");
      expect(r.filters.since).toBeInstanceOf(Date);
    }
  });

  it("rejects an unknown flag", () => {
    const r = parseLogArgs(["--bogus"]);
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid risk level", () => {
    const r = parseLogArgs(["--risk", "extreme"]);
    expect(r.ok).toBe(false);
  });

  it("rejects an unparseable --since", () => {
    const r = parseLogArgs(["--since", "yesterday"]);
    expect(r.ok).toBe(false);
  });

  it("rejects rollover dates like 2026-04-31", () => {
    const r = parseLogArgs(["--since", "2026-04-31"]);
    expect(r.ok).toBe(false);
  });

  it("rejects month 13", () => {
    const r = parseLogArgs(["--since", "2026-13-01"]);
    expect(r.ok).toBe(false);
  });

  it("rejects ISO 8601 timestamps with rollover dates (2026-02-31T00:00:00Z)", () => {
    const r = parseLogArgs(["--since", "2026-02-31T00:00:00Z"]);
    expect(r.ok).toBe(false);
  });

  it("rejects ISO 8601 timestamps with month 13", () => {
    const r = parseLogArgs(["--since", "2026-13-01T00:00:00Z"]);
    expect(r.ok).toBe(false);
  });

  it("accepts a valid ISO 8601 timestamp", () => {
    const r = parseLogArgs(["--since", "2026-04-30T12:34:56Z"]);
    expect(r.ok).toBe(true);
  });

  // Closes issue 2026-05-02-1041-parse-log-args-duplicate-flags-silently-accepted.
  // Each flag may appear at most once, matching parseSummaryArgs's behavior.
  it("rejects duplicate --tool", () => {
    const r = parseLogArgs(["--tool", "edit_boundary_condition", "--tool", "edit_permission_logic"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--tool may only appear once/);
  });

  it("rejects duplicate --risk", () => {
    const r = parseLogArgs(["--risk", "low", "--risk", "high"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--risk may only appear once/);
  });

  it("rejects duplicate --since", () => {
    const r = parseLogArgs(["--since", "2026-04-29", "--since", "2026-04-30"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--since may only appear once/);
  });
});

// ---------------------------------------------------------------------------
// a7-01 — ANSI escape injection in `meta-edit log` output
// ---------------------------------------------------------------------------

function tmpRepo(): string {
  const dir = makeTmpRoot("ansi");
  fs.mkdirSync(path.join(dir, ".meta-edit", "state"), { recursive: true });
  return dir;
}

function poisonRationale(repoRoot: string, rationale: string): void {
  const e: IssuedEntry = issued({
    edit_id: "edit_20260501_0001",
    ts: "2026-05-01T12:00:00+09:00",
    rationale,
  });
  const log = new EditLog(repoRoot);
  log.appendIssued(e);
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

describe("ANSI escape injection - runLogCommand", () => {
  it("does NOT emit raw ANSI escape sequences from rationale", () => {
    const repoRoot = tmpRepo();
    try {
      poisonRationale(repoRoot, "\x1b[31mFAKE_ERROR\x1b[0m");
      const output = captureLogOutput(repoRoot);
      expect(output).not.toContain("\x1b");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does NOT emit OSC title injection from target_file", () => {
    const repoRoot = tmpRepo();
    try {
      const logPath = path.join(repoRoot, ".meta-edit", "state", "edits.jsonl");
      const e: IssuedEntry = issued({
        edit_id: "edit_20260501_0002",
        ts: "2026-05-01T12:00:00+09:00",
        target_file: "\x1b]0;INJECTED_TITLE\x07",
        rationale: "normal rationale",
        risk_level: "low",
        test_files: [],
      });
      fs.appendFileSync(logPath, JSON.stringify(e) + "\n");
      const output = captureLogOutput(repoRoot);
      expect(output).not.toContain("\x1b");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

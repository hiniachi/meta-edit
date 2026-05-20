import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { formatSummary, parseSummaryArgs, runSummaryCommand } from "./summary-cmd.js";
import type { EditLogEntry, IssuedEntry } from "../state/edit-log.js";
import {
  issued,
  consumed,
  rejected,
  makeTmpRoot,
  cleanTmpRoot,
} from "../test-helpers.js";

describe("formatSummary", () => {
  it("renders zero edits", () => {
    const text = formatSummary([], undefined);
    expect(text).toContain("Total declarations: 0");
    expect(text).toContain("Authorized (hook approved write): 0");
    expect(text).toContain("Rejected (validation failure): 0");
    expect(text).toContain("(no edits yet)");
    // edit_policy_change is always shown even with zero count.
    expect(text).toContain("edit_policy_change");
  });

  it("counts issued+consumed (applied), issued-only (abandoned), and rejected", () => {
    // 2 fully applied (issued + consumed pair), 1 abandoned (issued only),
    // 1 rejected.
    const entries: EditLogEntry[] = [
      issued({ edit_id: "edit_20260430_0001" }),
      consumed({ edit_id: "edit_20260430_0001" }),
      issued({ edit_id: "edit_20260430_0002" }),
      consumed({ edit_id: "edit_20260430_0002" }),
      issued({ edit_id: "edit_20260430_0003" }), // abandoned
      rejected({ edit_id: "edit_20260430_0099" }),
    ];
    const text = formatSummary(entries, undefined);
    // 3 issued + 1 rejected = 4 declarations.
    expect(text).toContain("Total declarations: 4");
    expect(text).toContain("Authorized (hook approved write): 2");
    expect(text).toContain("Abandoned (issued, never authorized): 1");
    expect(text).toContain("Rejected (validation failure): 1");
  });

  it("aggregates by tool, risk, and target_file (issued only)", () => {
    const entries: EditLogEntry[] = [
      issued({ edit_id: "edit_20260430_0001", kind: "edit_boundary_condition", risk_level: "low", target_file: "src/a.ts" }),
      issued({ edit_id: "edit_20260430_0002", kind: "edit_boundary_condition", risk_level: "low", target_file: "src/a.ts" }),
      issued({ edit_id: "edit_20260430_0003", kind: "edit_permission_logic", risk_level: "critical", target_file: "src/b.ts" }),
    ];
    const text = formatSummary(entries, undefined);
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

  it("splits each impl tool's count by prod/test target (v0.5.0)", () => {
    // The reshape's audit payoff: every impl kind shows its prod and
    // test edits side-by-side so a 1:1 production:test ratio is visible
    // in the summary without leaving the kind's row.
    const entries: EditLogEntry[] = [
      issued({ edit_id: "edit_20260430_0001", kind: "edit_boundary_condition", target: "prod", target_file: "src/a.ts" }),
      issued({ edit_id: "edit_20260430_0002", kind: "edit_boundary_condition", target: "prod", target_file: "src/b.ts" }),
      issued({ edit_id: "edit_20260430_0003", kind: "edit_boundary_condition", target: "test", target_file: "tests/a.test.ts" }),
    ];
    const text = formatSummary(entries, undefined);
    expect(text).toContain("By tool (prod / test counts shown for impl tools)");
    expect(text).toMatch(/edit_boundary_condition\s+3 \(prod 2 \/ test 1\)/);
  });

  it("omits prod/test split for edit_docs_only (no target field)", () => {
    const entries: EditLogEntry[] = [
      issued({
        edit_id: "edit_20260430_0001",
        kind: "edit_docs_only",
        target: undefined,
        target_file: "docs/a.md",
        test_files: [],
      }),
    ];
    const text = formatSummary(entries, undefined);
    // edit_docs_only row should be present but WITHOUT a "(prod X / test Y)"
    // segment — its row collapses to the legacy flat format.
    expect(text).toMatch(/edit_docs_only\s+1 {2}\(100%\)/);
    expect(text).not.toMatch(/edit_docs_only\s+\d+ \(prod/);
  });
});

// Closes issue 2026-05-02-1041-invalid-timestamp-silently-dropped-by-since-filter
// (summary-cmd half). Mirrors the log-cmd half: invalid ts dropped both with
// and without --since for consistent counts.
describe("runSummaryCommand — invalid timestamp handling", () => {
  it("drops entries with unparseable ts even without --since (inversion)", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-bad-ts-1-"));
    fs.mkdirSync(path.join(repoRoot, ".meta-edit", "state"), { recursive: true });
    try {
      const logPath = path.join(repoRoot, ".meta-edit", "state", "edits.jsonl");
      const bad: IssuedEntry = issued({ edit_id: "edit_bad_0010", ts: "not-a-date" });
      fs.appendFileSync(logPath, JSON.stringify(bad) + "\n");
      const chunks: string[] = [];
      const out = { write(c: string) { chunks.push(c); return true; } } as unknown as NodeJS.WritableStream;
      const err = { write(_c: string) { return true; } } as unknown as NodeJS.WritableStream;
      runSummaryCommand({ repoRoot, out, err });
      const output = chunks.join("");
      // Without the fix, the invalid-ts entry inflates Total declarations to 1.
      expect(output).toContain("Total declarations: 0");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("drops entries with unparseable ts when --since is set (existing path)", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-bad-ts-2-"));
    fs.mkdirSync(path.join(repoRoot, ".meta-edit", "state"), { recursive: true });
    try {
      const logPath = path.join(repoRoot, ".meta-edit", "state", "edits.jsonl");
      const bad: IssuedEntry = issued({ edit_id: "edit_bad_0011", ts: "not-a-date" });
      fs.appendFileSync(logPath, JSON.stringify(bad) + "\n");
      const chunks: string[] = [];
      const out = { write(c: string) { chunks.push(c); return true; } } as unknown as NodeJS.WritableStream;
      const err = { write(_c: string) { return true; } } as unknown as NodeJS.WritableStream;
      runSummaryCommand({ repoRoot, since: new Date("2026-01-01T00:00:00Z"), out, err });
      const output = chunks.join("");
      expect(output).toContain("Total declarations: 0");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
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
  const dir = makeTmpRoot("ansi-sum");
  fs.mkdirSync(path.join(dir, ".meta-edit", "state"), { recursive: true });
  return dir;
}

describe("ANSI escape injection - runSummaryCommand", () => {
  it("does NOT emit raw ANSI escape sequences from target_file in summary table", () => {
    const repoRoot = tmpRepoForSummary();
    try {
      const logPath = path.join(repoRoot, ".meta-edit", "state", "edits.jsonl");
      const e: IssuedEntry = issued({
        edit_id: "edit_20260501_0003",
        ts: "2026-05-01T12:00:00+09:00",
        target_file: "\x1b[2Jsrc/evil.ts",
        rationale: "\x1b[31mFAKE_ERROR\x1b[0m",
        risk_level: "high",
        test_files: ["tests/evil.test.ts"],
      });
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

  // Closes issue 2026-05-01-0912-strip-ansi-st-osc-content-leak.
  // Regression-guard for the ST-terminator branch of stripAnsi's OSC
  // alternative. Old code only handled BEL-terminated OSC (\x1b]...\x07);
  // ST-terminated OSC (\x1b]...\x1b\\) fell through the bare-ESC fallback
  // and leaked the content text. MC/DC: BEL path covered, ST path
  // covered, inversion test below would FAIL on the old regex.
  it("strips ST-terminated OSC content fully (no leak past inversion)", () => {
    const repoRoot = tmpRepoForSummary();
    try {
      const logPath = path.join(repoRoot, ".meta-edit", "state", "edits.jsonl");
      // ESC ] 0 ; INJECTED ESC \ src/leak.ts → old code leaks "0;INJECTED"
      const e: IssuedEntry = issued({
        edit_id: "edit_20260501_0004",
        ts: "2026-05-01T12:01:00+09:00",
        target_file: "\x1b]0;INJECTED\x1b\\src/leak.ts",
        risk_level: "low",
      });
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
      // Inversion: the OSC content "0;INJECTED" must NOT appear in output.
      // The bare path "src/leak.ts" must remain.
      expect(output).not.toContain("0;INJECTED");
      expect(output).not.toContain("\x1b");
      expect(output).toContain("src/leak.ts");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("strips BEL-terminated OSC (existing branch still works)", () => {
    const repoRoot = tmpRepoForSummary();
    try {
      const logPath = path.join(repoRoot, ".meta-edit", "state", "edits.jsonl");
      // ESC ] 0 ; TITLE BEL src/normal.ts → BEL terminator branch
      const e: IssuedEntry = issued({
        edit_id: "edit_20260501_0005",
        ts: "2026-05-01T12:02:00+09:00",
        target_file: "\x1b]0;TITLE\x07src/normal.ts",
        risk_level: "low",
      });
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
      expect(output).not.toContain("0;TITLE");
      expect(output).not.toContain("\x1b");
      expect(output).toContain("src/normal.ts");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

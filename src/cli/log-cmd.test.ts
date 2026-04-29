import { describe, it, expect } from "bun:test";
import { filterEntries, parseLogArgs } from "./log-cmd.js";
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

describe("filterEntries", () => {
  const all: EditLogEntry[] = [
    entry({ edit_id: "edit_20260428_0001", tool_name: "edit_boundary_condition", risk_level: "low",  timestamp: "2026-04-28T10:00:00+09:00" }),
    entry({ edit_id: "edit_20260429_0001", tool_name: "edit_permission_logic",   risk_level: "high", timestamp: "2026-04-29T10:00:00+09:00" }),
    entry({ edit_id: "edit_20260430_0001", tool_name: "edit_boundary_condition", risk_level: "high", timestamp: "2026-04-30T10:00:00+09:00" }),
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

  it("combines filters with AND", () => {
    const r = filterEntries(all, {
      tool: "edit_boundary_condition",
      risk: "high",
      since: new Date("2026-04-29T00:00:00+09:00"),
    });
    expect(r.length).toBe(1);
    expect(r[0]?.edit_id).toBe("edit_20260430_0001");
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
});

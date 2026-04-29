import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EditLog, isoTimestamp, type EditLogEntry } from "./edit-log.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-log-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

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

describe("EditLog.nextEditId", () => {
  it("starts at 0001 on a fresh log", () => {
    const log = new EditLog(tmpRoot);
    expect(log.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_0001");
  });

  it("increments sequentially within the same day", () => {
    const log = new EditLog(tmpRoot);
    const d = new Date(2026, 3, 30);
    expect(log.nextEditId(d)).toBe("edit_20260430_0001");
    expect(log.nextEditId(d)).toBe("edit_20260430_0002");
    expect(log.nextEditId(d)).toBe("edit_20260430_0003");
  });

  it("resets the counter when the day boundary changes", () => {
    const log = new EditLog(tmpRoot);
    expect(log.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_0001");
    expect(log.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_0002");
    expect(log.nextEditId(new Date(2026, 4, 1))).toBe("edit_20260501_0001");
  });

  it("recovers the counter from existing log entries on first call for a day", () => {
    const log1 = new EditLog(tmpRoot);
    const d = new Date(2026, 3, 30);
    log1.append(entry({ edit_id: log1.nextEditId(d) }));
    log1.append(entry({ edit_id: log1.nextEditId(d) }));
    log1.append(entry({ edit_id: log1.nextEditId(d) }));

    // New EditLog instance must continue from 0004, not start at 0001.
    const log2 = new EditLog(tmpRoot);
    expect(log2.nextEditId(d)).toBe("edit_20260430_0004");
  });

  it("ignores entries from other days when recovering", () => {
    const log1 = new EditLog(tmpRoot);
    log1.append(entry({ edit_id: "edit_20260429_0017" }));
    log1.append(entry({ edit_id: "edit_20260430_0002" }));

    const log2 = new EditLog(tmpRoot);
    expect(log2.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_0003");
    expect(log2.nextEditId(new Date(2026, 3, 29))).toBe("edit_20260429_0018");
  });

  it("survives malformed log lines", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    const logPath = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    fs.writeFileSync(
      logPath,
      "not json\n" +
        JSON.stringify(entry({ edit_id: "edit_20260430_0005" })) +
        "\n" +
        "{partial...\n",
      "utf8",
    );
    const log = new EditLog(tmpRoot);
    expect(log.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_0006");
  });
});

describe("EditLog.append / readAll", () => {
  it("creates the state directory on first append", () => {
    const log = new EditLog(tmpRoot);
    expect(fs.existsSync(path.join(tmpRoot, ".meta-edit", "state"))).toBe(false);
    log.append(entry());
    expect(fs.existsSync(path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl"))).toBe(true);
  });

  it("round-trips an entry through append + readAll", () => {
    const log = new EditLog(tmpRoot);
    const e = entry({ rationale: "Tighten bound by one." });
    log.append(e);
    const back = log.readAll();
    expect(back.length).toBe(1);
    expect(back[0]).toEqual(e);
  });

  it("appends multiple entries as separate JSONL lines", () => {
    const log = new EditLog(tmpRoot);
    log.append(entry({ edit_id: "edit_20260430_0001" }));
    log.append(entry({ edit_id: "edit_20260430_0002", applied: false, warnings: ["x"] }));

    const text = fs.readFileSync(log.filePath, "utf8");
    expect(text.split("\n").filter((l) => l.length > 0).length).toBe(2);

    const back = log.readAll();
    expect(back.length).toBe(2);
    expect(back[1]?.applied).toBe(false);
    expect(back[1]?.warnings).toEqual(["x"]);
  });

  it("returns an empty array when the log file does not exist", () => {
    const log = new EditLog(tmpRoot);
    expect(log.readAll()).toEqual([]);
  });

  it("skips malformed lines without crashing readAll", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    const p = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    fs.writeFileSync(
      p,
      "garbage\n" + JSON.stringify(entry()) + "\n",
      "utf8",
    );
    const log = new EditLog(tmpRoot);
    const back = log.readAll();
    expect(back.length).toBe(1);
    expect(back[0]?.edit_id).toBe("edit_20260430_0001");
  });
});

describe("isoTimestamp", () => {
  it("formats with timezone offset", () => {
    const ts = isoTimestamp(new Date("2026-04-30T01:23:45Z"));
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+\-]\d{2}:\d{2}$/);
  });
});

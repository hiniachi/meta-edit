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

  it("preserves uniqueness past 9999 edits/day (5+ digit counter)", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    const logPath = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    // Seed an existing log with a 5-digit counter (10001 edits today).
    fs.writeFileSync(
      logPath,
      JSON.stringify(entry({ edit_id: "edit_20260430_10001" })) + "\n",
      "utf8",
    );
    const log = new EditLog(tmpRoot);
    expect(log.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_10002");
  });

  it("emits a 5-digit counter naturally when count exceeds 9999 in process", () => {
    const log = new EditLog(tmpRoot);
    const d = new Date(2026, 3, 30);
    // Fast-forward the in-process counter by appending entries.
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    const logPath = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    fs.writeFileSync(
      logPath,
      JSON.stringify(entry({ edit_id: "edit_20260430_9999" })) + "\n",
      "utf8",
    );
    expect(log.nextEditId(d)).toBe("edit_20260430_10000");
    expect(log.nextEditId(d)).toBe("edit_20260430_10001");
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

describe("EditLog.append symlink defense", () => {
  it("refuses to append when .meta-edit/state is a symlink", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit"), { recursive: true });
    const targetDir = path.join(tmpRoot, "outside");
    fs.mkdirSync(targetDir);
    fs.symlinkSync(targetDir, path.join(tmpRoot, ".meta-edit", "state"));

    const log = new EditLog(tmpRoot);
    expect(() => log.append(entry())).toThrow(
      /refusing to use edit-log path.*is a symlink/,
    );
    expect(fs.existsSync(path.join(targetDir, "edits.jsonl"))).toBe(false);
  });

  it("refuses to append when .meta-edit is a symlink AND repoRoot is given as a relative path", () => {
    // Regression: ensureNoSymlinkOnPath previously seeded traversal with
    // path.sep so a relative repoRoot caused the walk to start from /
    // instead of cwd, missing a symlinked .meta-edit at the relative
    // location. Verify the path is canonicalized first.
    const targetDir = path.join(tmpRoot, "outside-meta-edit");
    fs.mkdirSync(targetDir);
    fs.symlinkSync(targetDir, path.join(tmpRoot, ".meta-edit"));

    // Run with cwd = tmpRoot, repoRoot = "." (relative). chdir back
    // unconditionally and ALSO assert the restore actually happened so
    // we catch a silent cwd leak that would pollute later tests in the
    // same bun worker process.
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpRoot);
      const log = new EditLog(".");
      expect(() => log.append(entry())).toThrow(
        /refusing to use edit-log path.*is a symlink/,
      );
      expect(fs.existsSync(path.join(targetDir, "state", "edits.jsonl"))).toBe(
        false,
      );
    } finally {
      process.chdir(originalCwd);
    }
    expect(process.cwd()).toBe(originalCwd);
  });

  // Regression tests for issue a6-02: the fail-closed branch in
  // EditLog.append that refuses to write the audit log when the
  // platform does not expose a usable O_NOFOLLOW. The branch is
  // structurally unreachable on Linux/macOS without injection because
  // fs.constants.O_NOFOLLOW is a non-zero number there.
  it("throws a descriptive error when O_NOFOLLOW is 0 (platform lacks support)", () => {
    const original = fs.constants.O_NOFOLLOW;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      fs.constants,
      "O_NOFOLLOW",
    );
    try {
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

  it("throws a descriptive error when O_NOFOLLOW is non-numeric (platform lacks support)", () => {
    const original = fs.constants.O_NOFOLLOW;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      fs.constants,
      "O_NOFOLLOW",
    );
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

  it("refuses to append when edits.jsonl is itself a symlink", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    const target = path.join(tmpRoot, "outside.jsonl");
    fs.writeFileSync(target, "", "utf8");
    fs.symlinkSync(target, path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl"));

    const log = new EditLog(tmpRoot);
    expect(() => log.append(entry())).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("");
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

  describe("zod-validated readAll skips schema-malformed entries (v0.1.2)", () => {
    function writeJsonl(lines: unknown[]): EditLog {
      fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
        recursive: true,
      });
      const p = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
      fs.writeFileSync(
        p,
        lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
        "utf8",
      );
      return new EditLog(tmpRoot);
    }

    it("includes a fully valid entry", () => {
      const log = writeJsonl([entry()]);
      expect(log.readAll().length).toBe(1);
    });

    it("skips a line missing tool_name", () => {
      const bad = { ...entry() } as Record<string, unknown>;
      delete bad.tool_name;
      const log = writeJsonl([bad, entry({ edit_id: "edit_20260430_0002" })]);
      const back = log.readAll();
      expect(back.length).toBe(1);
      expect(back[0]?.edit_id).toBe("edit_20260430_0002");
    });

    it("skips a line where tool_name is null", () => {
      const bad = { ...entry(), tool_name: null } as unknown;
      const log = writeJsonl([bad, entry({ edit_id: "edit_20260430_0002" })]);
      expect(log.readAll().length).toBe(1);
    });

    it("skips a line where tool_name is a number (non-string)", () => {
      const bad = { ...entry(), tool_name: 42 } as unknown;
      const log = writeJsonl([bad, entry({ edit_id: "edit_20260430_0002" })]);
      expect(log.readAll().length).toBe(1);
    });

    it("skips a line where target_file is missing", () => {
      const bad = { ...entry() } as Record<string, unknown>;
      delete bad.target_file;
      const log = writeJsonl([bad, entry({ edit_id: "edit_20260430_0002" })]);
      expect(log.readAll().length).toBe(1);
    });

    it("skips a line where risk_level is outside the enum", () => {
      const bad = { ...entry(), risk_level: "extreme" } as unknown;
      const log = writeJsonl([bad, entry({ edit_id: "edit_20260430_0002" })]);
      expect(log.readAll().length).toBe(1);
    });

    it("skips a line where test_files is a string instead of array", () => {
      const bad = { ...entry(), test_files: "tests/foo.test.ts" } as unknown;
      const log = writeJsonl([bad, entry({ edit_id: "edit_20260430_0002" })]);
      expect(log.readAll().length).toBe(1);
    });

    it("returns only the valid entries from a mixed file", () => {
      const log = writeJsonl([
        entry({ edit_id: "edit_20260430_0001" }),
        { ...entry(), tool_name: null } as unknown,
        entry({ edit_id: "edit_20260430_0003" }),
        { ...entry(), risk_level: "extreme" } as unknown,
        entry({ edit_id: "edit_20260430_0005" }),
      ]);
      const back = log.readAll();
      expect(back.map((e) => e.edit_id)).toEqual([
        "edit_20260430_0001",
        "edit_20260430_0003",
        "edit_20260430_0005",
      ]);
    });

    it("does not crash formatSummary-style consumers on a mixed file", () => {
      // Guards the original failure mode: `name.padEnd(...)` would
      // throw when tool_name was non-string. After zod filtering the
      // padEnd-on-tool_name code path only sees strings.
      const log = writeJsonl([
        { ...entry(), tool_name: 42 } as unknown,
        entry({ edit_id: "edit_20260430_0002" }),
      ]);
      const back = log.readAll();
      // Direct simulation of the prior padEnd crash site.
      for (const e of back) {
        expect(typeof e.tool_name).toBe("string");
        expect(typeof e.target_file).toBe("string");
        expect(() => e.tool_name.padEnd(28)).not.toThrow();
      }
    });

    it("skips an empty-object entry", () => {
      const log = writeJsonl([{}, entry({ edit_id: "edit_20260430_0002" })]);
      expect(log.readAll().length).toBe(1);
    });

    it("skips a non-object JSON value (bare string)", () => {
      const log = writeJsonl(["a-bare-string", entry({ edit_id: "edit_20260430_0002" })]);
      expect(log.readAll().length).toBe(1);
    });

    it("accepts an entry with extra unknown fields (forward-compat)", () => {
      // The schema does NOT call .strict(), so a future log written
      // by a newer meta-edit can add fields without breaking older
      // readers. Verify that intent.
      const future = { ...entry(), future_field: "from-v0.2" } as unknown;
      const log = writeJsonl([future]);
      const back = log.readAll();
      expect(back.length).toBe(1);
      expect(back[0]?.edit_id).toBe("edit_20260430_0001");
    });
  });

  // Regression tests for issue a6-01: JSON.stringify must escape control
  // characters and newlines in attacker-controlled fields (rationale) so
  // a malicious caller cannot inject a second JSON line into edits.jsonl.
  // No production code change is required — these guard against a future
  // refactor that bypasses JSON.stringify (e.g. hand-rolled serialiser).
  it("JSON.stringify escapes newlines in rationale — no line injection", () => {
    const log = new EditLog(tmpRoot);

    // Craft a rationale that would inject a second JSON object if not
    // escaped. The injected payload is a complete, schema-valid edit log
    // entry — if it survived as a separate raw line, readAll would return
    // it as a phantom record.
    const maliciousRationale =
      'evil\n{"injected":true,"edit_id":"edit_99991231_9999",' +
      '"timestamp":"2026-04-30T00:00:00+00:00","tool_name":"edit_refactor_only",' +
      '"target_file":"src/pwned.ts","rationale":"x","risk_level":"low",' +
      '"test_files":[],"patch_size_bytes":0,"applied":true,"warnings":[]}\n';

    const e = entry({
      edit_id: "edit_20260430_0001",
      rationale: maliciousRationale,
    });

    log.append(e);

    // readAll must return exactly one entry.
    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.rationale).toBe(maliciousRationale);

    // The raw file must contain exactly one non-empty line.
    const raw = fs.readFileSync(log.filePath, "utf8");
    const nonEmpty = raw.split("\n").filter((l) => l.trim().length > 0);
    expect(nonEmpty.length).toBe(1);

    // And that line must NOT contain a literal "injected":true (i.e.
    // JSON.stringify escaped the embedded newline as \\n so the injected
    // text remains inside the rationale string value).
    expect(nonEmpty[0]).not.toMatch(/"injected":true/);
  });

  // Regression test for issue a6-04: the .meta-edit/state/ directory
  // must not be created world-readable (0o755). Use 0o700 so other
  // local users on shared systems cannot enumerate/stat/inotify-watch
  // the audit log directory.
  it("state directory is created with mode 0700 (not world-readable)", () => {
    // Permission bits are meaningful on POSIX systems only.
    if (process.platform !== "linux" && process.platform !== "darwin") {
      return; // skip on Windows
    }

    const log = new EditLog(tmpRoot);
    log.append(entry());

    const statePath = path.join(tmpRoot, ".meta-edit", "state");
    const stat = fs.statSync(statePath);
    const mode = stat.mode & 0o777;

    // Must not be readable / writable / traversable by "other".
    expect(mode & 0o007).toBe(0);
    // Must not be writable by group.
    expect(mode & 0o020).toBe(0);
  });

  it("JSON.stringify escapes NUL bytes and ANSI escapes in rationale", () => {
    const log = new EditLog(tmpRoot);

    const nulRationale = "before\x00after";
    const ansiRationale = "color\x1b[31mred\x1b[0m reset";

    log.append(
      entry({ edit_id: "edit_20260430_0001", rationale: nulRationale }),
    );
    log.append(
      entry({ edit_id: "edit_20260430_0002", rationale: ansiRationale }),
    );

    const entries = log.readAll();
    expect(entries.length).toBe(2);
    expect(entries[0]?.rationale).toBe(nulRationale);
    expect(entries[1]?.rationale).toBe(ansiRationale);

    // Raw file: every non-empty line must be free of unescaped C0 control
    // characters except for the trailing newline that separates lines.
    // \x00–\x08 and \x0a–\x1f are JSON-illegal inside a string when raw.
    const raw = fs.readFileSync(log.filePath, "utf8");
    for (const line of raw.split("\n").filter((l) => l.trim().length > 0)) {
      expect(line).not.toMatch(/[\x00-\x08\x0a-\x1f]/);
    }
  });
});

describe("isoTimestamp", () => {
  it("formats with timezone offset", () => {
    const ts = isoTimestamp(new Date("2026-04-30T01:23:45Z"));
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+\-]\d{2}:\d{2}$/);
  });
});

import { afterEach, beforeEach, describe, it, expect, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  EditLog,
  isoTimestamp,
  type IssuedEntry,
  type ConsumedEntry,
  type RejectedEntry,
} from "./edit-log.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-log-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const HEX64_A = "a".repeat(64);
const HEX64_B = "b".repeat(64);

function issued(overrides: Partial<IssuedEntry> = {}): IssuedEntry {
  return {
    edit_id: "edit_20260430_0001",
    ts: "2026-04-30T10:00:00+09:00",
    phase: "issued",
    kind: "edit_boundary_condition",
    target_file: "src/foo.ts",
    rationale: "test",
    risk_level: "medium",
    test_files: ["tests/foo.test.ts"],
    binding: [
      { file: "src/foo.ts", before_sha256: HEX64_A, after_sha256: HEX64_B },
    ],
    token: "met_20260430_0123456789",
    ...overrides,
  };
}

function consumed(overrides: Partial<ConsumedEntry> = {}): ConsumedEntry {
  return {
    edit_id: "edit_20260430_0001",
    ts: "2026-04-30T10:00:11+09:00",
    phase: "consumed",
    consuming_tool: "Edit",
    ...overrides,
  };
}

function rejected(overrides: Partial<RejectedEntry> = {}): RejectedEntry {
  return {
    edit_id: "edit_20260430_0002",
    ts: "2026-04-30T10:01:00+09:00",
    phase: "rejected",
    kind: "edit_boundary_condition",
    target_file: "src/foo.ts",
    audit_error: "test_files must be non-empty",
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
    log1.appendIssued(issued({ edit_id: log1.nextEditId(d) }));
    log1.appendIssued(issued({ edit_id: log1.nextEditId(d) }));
    log1.appendIssued(issued({ edit_id: log1.nextEditId(d) }));

    const log2 = new EditLog(tmpRoot);
    expect(log2.nextEditId(d)).toBe("edit_20260430_0004");
  });

  it("ignores entries from other days when recovering", () => {
    const log1 = new EditLog(tmpRoot);
    log1.appendIssued(issued({ edit_id: "edit_20260429_0017" }));
    log1.appendIssued(issued({ edit_id: "edit_20260430_0002" }));

    const log2 = new EditLog(tmpRoot);
    expect(log2.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_0003");
    expect(log2.nextEditId(new Date(2026, 3, 29))).toBe("edit_20260429_0018");
  });

  it("preserves uniqueness past 9999 edits/day (5+ digit counter)", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const logPath = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    fs.writeFileSync(
      logPath,
      JSON.stringify(issued({ edit_id: "edit_20260430_10001" })) + "\n",
      "utf8",
    );
    const log = new EditLog(tmpRoot);
    expect(log.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_10002");
  });

  it("emits a 5-digit counter naturally when count exceeds 9999 in process", () => {
    const log = new EditLog(tmpRoot);
    const d = new Date(2026, 3, 30);
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const logPath = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    fs.writeFileSync(
      logPath,
      JSON.stringify(issued({ edit_id: "edit_20260430_9999" })) + "\n",
      "utf8",
    );
    expect(log.nextEditId(d)).toBe("edit_20260430_10000");
    expect(log.nextEditId(d)).toBe("edit_20260430_10001");
  });

  it("survives malformed log lines", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const logPath = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    fs.writeFileSync(
      logPath,
      "not json\n" +
        JSON.stringify(issued({ edit_id: "edit_20260430_0005" })) +
        "\n" +
        "{partial...\n",
      "utf8",
    );
    const log = new EditLog(tmpRoot);
    expect(log.nextEditId(new Date(2026, 3, 30))).toBe("edit_20260430_0006");
  });
});

describe("EditLog concurrent-instance safety", () => {
  it("two instances on the same path do not produce duplicate edit_ids", () => {
    const d = new Date(2026, 3, 30);
    const log1 = new EditLog(tmpRoot);
    const log2 = new EditLog(tmpRoot);

    const ids: string[] = [];

    for (let i = 0; i < 6; i++) {
      const active = i % 2 === 0 ? log1 : log2;
      const id = active.nextEditId(d);
      ids.push(id);
      active.appendIssued(issued({ edit_id: id }));
    }

    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("read/read/write/write interleaving still produces unique edit_ids", () => {
    const d = new Date(2026, 3, 30);
    const log1 = new EditLog(tmpRoot);
    const log2 = new EditLog(tmpRoot);

    const idA = log1.nextEditId(d);
    const idB = log2.nextEditId(d);
    expect(idA).not.toBe(idB);

    log1.appendIssued(issued({ edit_id: idA }));
    log2.appendIssued(issued({ edit_id: idB }));

    const back = log1.readAll();
    const idsOnDisk = new Set(back.map((e) => e.edit_id));
    expect(idsOnDisk.size).toBe(2);
  });

  it("nextEditId throws on non-ENOENT log read error (fail-closed)", () => {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      return;
    }
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return;
    }

    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const logPath = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    fs.writeFileSync(logPath, JSON.stringify(issued()) + "\n", "utf8");
    fs.chmodSync(logPath, 0o000);
    try {
      const log = new EditLog(tmpRoot);
      expect(() => log.nextEditId(new Date(2026, 3, 30))).toThrow();
    } finally {
      fs.chmodSync(logPath, 0o600);
    }
  });

  it("large-entry concurrent appends produce no interleaved bytes within a line", () => {
    const largeRationale = "x".repeat(5000);
    const d = new Date(2026, 3, 30);

    const log1 = new EditLog(tmpRoot);
    const log2 = new EditLog(tmpRoot);

    for (let i = 0; i < 4; i++) {
      const active = i % 2 === 0 ? log1 : log2;
      const id = active.nextEditId(d);
      active.appendIssued(issued({ edit_id: id, rationale: largeRationale }));
    }

    const raw = fs.readFileSync(
      path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl"),
      "utf8",
    );
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(4);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      const parsed = JSON.parse(line) as { rationale?: string };
      expect(parsed.rationale).toBe(largeRationale);
    }
  });
});

describe("EditLog.append symlink defense", () => {
  it("refuses to append when .meta-edit/state is a symlink", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit"), { recursive: true });
    const targetDir = path.join(tmpRoot, "outside");
    fs.mkdirSync(targetDir);
    fs.symlinkSync(targetDir, path.join(tmpRoot, ".meta-edit", "state"));

    const log = new EditLog(tmpRoot);
    expect(() => log.appendIssued(issued())).toThrow(
      /refusing to use edit-log path.*is a symlink/,
    );
    expect(fs.existsSync(path.join(targetDir, "edits.jsonl"))).toBe(false);
  });

  it("refuses to append when .meta-edit is a symlink AND repoRoot is given as a relative path", () => {
    const targetDir = path.join(tmpRoot, "outside-meta-edit");
    fs.mkdirSync(targetDir);
    fs.symlinkSync(targetDir, path.join(tmpRoot, ".meta-edit"));

    const originalCwd = process.cwd();
    try {
      process.chdir(tmpRoot);
      const log = new EditLog(".");
      expect(() => log.appendIssued(issued())).toThrow(
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
      expect(() => log.appendIssued(issued())).toThrow(
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
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const target = path.join(tmpRoot, "outside.jsonl");
    fs.writeFileSync(target, "", "utf8");
    fs.symlinkSync(
      target,
      path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl"),
    );

    const log = new EditLog(tmpRoot);
    expect(() => log.appendIssued(issued())).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("");
  });
});

describe("EditLog phases (issued / consumed / rejected)", () => {
  it("appendIssued + readAll round-trips an issued record", () => {
    const log = new EditLog(tmpRoot);
    const e = issued({ rationale: "Tighten bound by one." });
    log.appendIssued(e);
    const back = log.readAll();
    expect(back.length).toBe(1);
    expect(back[0]?.phase).toBe("issued");
    expect(back[0]).toEqual(e);
  });

  it("appendConsumed + readAll round-trips a consumed record", () => {
    const log = new EditLog(tmpRoot);
    const e = consumed({ consuming_tool: "MultiEdit" });
    log.appendConsumed(e);
    const back = log.readAll();
    expect(back.length).toBe(1);
    expect(back[0]?.phase).toBe("consumed");
    expect(back[0]).toEqual(e);
  });

  it("appendRejected + readAll round-trips a rejected record", () => {
    const log = new EditLog(tmpRoot);
    const e = rejected({ audit_error: "before_sha256 mismatch" });
    log.appendRejected(e);
    const back = log.readAll();
    expect(back.length).toBe(1);
    expect(back[0]?.phase).toBe("rejected");
    expect(back[0]).toEqual(e);
  });

  it("reconciles issued+consumed by edit_id", () => {
    const log = new EditLog(tmpRoot);
    log.appendIssued(issued({ edit_id: "edit_20260430_0001" }));
    log.appendConsumed(
      consumed({
        edit_id: "edit_20260430_0001",
        consuming_tool: "Edit",
      }),
    );
    log.appendIssued(issued({ edit_id: "edit_20260430_0002" })); // abandoned

    const back = log.readAll();
    expect(back.length).toBe(3);

    const byId = new Map<string, string[]>();
    for (const e of back) {
      const phases = byId.get(e.edit_id) ?? [];
      phases.push(e.phase);
      byId.set(e.edit_id, phases);
    }
    expect(byId.get("edit_20260430_0001")).toEqual(["issued", "consumed"]);
    expect(byId.get("edit_20260430_0002")).toEqual(["issued"]); // unconsumed
  });

  it("appends multiple entries as separate JSONL lines", () => {
    const log = new EditLog(tmpRoot);
    log.appendIssued(issued({ edit_id: "edit_20260430_0001" }));
    log.appendConsumed(consumed({ edit_id: "edit_20260430_0001" }));

    const text = fs.readFileSync(log.filePath, "utf8");
    expect(text.split("\n").filter((l) => l.length > 0).length).toBe(2);

    const back = log.readAll();
    expect(back.length).toBe(2);
    expect(back[0]?.phase).toBe("issued");
    expect(back[1]?.phase).toBe("consumed");
  });

  it("returns an empty array when the log file does not exist", () => {
    const log = new EditLog(tmpRoot);
    expect(log.readAll()).toEqual([]);
  });

  it("readAll catches ENOENT from readFileSync and returns []", () => {
    const log = new EditLog(tmpRoot);
    log.appendIssued(issued());

    const original = fs.readFileSync;
    const spy = spyOn(fs, "readFileSync");
    spy.mockImplementation(((p: unknown, opts: unknown) => {
      if (typeof p === "string" && p.endsWith("edits.jsonl")) {
        const err = new Error(
          `ENOENT: no such file or directory, open '${p}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return (original as (...a: unknown[]) => unknown)(p, opts);
    }) as typeof fs.readFileSync);
    try {
      expect(() => log.readAll()).not.toThrow();
      expect(log.readAll()).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("readAll re-throws non-ENOENT errors from readFileSync (no silent corruption)", () => {
    const log = new EditLog(tmpRoot);
    log.appendIssued(issued());

    const original = fs.readFileSync;
    const spy = spyOn(fs, "readFileSync");
    spy.mockImplementation(((p: unknown, opts: unknown) => {
      if (typeof p === "string" && p.endsWith("edits.jsonl")) {
        const err = new Error(
          `EACCES: permission denied, open '${p}'`,
        ) as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      return (original as (...a: unknown[]) => unknown)(p, opts);
    }) as typeof fs.readFileSync);
    try {
      expect(() => log.readAll()).toThrow(/EACCES|permission/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("skips JSON-malformed lines without crashing readAll", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const p = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    fs.writeFileSync(p, "garbage\n" + JSON.stringify(issued()) + "\n", "utf8");
    const log = new EditLog(tmpRoot);
    const back = log.readAll();
    expect(back.length).toBe(1);
    expect(back[0]?.edit_id).toBe("edit_20260430_0001");
  });

  it("skips schema-malformed entries (zod-validated readAll)", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const p = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    const lines = [
      JSON.stringify(issued({ edit_id: "edit_20260430_0001" })),
      JSON.stringify({ edit_id: "x", phase: "unknown" }), // bad discriminator
      JSON.stringify({ phase: "issued" }), // missing required fields
      JSON.stringify({}), // empty object
      JSON.stringify("a-bare-string"),
      JSON.stringify(consumed({ edit_id: "edit_20260430_0002" })),
    ];
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
    const log = new EditLog(tmpRoot);
    const back = log.readAll();
    expect(back.length).toBe(2);
    expect(back.map((e) => e.edit_id)).toEqual([
      "edit_20260430_0001",
      "edit_20260430_0002",
    ]);
  });

  it("accepts an entry with extra unknown fields (forward-compat)", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const p = path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl");
    const future = { ...issued(), future_field: "from-v0.3" };
    fs.writeFileSync(p, JSON.stringify(future) + "\n", "utf8");
    const log = new EditLog(tmpRoot);
    const back = log.readAll();
    expect(back.length).toBe(1);
    expect(back[0]?.edit_id).toBe("edit_20260430_0001");
  });

  it("rejects an issued entry with an empty binding (zod min(1))", () => {
    const log = new EditLog(tmpRoot);
    expect(() =>
      log.appendIssued(issued({ binding: [] as unknown as IssuedEntry["binding"] })),
    ).toThrow();
  });

  // Codex review: LOW, in-scope under Article 3. SPEC §6 requires
  // rejected records to carry a non-empty audit_error so audit consumers
  // always have an actionable reason.
  it("rejects a rejected entry with an empty audit_error (zod min(1))", () => {
    const log = new EditLog(tmpRoot);
    expect(() =>
      log.appendRejected(rejected({ audit_error: "" })),
    ).toThrow();
  });

  it("creates the state directory on first append", () => {
    const log = new EditLog(tmpRoot);
    expect(fs.existsSync(path.join(tmpRoot, ".meta-edit", "state"))).toBe(false);
    log.appendIssued(issued());
    expect(
      fs.existsSync(path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl")),
    ).toBe(true);
  });

  it("JSON.stringify escapes newlines in rationale -- no line injection", () => {
    const log = new EditLog(tmpRoot);

    const maliciousRationale =
      'evil\n{"injected":true,"edit_id":"edit_99991231_9999",' +
      '"ts":"2026-04-30T00:00:00+00:00","phase":"consumed","consuming_tool":"Edit"}\n';

    const e = issued({
      edit_id: "edit_20260430_0001",
      rationale: maliciousRationale,
    });

    log.appendIssued(e);

    const entries = log.readAll();
    expect(entries.length).toBe(1);
    const parsed = entries[0];
    if (parsed?.phase !== "issued") {
      throw new Error("expected issued phase");
    }
    expect(parsed.rationale).toBe(maliciousRationale);

    const raw = fs.readFileSync(log.filePath, "utf8");
    const nonEmpty = raw.split("\n").filter((l) => l.trim().length > 0);
    expect(nonEmpty.length).toBe(1);
    expect(nonEmpty[0]).not.toMatch(/"injected":true/);
  });

  it("does not chmod the parent .meta-edit directory", () => {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      return;
    }

    const metaEditDir = path.join(tmpRoot, ".meta-edit");
    fs.mkdirSync(metaEditDir, { recursive: true });
    fs.chmodSync(metaEditDir, 0o755);

    const log = new EditLog(tmpRoot);
    log.appendIssued(issued());

    const stat = fs.statSync(metaEditDir);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("propagates chmodSync error on POSIX (does not swallow)", () => {
    if (process.platform === "win32") return;

    const log = new EditLog(tmpRoot);
    const statePath = path.join(tmpRoot, ".meta-edit", "state");
    const original = fs.chmodSync;
    const spy = spyOn(fs, "chmodSync");
    spy.mockImplementation(((p: fs.PathLike, m: fs.Mode) => {
      if (typeof p === "string" && p === statePath) {
        const err = new Error("EPERM: simulated") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return original(p, m);
    }) as typeof fs.chmodSync);
    try {
      expect(() => log.appendIssued(issued())).toThrow(/EPERM/);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("state directory is created with mode 0700 (not world-readable)", () => {
    if (process.platform !== "linux" && process.platform !== "darwin") return;

    const log = new EditLog(tmpRoot);
    log.appendIssued(issued());

    const statePath = path.join(tmpRoot, ".meta-edit", "state");
    const stat = fs.statSync(statePath);
    const mode = stat.mode & 0o777;

    expect(mode & 0o007).toBe(0);
    expect(mode & 0o020).toBe(0);
  });

  it("JSON.stringify escapes NUL bytes and ANSI escapes in rationale", () => {
    const log = new EditLog(tmpRoot);

    const nulRationale = "before\x00after";
    const ansiRationale = "color\x1b[31mred\x1b[0m reset";

    log.appendIssued(
      issued({ edit_id: "edit_20260430_0001", rationale: nulRationale }),
    );
    log.appendIssued(
      issued({ edit_id: "edit_20260430_0002", rationale: ansiRationale }),
    );

    const entries = log.readAll();
    expect(entries.length).toBe(2);
    const a = entries[0];
    const b = entries[1];
    if (a?.phase !== "issued" || b?.phase !== "issued") {
      throw new Error("expected issued phases");
    }
    expect(a.rationale).toBe(nulRationale);
    expect(b.rationale).toBe(ansiRationale);

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

describe("EditLog counter.json symlink defense", () => {
  it("refuses to write counter.json when it is a symlink (preserves both link and target)", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), {
      recursive: true,
    });
    const stateDir = path.join(tmpRoot, ".meta-edit", "state");
    const counterPath = path.join(stateDir, "counter.json");

    const victimPath = path.join(tmpRoot, "victim.txt");
    const originalVictim = "DO NOT OVERWRITE\n";
    fs.writeFileSync(victimPath, originalVictim, "utf8");
    fs.symlinkSync(victimPath, counterPath);

    const log = new EditLog(tmpRoot);
    expect(() => log.nextEditId(new Date(2026, 3, 30))).toThrow();

    const lst = fs.lstatSync(counterPath);
    expect(lst.isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(victimPath, "utf8")).toBe(originalVictim);
  });
});

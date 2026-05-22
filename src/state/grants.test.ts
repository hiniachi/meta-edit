import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import {
  createGrantsStore,
  GRANT_TTL_MS,
  type GrantBinding,
} from "./grants.js";
import { makeTmpRoot, cleanTmpRoot, HEX64_A, HEX64_C } from "../test-helpers.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = makeTmpRoot("grants");
});

afterEach(() => {
  cleanTmpRoot(tmpRoot);
});

function binding(file: string, before = HEX64_A): GrantBinding {
  return { file, before_sha256: before };
}

describe("grants.issue", () => {
  it("produces a grant with the expected shape and TTL", async () => {
    const store = createGrantsStore(tmpRoot);
    const before = Date.now();
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const after = Date.now();

    expect(g.token_id).toMatch(/^met_\d{8}_[0-9a-f]{10}$/);
    expect(g.edit_id).toBe("edit_20260502_0001");
    expect(g.binding.length).toBe(1);
    expect(g.consumed_files).toEqual([]);

    const issued = Date.parse(g.issued_at);
    const expires = Date.parse(g.expires_at);
    expect(issued).toBeGreaterThanOrEqual(before);
    expect(issued).toBeLessThanOrEqual(after);
    expect(expires - issued).toBe(GRANT_TTL_MS);
  });

  it("persists optional declaration metadata for hook reminders", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("src/foo.ts")],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "direct_observation",
        target_file: "src/foo.ts",
        test_files: ["tests/foo.test.ts"],
      },
    });

    const looked = await store.lookup(g.token_id);
    expect(looked?.declaration).toEqual({
      kind: "edit_boundary_condition",
      target: "prod",
      provenance: "direct_observation",
      target_file: "src/foo.ts",
      test_files: ["tests/foo.test.ts"],
    });
  });

  it("writes the grant file under .meta-edit/state/grants/<token_id>.json", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const expected = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );
    expect(fs.existsSync(expected)).toBe(true);
  });

  it("creates the grants directory with mode 0700", async () => {
    if (process.platform === "win32") return;
    const store = createGrantsStore(tmpRoot);
    await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const stat = fs.statSync(
      path.join(tmpRoot, ".meta-edit", "state", "grants"),
    );
    const mode = stat.mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });

  it("writes grant files with mode 0600", async () => {
    if (process.platform === "win32") return;
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );
    const stat = fs.statSync(filePath);
    const mode = stat.mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });

  it("rejects an empty binding", async () => {
    const store = createGrantsStore(tmpRoot);
    await expect(
      store.issue({ edit_id: "edit_20260502_0001", binding: [] }),
    ).rejects.toThrow();
  });

  // Codex review: MEDIUM, in-scope under Article 3 — duplicate file
  // paths in the same grant cannot be fully consumed because the
  // consumed_files list is keyed on file path. Reject at issue time.
  it("rejects duplicate binding[].file values", async () => {
    const store = createGrantsStore(tmpRoot);
    await expect(
      store.issue({
        edit_id: "edit_20260502_0001",
        binding: [
          binding("/abs/src/dup.ts", HEX64_A),
          binding("/abs/src/dup.ts", HEX64_C),
        ],
      }),
    ).rejects.toThrow(/duplicate binding file/);
  });

  // Codex review: MEDIUM — issue-time hash format validation prevents
  // persisting a grant that lookup() / consume() will then reject.
  it("rejects a malformed before_sha256 (not 64 hex)", async () => {
    const store = createGrantsStore(tmpRoot);
    await expect(
      store.issue({
        edit_id: "edit_20260502_0001",
        binding: [{ file: "/abs/src/foo.ts", before_sha256: "abc" }],
      }),
    ).rejects.toThrow(/before_sha256/);
  });

  it("rejects a malformed before_sha256 (uppercase hex)", async () => {
    const store = createGrantsStore(tmpRoot);
    await expect(
      store.issue({
        edit_id: "edit_20260502_0001",
        binding: [
          {
            file: "/abs/src/foo.ts",
            before_sha256: "A".repeat(64),
          },
        ],
      }),
    ).rejects.toThrow(/before_sha256/);
  });

  it("rejects an empty file path in a binding", async () => {
    const store = createGrantsStore(tmpRoot);
    await expect(
      store.issue({
        edit_id: "edit_20260502_0001",
        binding: [{ file: "", before_sha256: HEX64_A }],
      }),
    ).rejects.toThrow(/file/);
  });

  it("two parallel issues produce different token_ids", async () => {
    const store = createGrantsStore(tmpRoot);
    const N = 8;
    const grants = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.issue({
          edit_id: `edit_20260502_${String(i).padStart(4, "0")}`,
          binding: [binding(`/abs/src/foo${i}.ts`)],
        }),
      ),
    );
    const ids = new Set(grants.map((g) => g.token_id));
    expect(ids.size).toBe(N);
  });
});

describe("grants.lookup", () => {
  it("returns the grant for a fresh, valid token", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const looked = await store.lookup(g.token_id);
    expect(looked).not.toBeNull();
    expect(looked!.token_id).toBe(g.token_id);
    expect(looked!.binding[0]!.file).toBe("/abs/src/foo.ts");
  });

  it("returns null for an unknown token", async () => {
    const store = createGrantsStore(tmpRoot);
    const looked = await store.lookup("met_20260502_0123456789");
    expect(looked).toBeNull();
  });

  it("returns null for a token with malformed id format", async () => {
    const store = createGrantsStore(tmpRoot);
    expect(await store.lookup("not-a-token")).toBeNull();
    expect(await store.lookup("met_20260502_TOOSHORT")).toBeNull();
    expect(await store.lookup("")).toBeNull();
  });

  it("returns null for an expired grant", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    // Hand-edit the grant file to backdate expires_at.
    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    raw.expires_at = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(filePath, JSON.stringify(raw), "utf8");

    const looked = await store.lookup(g.token_id);
    expect(looked).toBeNull();
  });

  it("returns null for a corrupt grant file", async () => {
    const store = createGrantsStore(tmpRoot);
    await fsp.mkdir(path.join(tmpRoot, ".meta-edit", "state", "grants"), {
      recursive: true,
    });
    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      "met_20260502_0123456789.json",
    );
    fs.writeFileSync(filePath, "{not valid json", "utf8");
    expect(await store.lookup("met_20260502_0123456789")).toBeNull();
  });
});

describe("grants.consume", () => {
  it("consumes a single binding and unlinks the file when fully consumed", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );

    const r = await store.consume(g.token_id, "/abs/src/foo.ts");
    expect(r.consumed).toBe(true);
    expect(r.fully_consumed).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("partial consume: marks consumed_files but keeps the file", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [
        binding("/abs/src/a.ts", HEX64_A),
        binding("/abs/src/b.ts", HEX64_C),
      ],
    });
    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );

    const r1 = await store.consume(g.token_id, "/abs/src/a.ts");
    expect(r1.consumed).toBe(true);
    expect(r1.fully_consumed).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk.consumed_files).toEqual(["/abs/src/a.ts"]);

    const r2 = await store.consume(g.token_id, "/abs/src/b.ts");
    expect(r2.consumed).toBe(true);
    expect(r2.fully_consumed).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("returns consumed:false for an unknown file", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const r = await store.consume(g.token_id, "/abs/src/other.ts");
    expect(r.consumed).toBe(false);
    expect(r.fully_consumed).toBe(false);
    expect(r.error).toMatch(/not bound/);
  });

  it("returns consumed:false when consuming the same binding twice", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [
        binding("/abs/src/a.ts", HEX64_A),
        binding("/abs/src/b.ts", HEX64_C),
      ],
    });
    const r1 = await store.consume(g.token_id, "/abs/src/a.ts");
    expect(r1.consumed).toBe(true);

    const r2 = await store.consume(g.token_id, "/abs/src/a.ts");
    expect(r2.consumed).toBe(false);
    expect(r2.error).toMatch(/already consumed/);
  });

  it("returns consumed:false for an expired grant", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    raw.expires_at = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(filePath, JSON.stringify(raw), "utf8");

    const r = await store.consume(g.token_id, "/abs/src/foo.ts");
    expect(r.consumed).toBe(false);
    expect(r.error).toMatch(/expired/);
  });

  it("returns consumed:false for an unknown token id", async () => {
    const store = createGrantsStore(tmpRoot);
    const r = await store.consume(
      "met_20260502_0123456789",
      "/abs/src/foo.ts",
    );
    expect(r.consumed).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it("returns consumed:false for a malformed token id", async () => {
    const store = createGrantsStore(tmpRoot);
    const r = await store.consume("garbage", "/abs/src/foo.ts");
    expect(r.consumed).toBe(false);
    expect(r.error).toMatch(/invalid/);
  });

  // Codex review: HIGH, in-scope under Article 3. Two consume() calls
  // landing in the same tick against different files of the same
  // workflow grant must serialise via the per-token mutex; without it
  // the read/modify/write would lose one of the consumed_files entries.
  it("concurrent consumes against different files of the same grant both succeed", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [
        binding("/abs/src/a.ts", HEX64_A),
        binding("/abs/src/b.ts", HEX64_C),
      ],
    });

    const [r1, r2] = await Promise.all([
      store.consume(g.token_id, "/abs/src/a.ts"),
      store.consume(g.token_id, "/abs/src/b.ts"),
    ]);

    // Both consumes must succeed — no update lost.
    expect(r1.consumed).toBe(true);
    expect(r2.consumed).toBe(true);
    // Exactly one of them is the final fully_consumed result.
    expect([r1.fully_consumed, r2.fully_consumed].sort()).toEqual([false, true]);
    // And the grant file must be unlinked at the end.
    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );
    expect(fs.existsSync(filePath)).toBe(false);
  });

  // Codex review pass 2: HIGH. The mutex must be process-wide (keyed
  // on grant file path) so two GrantsStoreImpl instances created against
  // the same repo cannot race. A per-instance mutex would not protect
  // this case.
  it("concurrent consumes via two different GrantsStoreImpl instances both succeed", async () => {
    const a = createGrantsStore(tmpRoot);
    const b = createGrantsStore(tmpRoot);
    const g = await a.issue({
      edit_id: "edit_20260502_0001",
      binding: [
        binding("/abs/src/a.ts", HEX64_A),
        binding("/abs/src/b.ts", HEX64_C),
      ],
    });

    const [r1, r2] = await Promise.all([
      a.consume(g.token_id, "/abs/src/a.ts"),
      b.consume(g.token_id, "/abs/src/b.ts"),
    ]);
    expect(r1.consumed).toBe(true);
    expect(r2.consumed).toBe(true);
    expect([r1.fully_consumed, r2.fully_consumed].sort()).toEqual([false, true]);

    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("many concurrent consumes against an N-file grant produce N successful consumes", async () => {
    const store = createGrantsStore(tmpRoot);
    const N = 8;
    const files = Array.from({ length: N }, (_, i) => `/abs/src/f${i}.ts`);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: files.map((f) => binding(f)),
    });

    const results = await Promise.all(
      files.map((f) => store.consume(g.token_id, f)),
    );
    const successes = results.filter((r) => r.consumed).length;
    expect(successes).toBe(N);
    expect(results.filter((r) => r.fully_consumed).length).toBe(1);
  });
});

// =====================================================================
// v0.2.2: findActiveBindingForFile (server-side file-based grant lookup)
// =====================================================================

describe("grants.findActiveBindingForFile", () => {
  it("returns null when no grants exist", async () => {
    const store = createGrantsStore(tmpRoot);
    expect(await store.findActiveBindingForFile("/abs/src/foo.ts")).toBeNull();
  });

  it("returns null when no grant covers the file", async () => {
    const store = createGrantsStore(tmpRoot);
    await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/other.ts")],
    });
    expect(await store.findActiveBindingForFile("/abs/src/foo.ts")).toBeNull();
  });

  it("returns the unique active grant when only one matches", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const m = await store.findActiveBindingForFile("/abs/src/foo.ts");
    expect(m).not.toBeNull();
    expect(m!.grant.token_id).toBe(g.token_id);
    expect(m!.binding.file).toBe("/abs/src/foo.ts");
  });

  it("returns the most-recently-issued grant when multiple match (LIFO)", async () => {
    const store = createGrantsStore(tmpRoot);
    const older = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    // Backdate the older grant by 100ms so issued_at ordering is stable.
    const olderPath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${older.token_id}.json`,
    );
    {
      const stored = JSON.parse(fs.readFileSync(olderPath, "utf8"));
      stored.issued_at = new Date(Date.now() - 100).toISOString();
      fs.writeFileSync(olderPath, JSON.stringify(stored));
    }
    const newer = await store.issue({
      edit_id: "edit_20260502_0002",
      binding: [binding("/abs/src/foo.ts")],
    });
    const m = await store.findActiveBindingForFile("/abs/src/foo.ts");
    expect(m).not.toBeNull();
    expect(m!.grant.token_id).toBe(newer.token_id);
  });

  it("skips expired grants", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    // Expire it.
    const filePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${g.token_id}.json`,
    );
    const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
    stored.expires_at = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(filePath, JSON.stringify(stored));

    expect(await store.findActiveBindingForFile("/abs/src/foo.ts")).toBeNull();
  });

  it("skips a binding already in consumed_files", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [
        binding("/abs/src/a.ts", HEX64_A),
        binding("/abs/src/b.ts", HEX64_C),
      ],
    });
    // Consume a.ts manually.
    await store.consume(g.token_id, "/abs/src/a.ts");
    // Now scanning for a.ts should return null even though the grant is
    // still alive (b.ts is still unconsumed).
    expect(await store.findActiveBindingForFile("/abs/src/a.ts")).toBeNull();
    const mb = await store.findActiveBindingForFile("/abs/src/b.ts");
    expect(mb).not.toBeNull();
    expect(mb!.grant.token_id).toBe(g.token_id);
  });

  it("ignores corrupt and stray files in the grants dir", async () => {
    const store = createGrantsStore(tmpRoot);
    const g = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const dir = path.join(tmpRoot, ".meta-edit", "state", "grants");
    fs.writeFileSync(path.join(dir, "stray.txt"), "hello", "utf8");
    fs.writeFileSync(
      path.join(dir, "met_20260502_deadbeef00.json"),
      "{ not valid",
      "utf8",
    );

    const m = await store.findActiveBindingForFile("/abs/src/foo.ts");
    expect(m).not.toBeNull();
    expect(m!.grant.token_id).toBe(g.token_id);
  });

  it("returns null for empty input", async () => {
    const store = createGrantsStore(tmpRoot);
    expect(await store.findActiveBindingForFile("")).toBeNull();
  });
});

describe("grants.reapExpired", () => {
  it("removes only expired grant files", async () => {
    const store = createGrantsStore(tmpRoot);
    const fresh = await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/fresh.ts")],
    });
    const stale = await store.issue({
      edit_id: "edit_20260502_0002",
      binding: [binding("/abs/src/stale.ts")],
    });

    const stalePath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${stale.token_id}.json`,
    );
    const freshPath = path.join(
      tmpRoot,
      ".meta-edit",
      "state",
      "grants",
      `${fresh.token_id}.json`,
    );
    const stalePayload = JSON.parse(fs.readFileSync(stalePath, "utf8"));
    stalePayload.expires_at = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(stalePath, JSON.stringify(stalePayload), "utf8");

    const removed = await store.reapExpired();
    expect(removed).toBe(1);
    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.existsSync(freshPath)).toBe(true);
  });

  it("returns 0 when the grants dir does not exist", async () => {
    const store = createGrantsStore(tmpRoot);
    const removed = await store.reapExpired();
    expect(removed).toBe(0);
  });

  it("ignores non-json and corrupt files without throwing", async () => {
    const store = createGrantsStore(tmpRoot);
    await store.issue({
      edit_id: "edit_20260502_0001",
      binding: [binding("/abs/src/foo.ts")],
    });
    const dir = path.join(tmpRoot, ".meta-edit", "state", "grants");
    fs.writeFileSync(path.join(dir, "stray.txt"), "hello", "utf8");
    fs.writeFileSync(
      path.join(dir, "met_20260502_deadbeef00.json"),
      "{ not valid",
      "utf8",
    );

    const removed = await store.reapExpired();
    expect(removed).toBe(0);
  });
});

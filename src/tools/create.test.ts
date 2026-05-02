import { afterEach, beforeEach, describe, it, expect, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyCreates } from "./apply.js";
import type { ContentChange } from "./common.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-create-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function ensureParent(rel: string): void {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
}

function create(canonical: string, newContent: string): ContentChange {
  // For edit_create_file, oldContent is always the empty string by
  // validation contract. applyCreates ignores oldContent because there
  // is no precondition state on disk.
  return { canonical, oldContent: "", newContent };
}

describe("applyCreates", () => {
  it("creates a new file when the path does not exist", () => {
    ensureParent("src/new.ts");
    const result = applyCreates(tmpRoot, [create("src/new.ts", "alpha\n")]);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/new.ts"), "utf8")).toBe(
      "alpha\n",
    );
  });

  it("creates multiple new files atomically when none of them exist yet", () => {
    ensureParent("src/a.ts");
    ensureParent("src/b.ts");
    const result = applyCreates(tmpRoot, [
      create("src/a.ts", "one\n"),
      create("src/b.ts", "two\n"),
    ]);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/a.ts"), "utf8")).toBe("one\n");
    expect(fs.readFileSync(path.join(tmpRoot, "src/b.ts"), "utf8")).toBe("two\n");
  });

  it("rejects when the target already exists (EEXIST equivalent), without modifying it", () => {
    ensureParent("src/existing.ts");
    fs.writeFileSync(path.join(tmpRoot, "src/existing.ts"), "original\n", "utf8");
    const result = applyCreates(tmpRoot, [
      create("src/existing.ts", "tampered\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) =>
            w.includes("src/existing.ts") &&
            (w.includes("already exists") || w.includes("EEXIST")),
        ),
      ).toBe(true);
    }
    expect(
      fs.readFileSync(path.join(tmpRoot, "src/existing.ts"), "utf8"),
    ).toBe("original\n");
  });

  it("rejects all-or-nothing when any preflight target already exists", () => {
    ensureParent("src/a.ts");
    ensureParent("src/b.ts");
    fs.writeFileSync(path.join(tmpRoot, "src/b.ts"), "preexisting\n", "utf8");
    const result = applyCreates(tmpRoot, [
      create("src/a.ts", "one\n"),
      create("src/b.ts", "two\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) => w.includes("src/b.ts") && (w.includes("already exists") || w.includes("EEXIST")),
        ),
      ).toBe(true);
    }
    // Critical: src/a.ts MUST NOT have been written. The preflight pass
    // catches the conflict before any open() runs on a successful path.
    expect(fs.existsSync(path.join(tmpRoot, "src/a.ts"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpRoot, "src/b.ts"), "utf8")).toBe(
      "preexisting\n",
    );
  });

  it("rejects when the parent directory does not exist (no implicit mkdir)", () => {
    // Intentionally do NOT create src/ — applyCreates must NOT mkdir.
    const result = applyCreates(tmpRoot, [
      create("src/missing-parent/new.ts", "alpha\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) =>
            w.includes("src/missing-parent/new.ts") &&
            (w.includes("parent") ||
              w.includes("ENOENT") ||
              w.includes("does not exist")),
        ),
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(tmpRoot, "src/missing-parent"))).toBe(false);
  });

  it("rejects when the leaf would resolve through a symlink (O_NOFOLLOW)", () => {
    // Set up a symlink AT the leaf path that points outside the repo.
    // applyCreates must refuse to follow it and write through to the target.
    const outside = path.join(os.tmpdir(), `meta-edit-create-outside-${Date.now()}.txt`);
    // Note: the outside path does NOT yet exist; the symlink is dangling.
    ensureParent("src/leaf.ts");
    fs.symlinkSync(outside, path.join(tmpRoot, "src/leaf.ts"));
    try {
      const result = applyCreates(tmpRoot, [create("src/leaf.ts", "alpha\n")]);
      expect(result.applied).toBe(false);
      if (!result.applied) {
        // The lstat-based pre-existence check sees the symlink and rejects
        // with already-exists (an lstat hits the link itself, not its
        // dangling target). Either path is acceptable; both close the
        // O_NOFOLLOW concern.
        expect(
          result.warnings.some(
            (w) =>
              w.includes("src/leaf.ts") &&
              (w.includes("already exists") ||
                w.includes("EEXIST") ||
                w.includes("symlink") ||
                w.includes("ELOOP")),
          ),
        ).toBe(true);
      }
      // The dangling symlink target must not have been materialized as a real
      // file outside the repo.
      expect(fs.existsSync(outside)).toBe(false);
    } finally {
      try {
        fs.unlinkSync(outside);
      } catch {
        /* ignore */
      }
    }
  });

  it("rejects with a clear warning when the validated canonical lands in a protected directory", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    const result = applyCreates(tmpRoot, [
      create(".meta-edit/state/seed.json", "{}\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some((w) => w.includes("protected")),
      ).toBe(true);
    }
    expect(
      fs.existsSync(path.join(tmpRoot, ".meta-edit/state/seed.json")),
    ).toBe(false);
  });

  it("hard-fails when O_NOFOLLOW is unavailable on the platform", () => {
    ensureParent("src/foo.ts");
    const result = applyCreates(
      tmpRoot,
      [create("src/foo.ts", "alpha\n")],
      { oNofollow: 0 },
    );
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) =>
            w.includes("does not expose O_NOFOLLOW") &&
            w.includes("refuses to write"),
        ),
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(tmpRoot, "src/foo.ts"))).toBe(false);
  });

  it("rejects (defense in depth) when applyCreates is given duplicate canonicals", () => {
    ensureParent("src/foo.ts");
    const result = applyCreates(tmpRoot, [
      create("src/foo.ts", "one\n"),
      create("src/foo.ts", "two\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) =>
            w.includes("duplicate canonical") && w.includes("internal error"),
        ),
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(tmpRoot, "src/foo.ts"))).toBe(false);
  });

  it("creates an empty file when new_content is empty", () => {
    // edit_create_file with old_content="" and new_content="" is a valid
    // empty-file creation — the file goes from non-existent to existing.
    // The validate-time no-op rejection (old===new) is bypassed for create.
    ensureParent("src/empty.ts");
    const result = applyCreates(tmpRoot, [create("src/empty.ts", "")]);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/empty.ts"), "utf8")).toBe("");
  });

  // Regression for issue 2026-05-02-1000: applyCreates leaves the
  // partially-created file on disk after a write/fsync failure (e.g.
  // ENOSPC mid-write), blocking retries with EEXIST. The fix unlinks
  // the target in the catch branch when fd is non-null AND code is not
  // EEXIST/ELOOP (those are open-time errors where the file was never
  // created). Simulate ENOSPC on the first fd-based writeFileSync.
  it("removes the file created by openSync when writeFileSync fails (ENOSPC simulation, issue 1000)", () => {
    ensureParent("src/new.ts");

    const originalWriteFileSync = fs.writeFileSync;
    let writeCallCount = 0;
    const spy = spyOn(fs, "writeFileSync");
    spy.mockImplementation(((fdOrPath: unknown, ...args: unknown[]) => {
      // Throw ENOSPC on the first fd-based write — the applyCreates
      // content write opens with O_CREAT|O_EXCL, then writes by fd.
      if (typeof fdOrPath === "number") {
        writeCallCount++;
        if (writeCallCount === 1) {
          const err = Object.assign(
            new Error("ENOSPC: no space left on device, write"),
            { code: "ENOSPC" },
          );
          throw err;
        }
      }
      return (originalWriteFileSync as (...a: unknown[]) => unknown)(
        fdOrPath,
        ...args,
      );
    }) as typeof fs.writeFileSync);

    try {
      const result = applyCreates(tmpRoot, [create("src/new.ts", "alpha\n")]);
      expect(result.applied).toBe(false);
      if (!result.applied) {
        expect(
          result.warnings.some((w) => w.includes("src/new.ts")),
        ).toBe(true);
      }
      // Critical: the partially-created file MUST NOT remain on disk
      // after the fix; otherwise a retry would hit EEXIST forever.
      expect(fs.existsSync(path.join(tmpRoot, "src/new.ts"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("surfaces partial-write warning when an earlier create succeeds and a later one fails on parent permissions", () => {
    // Codex-flagged coverage gap: the partialWriteWarning branch in
    // applyCreates triggers when the first create succeeds and a later
    // create fails after that point. Construct a multi-file batch where
    // the first parent is normal but the second parent is read-only so
    // openSync(O_CREAT) hits EACCES — leaving the first file on disk and
    // exercising the diagnostic path.
    if (process.platform === "win32") return; // chmod 0o555 is a no-op on Windows
    if (process.getuid && process.getuid() === 0) return; // root bypasses dir mode

    ensureParent("src/a.ts");
    fs.mkdirSync(path.join(tmpRoot, "src/locked"), { recursive: true });
    fs.chmodSync(path.join(tmpRoot, "src/locked"), 0o555);
    try {
      const result = applyCreates(tmpRoot, [
        create("src/a.ts", "alpha\n"),
        create("src/locked/b.ts", "beta\n"),
      ]);
      expect(result.applied).toBe(false);

      // First file was created and remains on disk; second never made it.
      expect(fs.readFileSync(path.join(tmpRoot, "src/a.ts"), "utf8")).toBe(
        "alpha\n",
      );
      expect(fs.existsSync(path.join(tmpRoot, "src/locked/b.ts"))).toBe(false);

      // Both the EACCES failure and the partial-write diagnostic are surfaced.
      expect(
        result.warnings.some((w) =>
          w.includes("src/locked/b.ts") &&
          (w.includes("EACCES") || w.includes("failed to create")),
        ),
      ).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.includes("partial write") &&
            w.includes("1 file") &&
            w.includes("src/a.ts"),
        ),
      ).toBe(true);
    } finally {
      try {
        fs.chmodSync(path.join(tmpRoot, "src/locked"), 0o755);
      } catch {
        /* ignore */
      }
    }
  });

  it("rejects when the parent itself is a protected directory", () => {
    // Even if the leaf name is novel, the parent landing inside .meta-edit/state/**
    // means we are creating an audit-record sibling. Refuse early.
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "tmp"), { recursive: true });
    const result = applyCreates(tmpRoot, [
      create(".meta-edit/tmp/new-marker.json", "{}\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some((w) => w.includes("protected")),
      ).toBe(true);
    }
    expect(
      fs.existsSync(path.join(tmpRoot, ".meta-edit/tmp/new-marker.json")),
    ).toBe(false);
  });
});

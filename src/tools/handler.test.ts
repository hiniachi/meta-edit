import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeApplyingHandler } from "./common.js";
import { applyChanges } from "./apply.js";
import { EditLog } from "../state/edit-log.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-handler-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function fixedNow(): Date {
  return new Date(2026, 3, 30, 12, 0, 0);
}

describe("makeApplyingHandler", () => {
  it("validates, applies, and logs a successful edit", async () => {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src/foo.ts"), "alpha\n", "utf8");
    fs.mkdirSync(path.join(tmpRoot, "tests"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "tests/foo.test.ts"), "test\n", "utf8");

    const log = new EditLog(tmpRoot);
    const handler = makeApplyingHandler({
      ctx: { repoRoot: tmpRoot },
      log,
      applyChanges,
      now: fixedNow,
    });

    const result = await handler("edit_boundary_condition", {
      target_file: "src/foo.ts",
      patch:
        "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n",
      rationale: "Tighten by one.",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
    });

    expect(result.applied).toBe(true);
    expect(result.edit_id).toBe("edit_20260430_0001");
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe("beta\n");

    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.applied).toBe(true);
    expect(entries[0]?.tool_name).toBe("edit_boundary_condition");
    expect(entries[0]?.edit_id).toBe("edit_20260430_0001");
    expect(entries[0]?.timestamp).toMatch(/^2026-04-30T12:00:00[+\-]\d{2}:\d{2}$/);
    expect(entries[0]?.patch_size_bytes).toBeGreaterThan(0);
  });

  it("logs validation failures with applied=false (without writing the file)", async () => {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src/foo.ts"), "alpha\n", "utf8");

    const log = new EditLog(tmpRoot);
    const handler = makeApplyingHandler({
      ctx: { repoRoot: tmpRoot },
      log,
      applyChanges,
      now: fixedNow,
    });

    // Empty rationale → validation rejects.
    const result = await handler("edit_boundary_condition", {
      target_file: "src/foo.ts",
      patch:
        "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n",
      rationale: "   ",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
    });

    expect(result.applied).toBe(false);
    expect(result.warnings.some((w) => w.includes("rationale"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe("alpha\n");

    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.applied).toBe(false);
    expect(entries[0]?.warnings.some((w) => w.includes("rationale"))).toBe(true);
  });

  it("logs apply-time failures with applied=false", async () => {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src/foo.ts"), "DIFFERENT\n", "utf8");
    fs.mkdirSync(path.join(tmpRoot, "tests"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "tests/foo.test.ts"), "test\n", "utf8");

    const log = new EditLog(tmpRoot);
    const handler = makeApplyingHandler({
      ctx: { repoRoot: tmpRoot },
      log,
      applyChanges,
      now: fixedNow,
    });

    const result = await handler("edit_boundary_condition", {
      target_file: "src/foo.ts",
      // The patch expects "alpha\n" but the file contains "DIFFERENT\n".
      patch:
        "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n",
      rationale: "context mismatch should fail apply.",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
    });

    expect(result.applied).toBe(false);
    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.applied).toBe(false);
    expect(entries[0]?.warnings.some((w) => w.includes("did not apply cleanly"))).toBe(true);
    // File still untouched.
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe("DIFFERENT\n");
  });

  it("does not throw if log.append fails after a successful apply", async () => {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src/foo.ts"), "alpha\n", "utf8");
    fs.mkdirSync(path.join(tmpRoot, "tests"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "tests/foo.test.ts"), "test\n", "utf8");

    let appendCalls = 0;
    const failingLog = {
      nextEditId: () => "edit_20260430_0001",
      append: () => {
        appendCalls++;
        const err = new Error("simulated ENOSPC") as NodeJS.ErrnoException;
        err.code = "ENOSPC";
        throw err;
      },
    };

    const handler = makeApplyingHandler({
      ctx: { repoRoot: tmpRoot },
      log: failingLog,
      applyChanges,
      now: fixedNow,
    });

    const result = await handler("edit_boundary_condition", {
      target_file: "src/foo.ts",
      patch:
        "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n",
      rationale: "log failure must not block reporting the apply result",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
    });

    // The handler MUST NOT throw, and MUST surface the failure as a
    // warning. The patch IS on disk, so a thrown handler would cause
    // the client to retry and double-apply.
    expect(appendCalls).toBe(1);
    expect(result.applied).toBe(true);
    expect(
      result.warnings.some(
        (w) => w.includes("failed to append edit log") &&
          w.includes("ENOSPC") &&
          w.includes("audit record may be missing"),
      ),
    ).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe(
      "beta\n",
    );
  });

  it("does not throw if log.append fails on a validation rejection", async () => {
    const failingLog = {
      nextEditId: () => "edit_20260430_0001",
      append: () => {
        const err = new Error("simulated EACCES") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
    };

    const handler = makeApplyingHandler({
      ctx: { repoRoot: tmpRoot },
      log: failingLog,
      applyChanges,
      now: fixedNow,
    });

    const result = await handler("edit_boundary_condition", {
      target_file: "src/foo.ts",
      patch:
        "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n",
      rationale: "   ",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
    });

    expect(result.applied).toBe(false);
    expect(result.warnings.some((w) => w.includes("rationale"))).toBe(true);
    expect(
      result.warnings.some(
        (w) => w.includes("failed to append edit log") && w.includes("EACCES"),
      ),
    ).toBe(true);
  });

  it("assigns monotonic edit_id values across multiple calls", async () => {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src/a.ts"), "a\n", "utf8");
    fs.writeFileSync(path.join(tmpRoot, "src/b.ts"), "b\n", "utf8");
    fs.mkdirSync(path.join(tmpRoot, "tests"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "tests/x.test.ts"), "test\n", "utf8");

    const log = new EditLog(tmpRoot);
    const handler = makeApplyingHandler({
      ctx: { repoRoot: tmpRoot },
      log,
      applyChanges,
      now: fixedNow,
    });

    const r1 = await handler("edit_boundary_condition", {
      target_file: "src/a.ts",
      patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-a\n+A\n",
      rationale: "first",
      risk_level: "low",
      test_files: ["tests/x.test.ts"],
    });
    const r2 = await handler("edit_boundary_condition", {
      target_file: "src/b.ts",
      patch: "--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,1 +1,1 @@\n-b\n+B\n",
      rationale: "second",
      risk_level: "low",
      test_files: ["tests/x.test.ts"],
    });

    expect(r1.edit_id).toBe("edit_20260430_0001");
    expect(r2.edit_id).toBe("edit_20260430_0002");
    expect(log.readAll().length).toBe(2);
  });
});

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
      rationale: "Tighten by one.",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
      changes: [
        { file: "src/foo.ts", old_content: "alpha\n", new_content: "beta\n" },
      ],
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
    // patch_size_bytes is now the byte length of the synthesized
    // unified diff, not the length of any incoming patch string.
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

    const result = await handler("edit_boundary_condition", {
      target_file: "src/foo.ts",
      rationale: "   ",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
      changes: [
        { file: "src/foo.ts", old_content: "alpha\n", new_content: "beta\n" },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.warnings.some((w) => w.includes("rationale"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe("alpha\n");

    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.applied).toBe(false);
    expect(entries[0]?.warnings.some((w) => w.includes("rationale"))).toBe(true);
  });

  it("logs apply-time failures with applied=false on stale old_content", async () => {
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src/foo.ts"), "DRIFTED\n", "utf8");
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
      rationale: "stale content should fail apply.",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
      changes: [
        // Stale: disk has "DRIFTED\n" but request says "alpha\n".
        { file: "src/foo.ts", old_content: "alpha\n", new_content: "beta\n" },
      ],
    });

    expect(result.applied).toBe(false);
    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.applied).toBe(false);
    expect(
      entries[0]?.warnings.some((w) => w.includes("stale old_content")),
    ).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe("DRIFTED\n");
  });

  it("surfaces audit_error post-apply even when applyChanges returns applied=false", async () => {
    // Round-4 (defect 1): the runtime always appends an audit record after
    // applyChanges runs, regardless of result.applied (stale old_content
    // returns applied:false but the attempt is still meaningful and
    // audited). If that post-apply append fails, callers MUST get the
    // audit_error signal — `applied` alone does not gate audit-trail
    // completeness.
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src/foo.ts"), "DRIFTED\n", "utf8");
    fs.mkdirSync(path.join(tmpRoot, "tests"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "tests/foo.test.ts"), "test\n", "utf8");

    const failingLog = {
      nextEditId: () => "edit_20260430_0001",
      append: () => {
        const err = new Error("simulated EROFS") as NodeJS.ErrnoException;
        err.code = "EROFS";
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
      rationale: "stale content + audit failure",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
      changes: [
        // Stale: disk has "DRIFTED\n" but request says "alpha\n".
        // applyChanges returns applied:false, then log.append throws.
        { file: "src/foo.ts", old_content: "alpha\n", new_content: "beta\n" },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.audit_error).toBeDefined();
    expect(result.audit_error).toContain("EROFS");
    expect(result.audit_error).toContain("edit_20260430_0001");
    // Disk untouched (apply rejected on stale check) — but audit_error fires.
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe(
      "DRIFTED\n",
    );
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
      rationale: "log failure must not block reporting the apply result",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
      changes: [
        { file: "src/foo.ts", old_content: "alpha\n", new_content: "beta\n" },
      ],
    });

    expect(appendCalls).toBe(1);
    expect(result.applied).toBe(true);
    // Issue 029 (a7-04): log-append failures now surface on the structured
    // `audit_error` field, not buried inside `warnings`. The `warnings` array
    // is reserved for routine validation/apply notices so callers can
    // distinguish audit-trail gaps from validation issues without string
    // matching.
    expect(result.audit_error).toBeDefined();
    expect(result.audit_error).toContain("failed to append edit log");
    expect(result.audit_error).toContain("ENOSPC");
    expect(result.audit_error).toContain("audit record may be missing");
    expect(
      result.warnings.some((w) => w.includes("failed to append edit log")),
    ).toBe(false);
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe(
      "beta\n",
    );
  });

  it("surfaces audit_error when log.append fails on a validation rejection", async () => {
    // Round-4 (defect 2): previously the rejection-record audit-append error
    // was silently discarded. If `.meta-edit/state` is write-restricted, the
    // rejection event vanished from the audit log with NO caller signal —
    // a security hole. The unified `audit_error` semantics surface the
    // failure regardless of apply outcome; callers inspect `applied`
    // separately to determine whether bytes hit disk.
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
      rationale: "   ",
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
      changes: [
        { file: "src/foo.ts", old_content: "alpha\n", new_content: "beta\n" },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.warnings.some((w) => w.includes("rationale"))).toBe(true);
    // The audit failure for the rejection record is now surfaced.
    expect(result.audit_error).toBeDefined();
    expect(result.audit_error).toContain("failed to append edit log");
    expect(result.audit_error).toContain("EACCES");
    expect(result.audit_error).toContain("edit_20260430_0001");
    // warnings remain reserved for validation/apply notices, never log failures.
    expect(
      result.warnings.some((w) => w.includes("failed to append edit log")),
    ).toBe(false);
  });

  it("logs patch_size_bytes=0 on validation failure (no diff synthesis on rejected requests)", async () => {
    // Defense: synthesizing the unified diff before validation would
    // let a malicious client force unbounded createTwoFilesPatch work
    // on requests that are about to be rejected. Validate first; only
    // synthesize on success.
    const log = new EditLog(tmpRoot);
    const handler = makeApplyingHandler({
      ctx: { repoRoot: tmpRoot },
      log,
      applyChanges,
      now: fixedNow,
    });

    const result = await handler("edit_boundary_condition", {
      target_file: "src/foo.ts",
      rationale: "   ", // empty rationale → validation rejects
      risk_level: "medium",
      test_files: ["tests/foo.test.ts"],
      changes: [
        // Big content; would synthesize a large diff if computed.
        {
          file: "src/foo.ts",
          old_content: "x".repeat(100_000),
          new_content: "y".repeat(100_000),
        },
      ],
    });

    expect(result.applied).toBe(false);
    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.applied).toBe(false);
    expect(entries[0]?.patch_size_bytes).toBe(0);
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
      rationale: "first",
      risk_level: "low",
      test_files: ["tests/x.test.ts"],
      changes: [
        { file: "src/a.ts", old_content: "a\n", new_content: "A\n" },
      ],
    });
    const r2 = await handler("edit_boundary_condition", {
      target_file: "src/b.ts",
      rationale: "second",
      risk_level: "low",
      test_files: ["tests/x.test.ts"],
      changes: [
        { file: "src/b.ts", old_content: "b\n", new_content: "B\n" },
      ],
    });

    expect(r1.edit_id).toBe("edit_20260430_0001");
    expect(r2.edit_id).toBe("edit_20260430_0002");
    expect(log.readAll().length).toBe(2);
  });
});

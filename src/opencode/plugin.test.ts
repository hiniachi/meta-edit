import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  createMetaEditPlugin,
  type OpencodePluginContext,
  type OpencodeToolBeforeInput,
  type OpencodeToolBeforeOutput,
} from "./plugin.js";
import { createGrantsStore } from "../state/grants.js";
import { EditLog } from "../state/edit-log.js";

let tmpRoot: string;
let ctx: OpencodePluginContext;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-opencode-plugin-"));
  fs.mkdirSync(path.join(tmpRoot, ".git"));
  ctx = { project: { worktree: tmpRoot } };
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function writeFile(rel: string, content: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

async function callBefore(
  input: OpencodeToolBeforeInput,
  output: OpencodeToolBeforeOutput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const plugin = createMetaEditPlugin();
  const hooks = await plugin(ctx);
  try {
    await hooks["tool.execute.before"]?.(input, output);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

// =====================================================================
// Branch 1: opencode raw-edit primitives → evaluateTokenedEdit
// =====================================================================

describe("opencode raw-edit branch", () => {
  it("denies `edit` when no active grant covers the file", async () => {
    writeFile("src/foo.ts", "x\n");
    const r = await callBefore(
      { tool: "edit" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/foo.ts"),
          oldString: "x",
          newString: "y",
        },
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("no active typed_edit declaration");
    }
  });

  it("allows `edit` when an active grant covers the file (grant-flow integration)", async () => {
    writeFile("src/foo.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260503_0001",
      binding: [{ file: "src/foo.ts", before_sha256: sha256("before\n") }],
    });

    const r = await callBefore(
      { tool: "edit" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/foo.ts"),
          oldString: "before",
          newString: "after",
        },
      },
    );
    expect(r.ok).toBe(true);

    // The grant should now be consumed — a follow-up call denies.
    const r2 = await callBefore(
      { tool: "edit" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/foo.ts"),
          oldString: "before",
          newString: "after",
        },
      },
    );
    expect(r2.ok).toBe(false);
  });

  it("denies `apply_patch` outright with the dedicated step-0a reason", async () => {
    const r = await callBefore(
      { tool: "apply_patch" },
      { args: { input: "*** Update File: src/foo.ts\n@@ -1 +1 @@\n-x\n+y\n" } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("apply_patch");
      expect(r.reason).toContain("unified-diff");
    }
  });

  it("denies `write` when no active grant covers the file", async () => {
    const r = await callBefore(
      { tool: "write" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/new.ts"),
          content: "hello",
        },
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("no active typed_edit declaration");
    }
  });

  it("authorizes empty `write` create without a typed_edit declaration (v0.3.1 free-create)", async () => {
    const r = await callBefore(
      { tool: "write" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/new.ts"),
          content: "",
        },
      },
    );
    expect(r.ok).toBe(true);
  });

  it("accepts both snake_case and camelCase opencode arg names (forward-compat)", async () => {
    writeFile("src/foo.ts", "x\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260503_0002",
      binding: [{ file: "src/foo.ts", before_sha256: sha256("x\n") }],
    });

    // Use snake_case (Claude Code style) on opencode side.
    const r = await callBefore(
      { tool: "edit" },
      {
        args: {
          file_path: path.join(tmpRoot, "src/foo.ts"),
          old_string: "x",
          new_string: "y",
        },
      },
    );
    expect(r.ok).toBe(true);
  });
});

// =====================================================================
// Branch 2: bash → evaluateBashCommand
// =====================================================================

describe("opencode bash branch", () => {
  it("denies a dangerous bash command (sed -i in-place edit)", async () => {
    const r = await callBefore(
      { tool: "bash" },
      { args: { command: "sed -i s/x/y/ src/foo.ts" } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("allows a benign bash command (ls)", async () => {
    const r = await callBefore(
      { tool: "bash" },
      { args: { command: "ls -la" } },
    );
    expect(r.ok).toBe(true);
  });

  it("treats missing/non-string command as empty (allow)", async () => {
    const r = await callBefore({ tool: "bash" }, { args: {} });
    expect(r.ok).toBe(true);
  });
});

// =====================================================================
// Pass-through: non-raw-edit, non-bash tools
// =====================================================================

describe("opencode pass-through", () => {
  it("allows `read`, `glob`, `webfetch` and other non-edit tools", async () => {
    for (const tool of ["read", "glob", "grep", "webfetch", "task"]) {
      const r = await callBefore({ tool }, { args: {} });
      expect(r.ok).toBe(true);
    }
  });

  it("does not crash on a missing/non-string tool name", async () => {
    const r = await callBefore(
      { tool: undefined as unknown as string },
      { args: {} },
    );
    expect(r.ok).toBe(true);
  });
});

// =====================================================================
// Audit log integration
// =====================================================================

describe("opencode plugin audit log", () => {
  it("appends a `consumed` record on successful raw-edit gate pass", async () => {
    writeFile("src/foo.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260503_0003",
      binding: [{ file: "src/foo.ts", before_sha256: sha256("before\n") }],
    });

    const r = await callBefore(
      { tool: "edit" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/foo.ts"),
          oldString: "before",
          newString: "after",
        },
      },
    );
    expect(r.ok).toBe(true);

    const log = new EditLog(tmpRoot);
    const entries = log.readAll();
    const consumed = entries.find(
      (e) => e.phase === "consumed" && e.edit_id === "edit_20260503_0003",
    );
    expect(consumed).toBeDefined();
    if (consumed && consumed.phase === "consumed") {
      expect(consumed.consuming_tool).toBe("Edit"); // canonical name
    }
  });
});

import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  createMetaEditPlugin,
  FALLBACK_ONBOARDING_POINTER,
  loadDefaultSkillContent,
  stripFrontmatter,
  summarizeReasonForOpencode,
  type OpencodeChatSystemTransformOutput,
  type OpencodePluginContext,
  type OpencodeToolBeforeInput,
  type OpencodeToolBeforeOutput,
} from "./plugin.js";
import { createGrantsStore } from "../state/grants.js";
import { EditLog } from "../state/edit-log.js";
import {
  makeTmpRoot,
  cleanTmpRoot,
  writeFileIn,
  sha256Hex,
  captureStderrAsync,
} from "../test-helpers.js";

let tmpRoot: string;
let ctx: OpencodePluginContext;

beforeEach(() => {
  tmpRoot = makeTmpRoot("opencode-plugin");
  fs.mkdirSync(path.join(tmpRoot, ".git"));
  ctx = { project: { worktree: tmpRoot } };
});

afterEach(() => {
  cleanTmpRoot(tmpRoot);
});

const sha256 = sha256Hex;

function writeFile(rel: string, content: string): string {
  return writeFileIn(tmpRoot, rel, content);
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

const captureStderr = captureStderrAsync;

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
// Review-fix coverage: R2 fallback / fail-closed / warn surfacing
// =====================================================================

describe("opencode plugin defensive paths (review fix)", () => {
  it("sets output.aborted = true on a deny throw (R2 fallback readiness)", async () => {
    const plugin = createMetaEditPlugin();
    const hooks = await plugin(ctx);
    const out: OpencodeToolBeforeOutput = {
      args: { input: "*** Update File: x" },
    };
    await expect(
      hooks["tool.execute.before"]?.({ tool: "apply_patch" }, out),
    ).rejects.toThrow();
    expect(out.aborted).toBe(true);
  });

  it("fail-closed denies when evaluateTokenedEdit throws unexpectedly", async () => {
    // Inject a grants store whose findActiveBindingForFile throws.
    const plugin = createMetaEditPlugin({
      newGrantsStore: () => ({
        async issue() {
          throw new Error("not used");
        },
        async lookup() {
          return null;
        },
        async consume() {
          return { consumed: false, fully_consumed: false };
        },
        async findActiveBindingForFile() {
          throw new Error("simulated grants store I/O error");
        },
        async reapExpired() {
          return 0;
        },
      }),
    });
    writeFile("src/foo.ts", "x\n");
    const hooks = await plugin(ctx);
    const out: OpencodeToolBeforeOutput = {
      args: {
        filePath: path.join(tmpRoot, "src/foo.ts"),
        oldString: "x",
        newString: "y",
      },
    };
    let caught: Error | null = null;
    try {
      await hooks["tool.execute.before"]?.({ tool: "edit" }, out);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain("meta-edit opencode plugin errored");
    expect(caught?.message).toContain("simulated grants store I/O error");
    expect(out.aborted).toBe(true);
  });

  it("emits warn decisions to stderr (empty Write create authorization)", async () => {
    const stderr = await captureStderr(async () => {
      const r = await callBefore(
        { tool: "write" },
        {
          args: {
            filePath: path.join(tmpRoot, "src/freshly-created.ts"),
            content: "",
          },
        },
      );
      expect(r.ok).toBe(true);
    });
    expect(stderr).toContain("[meta-edit] WARN");
    expect(stderr).toContain("Write");
    expect(stderr).toContain("typed_edit");
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

// =====================================================================
// summarizeReasonForOpencode (TUI render-bug mitigation)
// =====================================================================

// =====================================================================
// experimental.chat.system.transform — skill onboarding pointer
// =====================================================================

describe("experimental.chat.system.transform", () => {
  const FIXTURE_SKILL = "# fixture skill\n- catalog item one\n";

  it("pushes the bundled SKILL.md content into output.system on every chat call", async () => {
    const plugin = createMetaEditPlugin({ skillContent: FIXTURE_SKILL });
    const hooks = await plugin(ctx);
    const out: OpencodeChatSystemTransformOutput = { system: [] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "sess-1" },
      out,
    );
    expect(out.system.length).toBe(1);
    expect(out.system[0]).toBe(FIXTURE_SKILL);
  });

  it("preserves existing system entries (push, not replace)", async () => {
    const plugin = createMetaEditPlugin({ skillContent: FIXTURE_SKILL });
    const hooks = await plugin(ctx);
    const out: OpencodeChatSystemTransformOutput = {
      system: ["pre-existing system message from another plugin"],
    };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "sess-2" },
      out,
    );
    expect(out.system.length).toBe(2);
    expect(out.system[0]).toBe("pre-existing system message from another plugin");
    expect(out.system[1]).toBe(FIXTURE_SKILL);
  });

  it("fires per-message (no per-session dedup) — opencode rebuilds system per call", async () => {
    const plugin = createMetaEditPlugin({ skillContent: FIXTURE_SKILL });
    const hooks = await plugin(ctx);
    const out1: OpencodeChatSystemTransformOutput = { system: [] };
    const out2: OpencodeChatSystemTransformOutput = { system: [] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "sess-3" },
      out1,
    );
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "sess-3" },
      out2,
    );
    expect(out1.system.length).toBe(1);
    expect(out2.system.length).toBe(1);
  });

  it("uses the FALLBACK_ONBOARDING_POINTER when injected explicitly", async () => {
    const plugin = createMetaEditPlugin({
      skillContent: FALLBACK_ONBOARDING_POINTER,
    });
    const hooks = await plugin(ctx);
    const out: OpencodeChatSystemTransformOutput = { system: [] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "sess-fallback" },
      out,
    );
    expect(out.system[0]).toContain("meta-edit MCP server is registered");
    expect(out.system[0]).toContain("fallback mode");
  });
});

describe("FALLBACK_ONBOARDING_POINTER", () => {
  it("explains the typed_edit_* gate without depending on the SKILL.md", () => {
    expect(FALLBACK_ONBOARDING_POINTER).toContain("typed_edit_*");
    expect(FALLBACK_ONBOARDING_POINTER).toMatch(/edit \/ write \/ apply_patch/);
    expect(FALLBACK_ONBOARDING_POINTER).toContain("fallback mode");
  });

  it("is reasonably short — system-prompt entry, not full skill content", () => {
    expect(FALLBACK_ONBOARDING_POINTER.length).toBeLessThan(500);
  });
});

describe("stripFrontmatter", () => {
  it("removes a YAML frontmatter block at the start of the document", () => {
    const input =
      "---\nname: typed-edit-onboarding\ndescription: long ...\n---\n# Body\n\nrest";
    expect(stripFrontmatter(input)).toBe("# Body\n\nrest");
  });

  it("passes through unchanged when there is no frontmatter", () => {
    const input = "# Body\n\nno frontmatter here";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("does NOT eat past the close marker even if the body has --- horizontal rules", () => {
    const input =
      "---\nname: x\n---\n# Body\n\n---\n\nA horizontal rule above this line is part of the body.";
    expect(stripFrontmatter(input)).toContain("# Body");
    expect(stripFrontmatter(input)).toContain("horizontal rule");
  });

  it("handles CRLF line endings", () => {
    const input = "---\r\nname: x\r\n---\r\n# Body\r\n";
    expect(stripFrontmatter(input)).toBe("# Body\r\n");
  });

  it("returns input unchanged when an opening --- has no matching close", () => {
    const input = "---\nname: x\n# Body, no close";
    expect(stripFrontmatter(input)).toBe(input);
  });
});

describe("loadDefaultSkillContent", () => {
  it("loads the bundled SKILL.md and strips its frontmatter", () => {
    const content = loadDefaultSkillContent();
    expect(content.startsWith("---")).toBe(false);
    expect(content.startsWith("name: ")).toBe(false);
    expect(content).toContain("edit_cosmetic");
    expect(content).toContain("Selection heuristic");
  });
});

describe("summarizeReasonForOpencode", () => {
  it("keeps a short single-sentence reason as-is", () => {
    const r = "denied: not a thing";
    expect(summarizeReasonForOpencode(r)).toBe(r);
  });

  it("trims to the first sentence on a multi-sentence reason", () => {
    const r =
      'meta-edit denies raw "edit"; use a typed edit_* MCP tool. ' +
      "If the typed_edit tool schemas are not loaded in your tool list, " +
      "use ToolSearch to load them before declaring.";
    const out = summarizeReasonForOpencode(r);
    expect(out.endsWith("MCP tool.")).toBe(true);
    expect(out).not.toContain("ToolSearch");
  });

  it("strips backticks (opencode TUI renders inline-code spans badly)", () => {
    const r =
      "use ToolSearch (e.g. query `mcp meta-edit edit` " +
      "or `select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic`).";
    const out = summarizeReasonForOpencode(r);
    expect(out).not.toContain("`");
    expect(out).toContain("mcp meta-edit edit");
  });

  it("hard-caps at 160 chars with ellipsis when the first sentence is long", () => {
    const r = "x".repeat(300) + ".";
    const out = summarizeReasonForOpencode(r);
    expect(out.length).toBe(160);
    expect(out.endsWith("...")).toBe(true);
  });

  it("works on Japanese sentences (terminator: 。)", () => {
    const r = "宣言が見つかりませんでした。再度宣言してください。";
    const out = summarizeReasonForOpencode(r);
    expect(out).toBe("宣言が見つかりませんでした。");
  });

  it("squashes the canonical apply_patch deny to its first sentence", () => {
    // Anti-regression: real reason text from raw-edit-policy.ts
    // step 0a. The agent should still see "apply_patch" and
    // "unified-diff" in the squashed form.
    const r =
      'meta-edit denies "apply_patch": its unified-diff input has no ' +
      "top-level file_path to bind a typed_edit declaration against. " +
      "Use the opencode `edit` or `write` tool (which DO carry " +
      "file_path) after a typed_edit declaration, or invoke a typed " +
      "edit_* MCP tool directly.";
    const out = summarizeReasonForOpencode(r);
    expect(out).toContain("apply_patch");
    expect(out).toContain("unified-diff");
    expect(out).not.toContain("`");
    expect(out.length).toBeLessThanOrEqual(160);
  });
});

// =====================================================================
// tool.execute.after — write-allowed success reminder delivery
//
// Claude Code's deny-raw-edit hook returns the v0.6.2 write-allowed
// reminder as `additionalContext` on the allow. opencode's
// `tool.execute.before` has no allow-with-context channel, so the port
// stashes the reminder under the call's `callID` and appends it to the
// agent-visible tool result in `tool.execute.after`.
// =====================================================================

describe("tool.execute.after write-allowed reminder", () => {
  async function makeHooks() {
    return createMetaEditPlugin()(ctx);
  }

  it("appends the write-allowed reminder to the tool result when the consumed grant carries declaration metadata", async () => {
    writeFile("src/foo.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260522_0100",
      binding: [{ file: "src/foo.ts", before_sha256: sha256("before\n") }],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "accepted_artifact",
        target_file: "src/foo.ts",
        test_files: ["src/foo.test.ts"],
      },
    });

    const hooks = await makeHooks();
    await hooks["tool.execute.before"]?.(
      { tool: "edit", callID: "call-A" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/foo.ts"),
          oldString: "before",
          newString: "after",
        },
      },
    );

    const afterOutput = { output: "File edited successfully" };
    await hooks["tool.execute.after"]?.(
      { tool: "edit", callID: "call-A" },
      afterOutput,
    );

    // The original tool result is preserved...
    expect(afterOutput.output).toContain("File edited successfully");
    // ...and the write-allowed reminder is appended for the agent to read.
    expect(afterOutput.output).toContain("meta-edit reminder:");
    // The appended text is the real buildReminderContext output. The
    // write_allowed reminder is minimal post-trim — phaseLine names the
    // kind / target / file, scopeReviewLine nudges a kind-scope check,
    // and nothing else fires for this grant. That phaseLine substring
    // is enough to prove the grant's declaration metadata flowed through
    // evaluateTokenedEdit into the after-hook.
    expect(afterOutput.output).toContain(
      "edit_boundary_condition production-code declaration for src/foo.ts",
    );
    // Sanity: the trimmed write_allowed should NOT carry kindObligationsLine.
    expect(afterOutput.output).not.toContain(
      "pin just below, at, and just above the boundary",
    );
  });

  it("is a no-op when the after event's callID has no pending reminder", async () => {
    // tool.execute.after fires for every tool (read, grep, bash, ...);
    // the overwhelmingly common path is "no reminder stashed for this
    // call" and must leave the tool result untouched.
    const hooks = await makeHooks();
    const afterOutput = { output: "some unrelated tool result" };
    await hooks["tool.execute.after"]?.(
      { tool: "read", callID: "never-seen" },
      afterOutput,
    );
    expect(afterOutput.output).toBe("some unrelated tool result");
  });

  it("does not append a reminder when the consumed grant has no declaration metadata", async () => {
    // Back-compat: a pre-v0.6.2 grant has no declaration block, so
    // evaluateTokenedEdit returns allow WITHOUT additionalContext and
    // nothing should be stashed or appended.
    writeFile("src/foo.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260522_0101",
      binding: [{ file: "src/foo.ts", before_sha256: sha256("before\n") }],
    });

    const hooks = await makeHooks();
    await hooks["tool.execute.before"]?.(
      { tool: "edit", callID: "call-B" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/foo.ts"),
          oldString: "before",
          newString: "after",
        },
      },
    );

    const afterOutput = { output: "File edited successfully" };
    await hooks["tool.execute.after"]?.(
      { tool: "edit", callID: "call-B" },
      afterOutput,
    );
    expect(afterOutput.output).toBe("File edited successfully");
  });

  it("mirrors the reminder to stderr when the before-event carries no callID to correlate", async () => {
    // Real opencode always sends `callID`; this guards the degraded-host
    // path. With no callID there is no `tool.execute.after` to target,
    // so the reminder is surfaced to stderr (operator-visible) instead
    // of being silently dropped — parity with the `warn` branch.
    writeFile("src/foo.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260522_0102",
      binding: [{ file: "src/foo.ts", before_sha256: sha256("before\n") }],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "accepted_artifact",
        target_file: "src/foo.ts",
        test_files: ["src/foo.test.ts"],
      },
    });

    const hooks = await makeHooks();
    const stderr = await captureStderr(async () => {
      await hooks["tool.execute.before"]?.(
        { tool: "edit" },
        {
          args: {
            filePath: path.join(tmpRoot, "src/foo.ts"),
            oldString: "before",
            newString: "after",
          },
        },
      );
    });
    expect(stderr).toContain("meta-edit");
    // Post-trim, write_allowed reminders no longer carry the
    // kindObligationsLine cue; the phaseLine substring is the kind-
    // bearing distinguisher.
    expect(stderr).toContain(
      "edit_boundary_condition production-code declaration for src/foo.ts",
    );
  });

  it("delivers each call's reminder to its own callID — no cross-talk between concurrent pending reminders", async () => {
    // Two edits are gated before either after-event fires. A degenerate
    // single-slot implementation would mis-deliver; this proves the
    // callID-keyed Map isolates them. The two grants use different
    // kinds so the reminders are unambiguously distinguishable —
    // phaseLine substrings, since the write_allowed reminder trims out
    // kindObligationsLine.
    writeFile("src/foo.ts", "foo-before\n");
    writeFile("src/bar.ts", "bar-before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260522_0200",
      binding: [{ file: "src/foo.ts", before_sha256: sha256("foo-before\n") }],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "accepted_artifact",
        target_file: "src/foo.ts",
        test_files: ["src/foo.test.ts"],
      },
    });
    await grants.issue({
      edit_id: "edit_20260522_0201",
      binding: [{ file: "src/bar.ts", before_sha256: sha256("bar-before\n") }],
      declaration: {
        kind: "edit_error_handling",
        target: "prod",
        provenance: "accepted_artifact",
        target_file: "src/bar.ts",
        test_files: ["src/bar.test.ts"],
      },
    });

    const hooks = await makeHooks();
    // Two before-events stash two distinct reminders.
    await hooks["tool.execute.before"]?.(
      { tool: "edit", callID: "call-foo" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/foo.ts"),
          oldString: "foo-before",
          newString: "foo-after",
        },
      },
    );
    await hooks["tool.execute.before"]?.(
      { tool: "edit", callID: "call-bar" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/bar.ts"),
          oldString: "bar-before",
          newString: "bar-after",
        },
      },
    );

    // Deliver in REVERSE order — call-bar's after first.
    const barOut = { output: "bar result" };
    await hooks["tool.execute.after"]?.(
      { tool: "edit", callID: "call-bar" },
      barOut,
    );
    const fooOut = { output: "foo result" };
    await hooks["tool.execute.after"]?.(
      { tool: "edit", callID: "call-foo" },
      fooOut,
    );

    // call-bar received the error-handling phaseLine — not boundary's.
    expect(barOut.output).toContain(
      "edit_error_handling production-code declaration for src/bar.ts",
    );
    expect(barOut.output).not.toContain("edit_boundary_condition");
    // call-foo received the boundary phaseLine — not error-handling's.
    expect(fooOut.output).toContain(
      "edit_boundary_condition production-code declaration for src/foo.ts",
    );
    expect(fooOut.output).not.toContain("edit_error_handling");
  });

  it("appends the execution_state repeating_failure cue when grant carries execution_state", async () => {
    // design §4.3 / plan Task 4.2: execution_state from the declaration
    // must flow through evaluateTokenedEdit → buildReminderContext → the
    // after-hook's appended output. "landed while" is the distinguishing
    // phrase produced by the repeating_failure + write_allowed branch.
    writeFile("src/baz.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260523_0300",
      binding: [{ file: "src/baz.ts", before_sha256: sha256("before\n") }],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "accepted_artifact",
        execution_state: "repeating_failure",
        target_file: "src/baz.ts",
        test_files: ["src/baz.test.ts"],
      },
    });

    const hooks = await makeHooks();
    await hooks["tool.execute.before"]?.(
      { tool: "edit", callID: "call-C" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/baz.ts"),
          oldString: "before",
          newString: "after",
        },
      },
    );

    const afterOutput = { output: "File edited successfully" };
    await hooks["tool.execute.after"]?.(
      { tool: "edit", callID: "call-C" },
      afterOutput,
    );

    expect(afterOutput.output).toContain("landed while");
  });

  it("forwards the target field to phaseLine (target=\"test\" rendered distinct from target=\"prod\")", async () => {
    // Post-trim, write_allowed reminders no longer carry kindObligationsLine,
    // so the per-target wording distinction lives only in phaseLine. This
    // still pins what we want: opencode passes the target field through
    // to the reminder builder, not just kind. target="test" produces a
    // `target="test"` substring; target="prod" produces `production-code`.
    writeFile("src/boundary.test.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260527_0010",
      binding: [{ file: "src/boundary.test.ts", before_sha256: sha256("before\n") }],
      declaration: {
        kind: "edit_boundary_condition",
        target: "test",
        provenance: "accepted_artifact",
        target_file: "src/boundary.test.ts",
        test_files: [],
      },
    });

    const hooks = await makeHooks();
    await hooks["tool.execute.before"]?.(
      { tool: "edit", callID: "call-test-target" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/boundary.test.ts"),
          oldString: "before",
          newString: "after",
        },
      },
    );

    const afterOutput = { output: "File edited successfully" };
    await hooks["tool.execute.after"]?.(
      { tool: "edit", callID: "call-test-target" },
      afterOutput,
    );

    // target="test" phaseLine wording (src/reminders/context.ts targetPhrase).
    expect(afterOutput.output).toContain('target="test"');
    // The target="prod" wording must NOT appear — would indicate target
    // was dropped or hard-coded.
    expect(afterOutput.output).not.toContain("production-code");
    // Codex review PR #99 (LOW): also pin that targetFollowupLine — the
    // multi-sentence "This test edit should exercise this same kind of
    // change..." prose — does NOT appear on write_allowed. Without this
    // assertion, reintroducing the targetFollowupLine on write_allowed
    // for target="test" would slip through the trim regression net.
    expect(afterOutput.output).not.toContain(
      "This test edit should exercise this same kind of change",
    );
  });

  it("emits the execution_state=\"recovery\" cue (distinct from repeating_failure)", async () => {
    // src/reminders/context.ts:249-256 — the recovery branch is kind-
    // agnostic and produces its own cue, separate from repeating_failure
    // (already covered above). Pins that opencode forwards every value
    // of execution_state, not only repeating_failure.
    writeFile("src/recover.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260527_0011",
      binding: [{ file: "src/recover.ts", before_sha256: sha256("before\n") }],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "accepted_artifact",
        execution_state: "recovery",
        target_file: "src/recover.ts",
        test_files: ["src/recover.test.ts"],
      },
    });

    const hooks = await makeHooks();
    await hooks["tool.execute.before"]?.(
      { tool: "edit", callID: "call-recover" },
      {
        args: {
          filePath: path.join(tmpRoot, "src/recover.ts"),
          oldString: "before",
          newString: "after",
        },
      },
    );

    const afterOutput = { output: "File edited successfully" };
    await hooks["tool.execute.after"]?.(
      { tool: "edit", callID: "call-recover" },
      afterOutput,
    );

    expect(afterOutput.output).toContain("I am in recovery");
    // The repeating_failure branch's distinguishing phrase must NOT appear.
    expect(afterOutput.output).not.toContain("landed while");
  });

  it("skips kindObligationsLine for workflow-axis kinds (edit_policy_change)", async () => {
    // src/reminders/context.ts:140-146 — workflow-axis kinds have no
    // entry in KIND_TARGET_OBLIGATIONS and kindObligationsLine returns
    // undefined for them. The phase line still names the kind so the
    // reader knows what was declared.
    writeFile("docs/policy-note.md", "before\n");
    const grants = createGrantsStore(tmpRoot);
    await grants.issue({
      edit_id: "edit_20260527_0012",
      binding: [{ file: "docs/policy-note.md", before_sha256: sha256("before\n") }],
      declaration: {
        kind: "edit_policy_change",
        provenance: "user_confirmed",
        target_file: "docs/policy-note.md",
        test_files: [],
      },
    });

    const hooks = await makeHooks();
    await hooks["tool.execute.before"]?.(
      { tool: "edit", callID: "call-policy" },
      {
        args: {
          filePath: path.join(tmpRoot, "docs/policy-note.md"),
          oldString: "before",
          newString: "after",
        },
      },
    );

    const afterOutput = { output: "File edited successfully" };
    await hooks["tool.execute.after"]?.(
      { tool: "edit", callID: "call-policy" },
      afterOutput,
    );

    expect(afterOutput.output).toContain("edit_policy_change");
    // No KIND_TARGET_OBLIGATIONS lookup for workflow-axis kinds — the
    // boundary obligation must not bleed through.
    expect(afterOutput.output).not.toContain(
      "pin just below, at, and just above the boundary",
    );
    expect(afterOutput.output).not.toContain(
      "pins the defined limits of the boundary",
    );
  });
});

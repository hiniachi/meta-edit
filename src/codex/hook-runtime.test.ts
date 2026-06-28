import { describe, expect, it } from "bun:test";

type CodexHookPayload =
  | {
      ok: true;
      value: {
        hookEventName: "PreToolUse" | "SessionStart";
        cwd?: string;
        toolName?: string;
        toolInput: Record<string, unknown>;
      };
    }
  | { ok: false; error: string };

type CodexHookDecision = {
  decision: "allow" | "deny" | "warn";
  reason?: string;
  additionalContext?: string;
};

type CodexHookRuntimeModule = {
  parseCodexHookPayload(payload: unknown): CodexHookPayload;
  renderCodexHookResponse(decision: CodexHookDecision): Record<string, unknown>;
};

async function loadCodexHookRuntime(): Promise<CodexHookRuntimeModule> {
  return (await import("./hook-runtime.js")) as CodexHookRuntimeModule;
}

const PATCH = [
  "*** Begin Patch",
  "*** Update File: src/foo.ts",
  "@@",
  "-old",
  "+new",
  "*** End Patch",
  "",
].join("\n");

describe("parseCodexHookPayload", () => {
  it("normalizes a Codex PreToolUse apply_patch payload", async () => {
    const { parseCodexHookPayload } = await loadCodexHookRuntime();

    const parsed = parseCodexHookPayload({
      hook_event_name: "PreToolUse",
      cwd: "/work/repo",
      tool_name: "apply_patch",
      tool_input: { patch: PATCH },
      session_id: "codex-session-1",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value).toEqual({
      hookEventName: "PreToolUse",
      cwd: "/work/repo",
      toolName: "apply_patch",
      toolInput: { patch: PATCH },
    });
  });

  it("normalizes a Codex SessionStart payload without tool fields", async () => {
    const { parseCodexHookPayload } = await loadCodexHookRuntime();

    const parsed = parseCodexHookPayload({
      hook_event_name: "SessionStart",
      cwd: "/work/repo",
      session_id: "codex-session-2",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value).toEqual({
      hookEventName: "SessionStart",
      cwd: "/work/repo",
      toolInput: {},
    });
  });

  it("rejects malformed PreToolUse payloads fail-closed", async () => {
    const { parseCodexHookPayload } = await loadCodexHookRuntime();

    const missingToolName = parseCodexHookPayload({
      hook_event_name: "PreToolUse",
      tool_input: { patch: PATCH },
    });
    expect(missingToolName.ok).toBe(false);
    if (!missingToolName.ok) expect(missingToolName.error).toMatch(/tool_name/);

    const nonObjectToolInput = parseCodexHookPayload({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: "*** not an object ***",
    });
    expect(nonObjectToolInput.ok).toBe(false);
    if (!nonObjectToolInput.ok) {
      expect(nonObjectToolInput.error).toMatch(/tool_input/);
    }
  });
});

describe("renderCodexHookResponse", () => {
  it("renders an internal deny as Codex block without Claude hookSpecificOutput", async () => {
    const { renderCodexHookResponse } = await loadCodexHookRuntime();

    const response = renderCodexHookResponse({
      decision: "deny",
      reason: "missing typed_edit declaration",
    });

    expect(response).toEqual({
      decision: "block",
      reason: "missing typed_edit declaration",
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
  });

  it("renders a reason-less deny as a block carrying a non-empty fallback reason", async () => {
    // Observed from src/codex/hook-runtime.ts renderCodexHookResponse: a deny
    // with no reason copies `reason` only when defined, so the block goes out
    // with no reason key. Codex rejects a block lacking a non-empty reason
    // ("hook returned decision:block without a non-empty reason"), so such a
    // block can fail OPEN. A reason-less deny must still carry a fallback.
    const { renderCodexHookResponse } = await loadCodexHookRuntime();

    const response = renderCodexHookResponse({ decision: "deny" });

    expect(response.decision).toBe("block");
    expect(typeof response.reason).toBe("string");
    expect((response.reason as string).length).toBeGreaterThan(0);
    expect(response).not.toHaveProperty("hookSpecificOutput");

    const emptyReason = renderCodexHookResponse({ decision: "deny", reason: "" });
    expect(emptyReason.decision).toBe("block");
    expect(typeof emptyReason.reason).toBe("string");
    expect((emptyReason.reason as string).length).toBeGreaterThan(0);
    expect(emptyReason).not.toHaveProperty("hookSpecificOutput");
  });

  it("renders an internal warning as model-visible context without unsupported Codex warn decision", async () => {
    const { renderCodexHookResponse } = await loadCodexHookRuntime();

    const response = renderCodexHookResponse({
      decision: "warn",
      reason: "empty create is allowed; classify the content fill",
      additionalContext: "declare the content fill before writing bytes",
    });

    expect(response).toEqual({
      additional_context: expect.stringContaining(
        "empty create is allowed; classify the content fill",
      ),
    });
    expect(response["additional_context"]).toEqual(
      expect.stringContaining("declare the content fill before writing bytes"),
    );
    expect(response).not.toHaveProperty("decision");
    expect(response).not.toHaveProperty("reason");
  });

  it("renders silent allow as an empty object and allow-context without forcing approval", async () => {
    const { renderCodexHookResponse } = await loadCodexHookRuntime();

    expect(renderCodexHookResponse({ decision: "allow" })).toEqual({});
    expect(
      renderCodexHookResponse({
        decision: "allow",
        additionalContext: "this apply_patch matched my typed declaration",
      }),
    ).toEqual({
      additional_context: "this apply_patch matched my typed declaration",
    });
  });
});

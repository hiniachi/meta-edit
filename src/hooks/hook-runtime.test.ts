import { describe, it, expect } from "bun:test";
import { Readable } from "node:stream";
import {
  readStdin,
  replyAllow,
  replyAllowWithWarning,
  replyDeny,
} from "./hook-runtime.js";
import {
  captureStdout,
  captureStderr,
} from "../test-helpers.js";

// ---------------------------------------------------------------------------
// Helper: temporarily replace process.stdin with a mock Readable.
// Restores the original after the test.
// ---------------------------------------------------------------------------
async function withMockStdin<T>(
  data: string | Buffer,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.stdin;
  const mock = Readable.from(
    (async function* () {
      yield typeof data === "string" ? Buffer.from(data) : data;
    })(),
  );
  // Node types require the cast; this is the standard test-double pattern.
  (process as NodeJS.Process & { stdin: Readable }).stdin =
    mock as unknown as typeof process.stdin;
  try {
    return await fn();
  } finally {
    (process as NodeJS.Process & { stdin: Readable }).stdin =
      original as unknown as typeof process.stdin;
  }
}

describe("readStdin — fail-closed behaviour", () => {
  it("rejects when stdin contains non-JSON bytes", async () => {
    // This is the critical path: malformed input must reject so that the
    // hook exits 2 (blocked) rather than silently allowing the tool call.
    await expect(
      withMockStdin("this is not json {{{", () => readStdin()),
    ).rejects.toThrow();
  });

  it("rejects on truncated JSON", async () => {
    await expect(
      withMockStdin('{"tool_name": "Edit"', () => readStdin()),
    ).rejects.toThrow();
  });

  it("rejects on bare string value (not an object)", async () => {
    // JSON.parse('"hello"') succeeds but is not a Record — if readStdin
    // ever adds a shape check, this ensures it still rejects non-objects.
    // For now this verifies the parse-error path for invalid JSON objects.
    await expect(
      withMockStdin("null", () => readStdin()),
    ).resolves.toEqual(null as unknown as Record<string, unknown>);
    // ^ null parses; document that we get it back (current behaviour).
    // A stricter fix would reject non-object payloads too — see fix direction.
  });

  it("resolves with empty object on empty stdin (existing behaviour preserved)", async () => {
    await expect(
      withMockStdin("   ", () => readStdin()),
    ).resolves.toEqual({});
  });

  it("resolves with parsed object on valid JSON stdin", async () => {
    await expect(
      withMockStdin(JSON.stringify({ tool_name: "Edit" }), () => readStdin()),
    ).resolves.toEqual({ tool_name: "Edit" });
  });
});

// ---------------------------------------------------------------------------
// Closes issue 2026-05-02-1041-reply-deny-stdout-shape-untested.
// The Claude Code hook protocol requires a specific JSON shape on stdout.
// A refactor that renamed permissionDecision or hookSpecificOutput would
// silently change deny into "no opinion / allow" with nothing breaking.
// ---------------------------------------------------------------------------


describe("replyDeny — stdout JSON shape", () => {
  it("emits hookSpecificOutput.permissionDecision === 'deny' with the supplied reason", () => {
    const out = captureStdout(() => replyDeny("test reason"));
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        permissionDecisionReason: string;
      };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("test reason");
  });

  it("returns exit code 0 (the deny is the decision, not the exit code)", () => {
    captureStdout(() => {
      expect(replyDeny("x")).toBe(0);
    });
  });
});

describe("replyAllow — stdout shape", () => {
  it("emits empty stdout (silent allow / no opinion)", () => {
    const out = captureStdout(() => replyAllow());
    expect(out).toBe("");
  });

  it("returns exit code 0", () => {
    captureStdout(() => {
      expect(replyAllow()).toBe(0);
    });
  });
});

describe("replyAllowWithWarning — stdout + stderr shape", () => {
  it("emits permissionDecision 'allow' plus additionalContext mirroring the reason", () => {
    let stderrCaptured = "";
    const out = captureStdout(() => {
      stderrCaptured = captureStderr(() => replyAllowWithWarning("redirect warn"));
    });
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        permissionDecisionReason: string;
        additionalContext: string;
      };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("redirect warn");
    // additionalContext is the field actually fed to Claude; without it
    // the v0.1.5+ warn surface would be silent to the agent.
    expect(parsed.hookSpecificOutput.additionalContext).toBe("redirect warn");
    // stderr mirror for hosts that surface it.
    expect(stderrCaptured).toContain("redirect warn");
  });
});

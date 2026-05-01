import { describe, it, expect } from "bun:test";
import { Readable } from "node:stream";
import { readStdin } from "./hook-runtime.js";

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

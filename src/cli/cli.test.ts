import { describe, it, expect } from "bun:test";
import { main } from "../cli.js";

// ---------------------------------------------------------------------------
// In-process helper: pass mock argv/stdout/stderr to the exported `main`.
// This pins both:
//   1. That `main` is exported (a refactor away from a subprocess test).
//   2. That the unknown-subcommand exit-code contract (Unix EX_USAGE = 64)
//      is preserved.
// ---------------------------------------------------------------------------

type CapturedRun = { code: number; stdout: string; stderr: string };

async function runMain(args: string[]): Promise<CapturedRun> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (
    s: string,
  ) => {
    stdoutChunks.push(s);
    return true;
  };
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (
    s: string,
  ) => {
    stderrChunks.push(s);
    return true;
  };
  try {
    const code = await main(["bun", "meta-edit", ...args]);
    return { code, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
  } finally {
    (process.stdout as unknown as { write: typeof origStdoutWrite }).write =
      origStdoutWrite;
    (process.stderr as unknown as { write: typeof origStderrWrite }).write =
      origStderrWrite;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cli unknown subcommand", () => {
  it("exits with code 64 (EX_USAGE)", async () => {
    const { code } = await runMain(["bogus"]);
    expect(code).toBe(64);
  });

  it("writes a useful error to stderr", async () => {
    const { stderr } = await runMain(["bogus"]);
    expect(stderr).toContain("unknown subcommand");
    expect(stderr).toContain("bogus");
  });

  it("includes help text when the subcommand is unknown", async () => {
    const { stdout } = await runMain(["bogus"]);
    expect(stdout).toContain("Usage:");
  });
});

describe("cli help / version", () => {
  it("--help exits 0 and prints usage", async () => {
    const { code, stdout } = await runMain(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  it("--version exits 0 and prints meta-edit <version>", async () => {
    const { code, stdout } = await runMain(["--version"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^meta-edit \S+/);
  });
});

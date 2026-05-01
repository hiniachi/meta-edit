import { describe, it, expect } from "bun:test";
import { main } from "../cli.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

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

// ---------------------------------------------------------------------------
// Issue #36 follow-up (P1 codex review): isMainModule symlink regression.
//
// `package.json` declares `"bin": { "meta-edit": "dist/cli.js" }`, so the
// usual installation path under npm/bun creates a symlink in
// `node_modules/.bin/meta-edit` (or globally under
// `<bin-dir>/meta-edit`) pointing at the real `dist/cli.js`. When the
// user runs `meta-edit --version`, Node sees the symlink as
// `process.argv[1]` but resolves it to its real path before computing
// `import.meta.url`. The previous `isMainModule` check compared raw
// `argv[1]` URL vs `import.meta.url` and always returned false in that
// case, silently no-op'ing the CLI.
//
// This test exercises the real install layout: it builds the CLI to
// dist/, places a symlink in a temp dir pointing at dist/cli.js, and
// invokes the symlink. Pre-fix: stdout is empty (the bug). Post-fix:
// `meta-edit <version>` is printed.
// ---------------------------------------------------------------------------
describe("cli main-module detection via symlinked bin", () => {
  it("prints version when invoked through a symlinked bin", () => {
    const repoRoot = path.resolve(import.meta.dir, "..", "..");
    const distCli = path.join(repoRoot, "dist", "cli.js");
    if (!fs.existsSync(distCli)) {
      throw new Error(
        `dist/cli.js not found at ${distCli}; run 'bun run build' before 'bun test' so the symlink-bin regression test can exercise the published entry point.`,
      );
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-bin-"));
    try {
      const symlinkPath = path.join(tmpDir, "meta-edit");
      fs.symlinkSync(distCli, symlinkPath);
      // Use Node (not Bun) because Node's ESM loader resolves the
      // symlink before computing `import.meta.url`. This is precisely
      // the production install scenario; bun happens to canonicalize
      // process.argv[1] differently and would mask the regression.
      const stdout = execFileSync("node", [symlinkPath, "--version"], {
        encoding: "utf8",
      });
      expect(stdout).toMatch(/^meta-edit \S+/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

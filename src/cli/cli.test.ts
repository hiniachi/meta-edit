import { describe, it, expect } from "bun:test";
import { main } from "../cli.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeTmpRoot, cleanTmpRoot } from "../test-helpers.js";

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

describe("cli log subcommand dispatch", () => {
  it("runs log with no filters and exits 0", async () => {
    const tmpDir = makeTmpRoot("cli-log");
    fs.mkdirSync(path.join(tmpDir, ".meta-edit", "state"), { recursive: true });
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { code } = await runMain(["log"]);
      expect(code).toBe(0);
    } finally {
      process.chdir(origCwd);
      cleanTmpRoot(tmpDir);
    }
  });

  it("returns 64 on invalid log flag", async () => {
    const { code, stderr } = await runMain(["log", "--bogus"]);
    expect(code).toBe(64);
    expect(stderr).toContain("meta-edit log:");
  });
});

describe("cli summary subcommand dispatch", () => {
  it("runs summary and exits 0", async () => {
    const tmpDir = makeTmpRoot("cli-sum");
    fs.mkdirSync(path.join(tmpDir, ".meta-edit", "state"), { recursive: true });
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { code } = await runMain(["summary"]);
      expect(code).toBe(0);
    } finally {
      process.chdir(origCwd);
      cleanTmpRoot(tmpDir);
    }
  });

  it("returns 64 on invalid summary flag", async () => {
    const { code, stderr } = await runMain(["summary", "--bogus"]);
    expect(code).toBe(64);
    expect(stderr).toContain("meta-edit summary:");
  });
});

describe("cli install-hooks dispatch", () => {
  it("returns 64 when --scope is missing", async () => {
    const { code, stderr } = await runMain(["install-hooks"]);
    expect(code).toBe(64);
    expect(stderr).toContain("meta-edit install-hooks:");
  });

  it("installs hooks with --scope project", async () => {
    const tmpDir = makeTmpRoot("cli-hooks");
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { code } = await runMain(["install-hooks", "--scope", "project"]);
      expect(code).toBe(0);
    } finally {
      process.chdir(origCwd);
      cleanTmpRoot(tmpDir);
    }
  });
});

describe("cli uninstall-hooks dispatch", () => {
  it("returns 64 when --scope is missing", async () => {
    const { code, stderr } = await runMain(["uninstall-hooks"]);
    expect(code).toBe(64);
    expect(stderr).toContain("meta-edit uninstall-hooks:");
  });

  it("uninstalls hooks with --scope project", async () => {
    const tmpDir = makeTmpRoot("cli-unhooks");
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { code } = await runMain(["uninstall-hooks", "--scope", "project"]);
      expect(code).toBe(0);
    } finally {
      process.chdir(origCwd);
      cleanTmpRoot(tmpDir);
    }
  });
});

describe("cli install-opencode dispatch", () => {
  it("returns 64 when --scope is missing", async () => {
    const { code, stderr } = await runMain(["install-opencode"]);
    expect(code).toBe(64);
    expect(stderr).toContain("meta-edit install-opencode:");
  });

  it("installs opencode config with --scope project", async () => {
    const tmpDir = makeTmpRoot("cli-oc-install");
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { code } = await runMain(["install-opencode", "--scope", "project"]);
      expect(code).toBe(0);
    } finally {
      process.chdir(origCwd);
      cleanTmpRoot(tmpDir);
    }
  });
});

describe("cli uninstall-opencode dispatch", () => {
  it("returns 64 when --scope is missing", async () => {
    const { code, stderr } = await runMain(["uninstall-opencode"]);
    expect(code).toBe(64);
    expect(stderr).toContain("meta-edit uninstall-opencode:");
  });

  it("uninstalls opencode config with --scope project", async () => {
    const tmpDir = makeTmpRoot("cli-oc-uninstall");
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { code } = await runMain(["uninstall-opencode", "--scope", "project"]);
      expect(code).toBe(0);
    } finally {
      process.chdir(origCwd);
      cleanTmpRoot(tmpDir);
    }
  });
});

describe("cli install-codex dispatch", () => {
  it("returns 64 when --scope is missing", async () => {
    const { code, stderr } = await runMain(["install-codex"]);
    expect(code).toBe(64);
    expect(stderr).toContain("meta-edit install-codex:");
  });

  it("installs Codex config with --scope project", async () => {
    const tmpDir = makeTmpRoot("cli-codex-install");
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { code } = await runMain(["install-codex", "--scope", "project"]);
      expect(code).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, ".codex", "config.toml"))).toBe(true);
    } finally {
      process.chdir(origCwd);
      cleanTmpRoot(tmpDir);
    }
  });
});

describe("cli uninstall-codex dispatch", () => {
  it("returns 64 when --scope is missing", async () => {
    const { code, stderr } = await runMain(["uninstall-codex"]);
    expect(code).toBe(64);
    expect(stderr).toContain("meta-edit uninstall-codex:");
  });

  it("uninstalls Codex config with --scope project", async () => {
    const tmpDir = makeTmpRoot("cli-codex-uninstall");
    const codexDir = path.join(tmpDir, ".codex");
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexDir, "config.toml"),
      [
        'model = "gpt-5.5"',
        "",
        "# meta-edit managed Codex hooks",
        'command = "meta-edit-codex-deny-raw-edit"',
        'command = "meta-edit-codex-session-onboarding"',
        "",
      ].join("\n"),
      "utf8",
    );
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { code } = await runMain(["uninstall-codex", "--scope", "project"]);
      expect(code).toBe(0);
      const text = fs.readFileSync(path.join(codexDir, "config.toml"), "utf8");
      expect(text).toContain('model = "gpt-5.5"');
      expect(text).not.toContain("meta-edit-codex-deny-raw-edit");
      expect(text).not.toContain("meta-edit-codex-session-onboarding");
    } finally {
      process.chdir(origCwd);
      cleanTmpRoot(tmpDir);
    }
  });
});

describe("cli help with tool argument", () => {
  it("renders full description for a valid tool name", async () => {
    const { code, stdout } = await runMain(["help", "edit_boundary_condition"]);
    expect(code).toBe(0);
    expect(stdout).toContain("edit_boundary_condition");
  });

  it("returns 64 for an unknown tool name", async () => {
    const { code, stderr } = await runMain(["help", "edit_nonexistent"]);
    expect(code).toBe(64);
    expect(stderr.length).toBeGreaterThan(0);
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
        [
          `dist/cli.js not found at ${distCli}; run 'bun run build'`,
          "before 'bun test' so the symlink-bin regression test can",
          "exercise the published entry point.",
        ].join(" "),
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
      const result = Bun.spawnSync({
        cmd: ["node", symlinkPath, "--version"],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      expect(new TextDecoder().decode(result.stderr)).toBe("");
      const stdout = new TextDecoder().decode(result.stdout);
      expect(stdout).toMatch(/^meta-edit \S+/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

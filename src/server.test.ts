import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { Readable, PassThrough } from "node:stream";
import { createServer, runStdioServer } from "./server.js";
import { makeTmpRoot, cleanTmpRoot, captureStderr } from "./test-helpers.js";

function mkGitRepo(): string {
  const dir = makeTmpRoot("srv-repo");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

function mkJjRepo(): string {
  const dir = makeTmpRoot("srv-jjrepo");
  fs.mkdirSync(path.join(dir, ".jj"), { recursive: true });
  return dir;
}

function mkBareDir(): string {
  return makeTmpRoot("srv-bare");
}

// ---------------------------------------------------------------------------
// 1530 — createServer must NOT eager-throw on a non-repo directory.
//
// The eager throw used to kill the MCP server before transport handshake.
// Claude Code marked the server as failed for the session and the eighteen
// tool descriptions never reached the running agent's context. The fix
// (Bundle A) moves the check into validateRequest at per-tool-call time;
// createServer only emits an advisory stderr line.
// ---------------------------------------------------------------------------

describe("createServer repoRoot validation", () => {
  let gitRepo: string;
  let jjRepo: string;
  let bareDir: string;

  beforeAll(() => {
    gitRepo = mkGitRepo();
    jjRepo = mkJjRepo();
    bareDir = mkBareDir();
  });

  afterAll(() => {
    cleanTmpRoot(gitRepo);
    cleanTmpRoot(jjRepo);
    cleanTmpRoot(bareDir);
  });

  it("succeeds when repoRoot contains a .git directory", () => {
    expect(() => createServer({ repoRoot: gitRepo })).not.toThrow();
  });

  it("succeeds when repoRoot contains a .jj directory", () => {
    expect(() => createServer({ repoRoot: jjRepo })).not.toThrow();
  });

  it("does NOT throw on a non-repo directory (issue 1530 — lazy check)", () => {
    const stderrBuf = captureStderr(() => {
      expect(() => createServer({ repoRoot: bareDir })).not.toThrow();
    });
    expect(stderrBuf).toContain("does not appear to be a repository root");
  });

  it("does NOT throw on a freshly-created tmp dir with no sentinel", () => {
    const isolatedTmp = makeTmpRoot("srv-notrepo");
    try {
      captureStderr(() => {
        expect(() => createServer({ repoRoot: isolatedTmp })).not.toThrow();
      });
    } finally {
      cleanTmpRoot(isolatedTmp);
    }
  });

  it("returns a Server instance with request handlers registered", () => {
    const server = createServer({ repoRoot: gitRepo });
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  it("defaults repoRoot to process.cwd() when no options provided", () => {
    const origCwd = process.cwd();
    process.chdir(gitRepo);
    try {
      const stderrBuf = captureStderr(() => {
        expect(() => createServer()).not.toThrow();
      });
      expect(stderrBuf).not.toContain("does not appear to be");
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ---------------------------------------------------------------------------
// Repository-root resolution precedence:
//   options.repoRoot → $META_EDIT_REPO_ROOT → process.cwd()
//
// createServer does not return the resolved root, so we observe it via
// the repo-validity advisory stderr line (a bare dir warns; a dir with
// a .git/.jj sentinel does not). This must stay in lockstep with the
// hooks' resolveRepoRoot, hence the explicit precedence tests.
// ---------------------------------------------------------------------------

describe("createServer repoRoot resolution precedence", () => {
  let gitRepo: string;
  let bareDir: string;
  let origEnv: string | undefined;

  beforeAll(() => {
    gitRepo = mkGitRepo();
    bareDir = mkBareDir();
  });

  afterAll(() => {
    cleanTmpRoot(gitRepo);
    cleanTmpRoot(bareDir);
  });

  beforeEach(() => {
    origEnv = process.env["META_EDIT_REPO_ROOT"];
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env["META_EDIT_REPO_ROOT"];
    } else {
      process.env["META_EDIT_REPO_ROOT"] = origEnv;
    }
  });

  it("honors $META_EDIT_REPO_ROOT when no option is provided", () => {
    process.env["META_EDIT_REPO_ROOT"] = gitRepo;
    const origCwd = process.cwd();
    process.chdir(bareDir);
    try {
      const stderrBuf = captureStderr(() => {
        expect(() => createServer()).not.toThrow();
      });
      expect(stderrBuf).not.toContain("does not appear to be");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("explicit options.repoRoot wins over $META_EDIT_REPO_ROOT", () => {
    process.env["META_EDIT_REPO_ROOT"] = bareDir;
    const stderrBuf = captureStderr(() => {
      expect(() => createServer({ repoRoot: gitRepo })).not.toThrow();
    });
    expect(stderrBuf).not.toContain("does not appear to be");
  });

  it("$META_EDIT_REPO_ROOT takes precedence over process.cwd()", () => {
    process.env["META_EDIT_REPO_ROOT"] = bareDir;
    const origCwd = process.cwd();
    process.chdir(gitRepo);
    try {
      const stderrBuf = captureStderr(() => {
        expect(() => createServer()).not.toThrow();
      });
      expect(stderrBuf).toContain("does not appear to be a repository root");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("falls back to process.cwd() when neither option nor env is set", () => {
    delete process.env["META_EDIT_REPO_ROOT"];
    const origCwd = process.cwd();
    process.chdir(gitRepo);
    try {
      const stderrBuf = captureStderr(() => {
        expect(() => createServer()).not.toThrow();
      });
      expect(stderrBuf).not.toContain("does not appear to be");
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ---------------------------------------------------------------------------
// runStdioServer — subprocess integration test
//
// Spawns `bun src/server.ts` (which invokes runStdioServer via the module-
// level guard in cli.ts), sends an MCP JSON-RPC `initialize` request on
// stdin, asserts a valid response, then closes stdin so the stdin 'end'
// handler fires transport.close() and the process exits cleanly.
// This covers lines 54-71 of server.ts that are unreachable from in-process
// unit tests because StdioServerTransport grabs the real stdin/stdout.
// ---------------------------------------------------------------------------

describe("runStdioServer — stdio integration", () => {
  it("responds to MCP initialize and exits cleanly on stdin EOF", async () => {
    const repoDir = mkGitRepo();
    try {
      const child = spawn("bun", ["run", "src/cli.ts", "serve"], {
        cwd: path.resolve(import.meta.dir, ".."),
        env: { ...process.env, META_EDIT_REPO_ROOT: repoDir },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const initializeRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.0" },
        },
      });

      const stdout = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("timeout waiting for MCP initialize response"));
        }, 10_000);

        let buf = "";
        child.stdout!.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          if (buf.includes("\n")) {
            clearTimeout(timer);
            resolve(buf);
          }
        });

        child.stderr!.on("data", () => {});

        child.stdin!.write(initializeRequest + "\n");
      });

      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const response = JSON.parse(lines[0]!);
      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(1);
      expect(response.result).toBeDefined();
      expect(response.result.serverInfo.name).toBe("meta-edit");

      // Close stdin to trigger the shutdown path (L58-62).
      child.stdin!.end();

      const exitCode = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(null);
        }, 5_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      expect(exitCode).toBe(0);
    } finally {
      cleanTmpRoot(repoDir);
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// runStdioServer — in-process test (for coverage instrumentation)
//
// bun's coverage counter only tracks code executed in the same process.
// The subprocess test above validates behavior but the coverage report
// still shows lines 54-71 as uncovered. This test replaces process.stdin
// and process.stdout with mock streams so runStdioServer executes in-
// process, then sends an MCP initialize + stdin EOF to drive the shutdown.
// ---------------------------------------------------------------------------

describe("runStdioServer — in-process coverage", () => {
  it("connects, serves initialize, and exits on stdin EOF", async () => {
    const repoDir = mkGitRepo();

    const origStdin = process.stdin;
    const origStdout = process.stdout;

    const mockStdin = new PassThrough();
    const stdoutChunks: Buffer[] = [];
    const mockStdout = new PassThrough();
    mockStdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

    Object.defineProperty(process, "stdin", {
      value: mockStdin,
      configurable: true,
    });
    Object.defineProperty(process, "stdout", {
      value: mockStdout,
      configurable: true,
    });

    try {
      const serverDone = runStdioServer({ repoRoot: repoDir });

      // Give the server a tick to wire up the transport.
      await new Promise((r) => setTimeout(r, 100));

      // Send MCP initialize.
      const initMsg = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      });
      mockStdin.write(initMsg + "\n");

      // Wait for the response.
      await new Promise((r) => setTimeout(r, 200));

      // Close stdin to trigger the shutdown path.
      mockStdin.end();

      // runStdioServer should resolve once transport.onclose fires.
      await Promise.race([
        serverDone,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5_000),
        ),
      ]);

      const output = Buffer.concat(stdoutChunks).toString("utf8");
      const lines = output.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const response = JSON.parse(lines[0]!);
      expect(response.result?.serverInfo?.name).toBe("meta-edit");
    } finally {
      Object.defineProperty(process, "stdin", {
        value: origStdin,
        configurable: true,
      });
      Object.defineProperty(process, "stdout", {
        value: origStdout,
        configurable: true,
      });
      cleanTmpRoot(repoDir);
    }
  }, 10_000);
});

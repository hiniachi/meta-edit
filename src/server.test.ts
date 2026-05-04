import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createServer } from "./server.js";
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

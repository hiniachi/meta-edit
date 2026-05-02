import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer } from "./server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmpDir(suffix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `meta-edit-srv-${suffix}-`));
}

// A directory that looks like a git repo (has a .git sentinel).
function mkGitRepo(): string {
  const dir = mkTmpDir("repo");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

// A directory that looks like a jj repo.
function mkJjRepo(): string {
  const dir = mkTmpDir("jjrepo");
  fs.mkdirSync(path.join(dir, ".jj"), { recursive: true });
  return dir;
}

// A directory with no repo sentinel.
function mkBareDir(): string {
  return mkTmpDir("bare");
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
    fs.rmSync(gitRepo, { recursive: true, force: true });
    fs.rmSync(jjRepo, { recursive: true, force: true });
    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it("succeeds when repoRoot contains a .git directory", () => {
    expect(() => createServer({ repoRoot: gitRepo })).not.toThrow();
  });

  it("succeeds when repoRoot contains a .jj directory", () => {
    expect(() => createServer({ repoRoot: jjRepo })).not.toThrow();
  });

  it("does NOT throw on a non-repo directory (issue 1530 — lazy check)", () => {
    // Capture stderr to avoid the advisory line bleeding into test output.
    const origWrite = process.stderr.write.bind(process.stderr);
    let stderrBuf = "";
    (process.stderr as unknown as { write: (s: string) => boolean }).write = (
      s: string,
    ) => {
      stderrBuf += s;
      return true;
    };
    try {
      expect(() => createServer({ repoRoot: bareDir })).not.toThrow();
      // The advisory must still surface so the operator sees the
      // misconfiguration without waiting for the first failed call.
      expect(stderrBuf).toContain("does not appear to be a repository root");
    } finally {
      (process.stderr as unknown as { write: typeof origWrite }).write =
        origWrite;
    }
  });

  it("does NOT throw on a freshly-created tmp dir with no sentinel", () => {
    // Mirrors the production onboarding flow described in issue 1530:
    // user starts Claude Code in a fresh dir, MCP server connects.
    // We must reach ListTools (so descriptions land); per-tool calls
    // get rejected later by validateRequest, not by a synchronous throw
    // in createServer.
    const isolatedTmp = fs.mkdtempSync(
      path.join(os.tmpdir(), "meta-edit-srv-notrepo-"),
    );
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: (s: string) => boolean }).write =
      () => true;
    try {
      expect(() => createServer({ repoRoot: isolatedTmp })).not.toThrow();
    } finally {
      (process.stderr as unknown as { write: typeof origWrite }).write =
        origWrite;
      fs.rmSync(isolatedTmp, { recursive: true, force: true });
    }
  });
});

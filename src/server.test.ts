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
// a7-03 — createServer must reject non-repo directories
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

  it("throws a descriptive error when repoRoot has no repo sentinel", () => {
    expect(() => createServer({ repoRoot: bareDir })).toThrow(
      /not a (git )?repository|no \.git|repo sentinel/i,
    );
  });

  it("throws when repoRoot is a freshly-created tmp dir with no sentinel", () => {
    // Do NOT pass `os.tmpdir()` directly: on some hosts `/tmp/.git` exists
    // (CI sandboxes, dev fixtures), which would make `assertIsRepo` succeed
    // and silently mask the regression.  A fresh `mkdtempSync` subdir under
    // tmpdir is guaranteed to have no `.git`/`.jj` of its own; `assertIsRepo`
    // only checks the immediate dir (it does not walk up), so this isolates
    // the test from any sentinels at higher levels.
    const isolatedTmp = fs.mkdtempSync(
      path.join(os.tmpdir(), "meta-edit-srv-notrepo-"),
    );
    try {
      expect(() => createServer({ repoRoot: isolatedTmp })).toThrow(
        /not a (git )?repository|no \.git|repo sentinel/i,
      );
    } finally {
      fs.rmSync(isolatedTmp, { recursive: true, force: true });
    }
  });
});

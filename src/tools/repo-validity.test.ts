import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { repoIsValid, assertIsRepo } from "./repo-validity.js";
import { makeTmpRoot, cleanTmpRoot } from "../test-helpers.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = makeTmpRoot("repo-validity");
});

afterEach(() => {
  cleanTmpRoot(tmpRoot);
});

describe("repoIsValid", () => {
  it("returns ok=true when .git exists", () => {
    fs.mkdirSync(path.join(tmpRoot, ".git"));
    expect(repoIsValid(tmpRoot)).toEqual({ ok: true });
  });

  it("returns ok=true when .jj exists", () => {
    fs.mkdirSync(path.join(tmpRoot, ".jj"));
    expect(repoIsValid(tmpRoot)).toEqual({ ok: true });
  });

  it("returns ok=false with a remediation hint when no sentinel exists", () => {
    const result = repoIsValid(tmpRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok=false");
    // 1530: the user-facing error must point at `git init` so an agent
    // failing the per-tool gate sees the recovery path immediately.
    expect(result.error).toContain("does not appear to be a repository root");
    expect(result.error).toContain("git init");
  });

  it("does not throw on a missing sentinel (issue 1530: no eager throw)", () => {
    expect(() => repoIsValid(tmpRoot)).not.toThrow();
  });
});

describe("assertIsRepo (throwing wrapper)", () => {
  it("throws when no sentinel exists", () => {
    expect(() => assertIsRepo(tmpRoot)).toThrow(
      /does not appear to be a repository root/,
    );
  });

  it("does not throw when .git exists", () => {
    fs.mkdirSync(path.join(tmpRoot, ".git"));
    expect(() => assertIsRepo(tmpRoot)).not.toThrow();
  });
});

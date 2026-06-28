import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { canonicalDirRealpath } from "./realpath.js";
import {
  discoverRepoRoot,
  resolveRepoRoot,
  canonicalizeRepoRelative,
} from "./repo-paths.js";
import { makeTmpRoot, cleanTmpRoot } from "../test-helpers.js";

let root: string;

beforeEach(() => {
  root = makeTmpRoot("repopaths");
});

afterEach(() => {
  cleanTmpRoot(root);
});

describe("canonicalDirRealpath — existence independence (the binding-parity crux)", () => {
  it("returns the SAME path whether or not the leaf exists", () => {
    fs.mkdirSync(path.join(root, "a/b"), { recursive: true });
    const target = path.join(root, "a/b/leaf.ts");
    const whenAbsent = canonicalDirRealpath(target);
    fs.writeFileSync(target, "content\n");
    const whenPresent = canonicalDirRealpath(target);
    expect(whenAbsent).not.toBeNull();
    expect(whenAbsent).toBe(whenPresent);
  });

  it("returns the SAME path whether or not intermediate parents exist", () => {
    const target = path.join(root, "x/y/z/leaf.ts");
    const whenNoParents = canonicalDirRealpath(target);
    fs.mkdirSync(path.join(root, "x/y/z"), { recursive: true });
    fs.writeFileSync(target, "c\n");
    const whenAll = canonicalDirRealpath(target);
    expect(whenNoParents).toBe(whenAll);
  });

  it("resolves a symlinked ancestor directory but keeps the leaf lexical", () => {
    fs.mkdirSync(path.join(root, "real"), { recursive: true });
    fs.symlinkSync(path.join(root, "real"), path.join(root, "link"));
    const viaLink = canonicalDirRealpath(path.join(root, "link/leaf.ts"));
    const direct = canonicalDirRealpath(path.join(root, "real/leaf.ts"));
    expect(viaLink).toBe(direct);
  });
});

describe("discoverRepoRoot — upward .git/.jj discovery", () => {
  it("finds the workspace root from a sub-directory (.git)", () => {
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "pkg/src"), { recursive: true });
    const found = discoverRepoRoot(path.join(root, "pkg/src"));
    expect(found).toBe(fs.realpathSync(root));
  });

  it("returns the real repo root when the start path is under a symlinked cwd", () => {
    const realRepo = path.join(root, "real-repo");
    fs.mkdirSync(path.join(realRepo, ".git"), { recursive: true });
    fs.mkdirSync(path.join(realRepo, "src"), { recursive: true });
    const linkedRepo = path.join(root, "linked-repo");
    fs.symlinkSync(realRepo, linkedRepo);

    const found = discoverRepoRoot(path.join(linkedRepo, "src"));

    expect(found).toBe(fs.realpathSync(realRepo));
    expect(found).not.toBe(path.join(linkedRepo, "src"));
  });

  it("finds the workspace root from a sub-directory (.jj only)", () => {
    fs.mkdirSync(path.join(root, ".jj"));
    fs.mkdirSync(path.join(root, "deep/nested"), { recursive: true });
    const found = discoverRepoRoot(path.join(root, "deep/nested"));
    expect(found).toBe(fs.realpathSync(root));
  });

  it("falls back to the resolved start when no marker is found", () => {
    const sub = path.join(root, "no/marker");
    fs.mkdirSync(sub, { recursive: true });
    expect(discoverRepoRoot(sub)).toBe(fs.realpathSync(sub));
  });
});

describe("resolveRepoRoot — precedence primary → env → cwd", () => {
  let origEnv: string | undefined;
  beforeEach(() => {
    origEnv = process.env["META_EDIT_REPO_ROOT"];
  });
  afterEach(() => {
    if (origEnv === undefined) delete process.env["META_EDIT_REPO_ROOT"];
    else process.env["META_EDIT_REPO_ROOT"] = origEnv;
  });

  it("primary wins and is upward-discovered", () => {
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    process.env["META_EDIT_REPO_ROOT"] = "/nonexistent-env";
    expect(resolveRepoRoot(path.join(root, "sub"))).toBe(
      fs.realpathSync(root),
    );
  });

  it("env is used (and discovered) when primary is absent", () => {
    fs.mkdirSync(path.join(root, ".jj"));
    fs.mkdirSync(path.join(root, "s"), { recursive: true });
    process.env["META_EDIT_REPO_ROOT"] = path.join(root, "s");
    expect(resolveRepoRoot(undefined)).toBe(fs.realpathSync(root));
  });
});

describe("canonicalizeRepoRelative — issuer/consumer parity", () => {
  it("relative and absolute spellings of the same file produce the same canonical", () => {
    fs.mkdirSync(path.join(root, ".git"));
    const repoRoot = resolveRepoRoot(root);
    const rel = canonicalizeRepoRelative("src/foo.ts", repoRoot);
    const abs = canonicalizeRepoRelative(
      path.join(repoRoot, "src/foo.ts"),
      repoRoot,
    );
    expect(rel.ok && abs.ok).toBe(true);
    if (rel.ok && abs.ok) {
      expect(rel.canonical).toBe("src/foo.ts");
      expect(rel.canonical).toBe(abs.canonical);
    }
  });

  it("is existence-independent: same canonical before and after the file is created", () => {
    fs.mkdirSync(path.join(root, ".git"));
    const repoRoot = resolveRepoRoot(root);
    const before = canonicalizeRepoRelative("a/b/new.ts", repoRoot);
    fs.mkdirSync(path.join(repoRoot, "a/b"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "a/b/new.ts"), "x\n");
    const after = canonicalizeRepoRelative("a/b/new.ts", repoRoot);
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(before.canonical).toBe(after.canonical);
    }
  });

  it("flags an escaping path with code \"escapes\"", () => {
    fs.mkdirSync(path.join(root, ".git"));
    const repoRoot = resolveRepoRoot(root);
    const r = canonicalizeRepoRelative("/etc/passwd", repoRoot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("escapes");
  });

  it("flags the repo root itself with code \"is_root\"", () => {
    fs.mkdirSync(path.join(root, ".git"));
    const repoRoot = resolveRepoRoot(root);
    const r = canonicalizeRepoRelative(repoRoot, repoRoot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("is_root");
  });
});

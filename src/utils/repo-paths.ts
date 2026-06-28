// Single source of truth for repository-root resolution and the
// repo-relative canonical form. Both the token ISSUER
// (src/tools/common.ts checkPathSafety) and the token CONSUMER
// (src/hooks/raw-edit-policy.ts canonicalizeForBinding) MUST key grant
// bindings on byte-identical strings; likewise the MCP server and the
// hooks MUST resolve the same repository root. Before this module those
// two parities were comment-enforced across three+ copies and broke
// under jj working copies / symlinks / non-root launches
// (issues/2026-05-17-grant-binding-canonicalization-parity.md). They
// are now structural: there is exactly one implementation here.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  realpathOfDeepestExisting,
  canonicalDirRealpath,
} from "./realpath.js";
import { normalizeRepoRelative } from "../state/protected-paths.js";

/**
 * Walk up from `start` until a directory containing a `.git` or `.jj`
 * VCS marker is found, then realpath-normalize it. `.git` may be a file
 * (git worktrees use a `gitdir:` pointer file) — existence is enough.
 * If no marker is found up to the filesystem root, the resolved `start`
 * is used as-is (then still realpath-normalized) so behavior degrades
 * to "treat the launch dir as the root" rather than throwing.
 *
 * This makes a launch from a sub-directory of a jj/git workspace (the
 * common "cwd ≠ repo top-level" failure mode) resolve to the actual
 * workspace root on BOTH the server and hook sides identically.
 */
export function discoverRepoRoot(start: string): string {
  const resolvedStart = path.resolve(start);
  const realStart = realpathOfDeepestExisting(resolvedStart) ?? resolvedStart;
  const realTmp =
    realpathOfDeepestExisting(os.tmpdir()) ?? path.resolve(os.tmpdir());
  let dir = resolvedStart;
  let found: string | null = null;
  // Bounded by filesystem depth; the parent === dir check terminates at
  // the fs root.
  for (;;) {
    if (hasRepoMarker(dir, realStart, realTmp)) {
      found = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const base = found ?? resolvedStart;
  return realpathOfDeepestExisting(base) ?? path.resolve(base);
}

function hasRepoMarker(
  dir: string,
  realStart: string,
  realTmp: string,
): boolean {
  const markers = [path.join(dir, ".git"), path.join(dir, ".jj")];
  if (!markers.some((marker) => fs.existsSync(marker))) {
    return false;
  }

  // Some CI/sandbox environments mount an empty /tmp/.git as an ambient
  // artifact. Treating that as the repo root makes every isolated temp
  // directory look like a repository. A real git-init'd /tmp has content,
  // and an explicit launch from /tmp should still be honored.
  const realDir = realpathOfDeepestExisting(dir) ?? path.resolve(dir);
  if (realDir === realTmp && realStart !== realTmp) {
    const onlyEmptyTempMarkers = markers.every((marker) => {
      if (!fs.existsSync(marker)) return true;
      try {
        const stat = fs.statSync(marker);
        return stat.isDirectory() && fs.readdirSync(marker).length === 0;
      } catch {
        return false;
      }
    });
    if (onlyEmptyTempMarkers) return false;
  }

  return true;
}

/**
 * Resolve the repository root for a meta-edit process.
 *
 * Precedence: explicit `primary` (the server's `--repo-root` /
 * `options.repoRoot`, or a hook's `event.cwd`) → `$META_EDIT_REPO_ROOT`
 * → `process.cwd()`. Whichever wins is passed through `discoverRepoRoot`
 * so all three branches get identical upward `.git`/`.jj` discovery and
 * realpath normalization. The server and both hooks call THIS — the
 * precedence and normalization can no longer drift between them.
 */
export function resolveRepoRoot(primary: string | undefined): string {
  if (typeof primary === "string" && primary.length > 0) {
    return discoverRepoRoot(primary);
  }
  const envRoot = process.env["META_EDIT_REPO_ROOT"];
  if (typeof envRoot === "string" && envRoot.length > 0) {
    return discoverRepoRoot(envRoot);
  }
  return discoverRepoRoot(process.cwd());
}

export type CanonicalizeResult =
  | { ok: true; canonical: string }
  | { ok: false; error: string; code: "uncanonicalizable" | "escapes" | "is_root" };

/**
 * Produce the repository-relative canonical key for `inputPath`. This is
 * the ONE function the issuer and the consumer share, so a grant bound
 * at issue time is found at consume time regardless of whether the file
 * exists yet (existence-independent via `canonicalDirRealpath`) or which
 * spelling of the workspace path each process started from (both sides
 * realpath the same discovered root).
 *
 * Policy that legitimately differs between issue and consume — rejecting
 * absolute input / `..` on the issue side, accepting absolute input on
 * the consume side, the protected-path check — stays at the call sites.
 * This function only computes the canonical form + the repo-escape
 * boundary, identically for both.
 *
 * `repoRoot` is expected to already be a `resolveRepoRoot()` output
 * (discovered + realpath'd); it is realpath'd again here idempotently so
 * a caller passing a raw root still gets the correct boundary.
 */
export function canonicalizeRepoRelative(
  inputPath: string,
  repoRoot: string,
): CanonicalizeResult {
  const resolved = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(repoRoot, inputPath);

  const realRoot =
    realpathOfDeepestExisting(path.resolve(repoRoot)) ??
    path.resolve(repoRoot);
  const realResolved = canonicalDirRealpath(resolved);
  if (realResolved === null) {
    return {
      ok: false,
      code: "uncanonicalizable",
      error: `path "${inputPath}" could not be canonicalized via realpath; failing closed`,
    };
  }
  if (
    realResolved !== realRoot &&
    !realResolved.startsWith(realRoot + path.sep)
  ) {
    return {
      ok: false,
      code: "escapes",
      error: `path "${inputPath}" escapes repository root after symlink resolution`,
    };
  }
  let rel: string;
  try {
    rel = normalizeRepoRelative(path.relative(realRoot, realResolved));
  } catch (e) {
    return {
      ok: false,
      code: "uncanonicalizable",
      error: `path "${inputPath}" is invalid: ${(e as Error).message}`,
    };
  }
  if (rel.length === 0) {
    return {
      ok: false,
      code: "is_root",
      error: `path "${inputPath}" resolves to the repository root`,
    };
  }
  return { ok: true, canonical: rel };
}

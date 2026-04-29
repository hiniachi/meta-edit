import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyPatch } from "diff";
import { isProtectedPath, normalizeRepoRelative } from "../state/protected-paths.js";
import type { PatchChange } from "./common.js";

// Apply modify-only patches to a repository.
//
// This module implements the Phase 3 TOCTOU contract documented in
// src/tools/common.ts checkPathSafety. At apply time we:
//
//   1. Re-realpath the target file and verify it is still inside the
//      canonical repo root, that the canonical form has not drifted from
//      validation, and that it is still outside protected paths.
//   2. Re-realpath the target's *parent* directory and verify the same
//      containment, so a swapped ancestor symlink cannot redirect writes.
//   3. Stage every patch in memory first; only after every patch applies
//      cleanly do we touch the filesystem.
//   4. Write each patched file atomically:
//        a. Open a temp file in the parent dir with O_CREAT | O_EXCL |
//           O_WRONLY | O_NOFOLLOW, write + fsync + close.
//        b. rename(temp, target). On POSIX this is atomic and replaces
//           the target inode in one step, so an attacker cannot race a
//           symlink swap into the open() of the destination.
//
// O_NOFOLLOW must be available; meta-edit refuses to write on platforms
// where it is not (currently Windows). This is enforced at apply time
// rather than at module load so unrelated callers (CLI helpers, tests)
// can import this module without crashing on unsupported platforms.

const PLATFORM_O_NOFOLLOW = fs.constants.O_NOFOLLOW;

export type ApplyOptions = {
  /**
   * Override the value of O_NOFOLLOW used during open(). Production callers
   * should leave this unset; tests inject `undefined`/`0` to exercise the
   * hard-fail branch on platforms that do not expose it (notably Windows).
   */
  oNofollow?: number | undefined;
};

export type ApplyResult =
  | { applied: true; warnings: string[]; touchedAbsolutePaths: string[] }
  | { applied: false; warnings: string[] };

export function applyChanges(
  repoRoot: string,
  changes: PatchChange[],
  options: ApplyOptions = {},
): ApplyResult {
  const warnings: string[] = [];
  const O_NOFOLLOW =
    options.oNofollow !== undefined ? options.oNofollow : PLATFORM_O_NOFOLLOW;

  if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
    return {
      applied: false,
      warnings: [
        "this platform does not expose O_NOFOLLOW; meta-edit refuses to write without symlink-leaf protection",
      ],
    };
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(path.resolve(repoRoot));
  } catch {
    return {
      applied: false,
      warnings: [`repository root could not be canonicalized: ${repoRoot}`],
    };
  }

  type Staged = {
    canonical: string;
    absolute: string;
    parent: string;
    output: string;
    mode: number | null;
  };
  const staged: Staged[] = [];

  for (const ch of changes) {
    const lexicalAbs = path.join(realRoot, ch.canonical);

    let realAbs: string;
    try {
      realAbs = fs.realpathSync(lexicalAbs);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      warnings.push(
        `apply-time canonicalization failed for "${ch.canonical}" (${code ?? "ERR"}); refusing to write`,
      );
      return { applied: false, warnings };
    }

    if (
      realAbs !== realRoot &&
      !realAbs.startsWith(realRoot + path.sep)
    ) {
      warnings.push(
        `apply-time canonical for "${ch.canonical}" escapes the repository root; refusing`,
      );
      return { applied: false, warnings };
    }

    const reCanonical = normalizeRepoRelative(path.relative(realRoot, realAbs));
    if (reCanonical !== ch.canonical) {
      warnings.push(
        `apply-time canonical "${reCanonical}" differs from validated canonical "${ch.canonical}"; refusing`,
      );
      return { applied: false, warnings };
    }
    if (isProtectedPath(reCanonical)) {
      warnings.push(
        `apply-time canonical for "${ch.canonical}" lands in a protected directory; refusing`,
      );
      return { applied: false, warnings };
    }

    // Independently canonicalize the parent directory so a swapped
    // ancestor symlink cannot redirect the rename target.
    const lexicalParent = path.dirname(realAbs);
    let realParent: string;
    try {
      realParent = fs.realpathSync(lexicalParent);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      warnings.push(
        `apply-time parent canonicalization failed for "${ch.canonical}" (${code ?? "ERR"}); refusing`,
      );
      return { applied: false, warnings };
    }
    if (
      realParent !== realRoot &&
      !realParent.startsWith(realRoot + path.sep)
    ) {
      warnings.push(
        `apply-time parent for "${ch.canonical}" escapes the repository root; refusing`,
      );
      return { applied: false, warnings };
    }

    // Capture mode at the same moment we read the original content. If the
    // file inode is later swapped before chmod, we will refuse via the
    // re-realpath check below and never apply this captured mode to a
    // different inode.
    let originalMode: number | null = null;
    try {
      originalMode = fs.statSync(realAbs).mode & 0o7777;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      originalMode = null;
      warnings.push(
        `could not stat "${ch.canonical}" before write (${code ?? "ERR"}); replacement will be created with mode 0o600`,
      );
    }

    let original: string;
    try {
      original = fs.readFileSync(realAbs, "utf8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      warnings.push(
        `failed to read "${ch.canonical}" for patch application: ${code ?? "ERR"}`,
      );
      return { applied: false, warnings };
    }

    const result = applyPatch(original, ch.diff);
    if (result === false) {
      warnings.push(
        `patch did not apply cleanly to "${ch.canonical}" (context mismatch)`,
      );
      return { applied: false, warnings };
    }

    staged.push({
      canonical: ch.canonical,
      absolute: realAbs,
      parent: realParent,
      output: result,
      mode: originalMode,
    });
  }

  // All patches applied in memory. Now write each file atomically: write a
  // temp sibling with O_CREAT|O_EXCL|O_NOFOLLOW, fsync, then rename over
  // the target. The rename is atomic on POSIX, so neither O_TRUNC race
  // (eliminated: we never truncate) nor partial-write race can truncate
  // the destination on a write error.
  //
  // To shrink the parent-directory TOCTOU window between staging and
  // write, we re-realpath the parent immediately before each filesystem
  // operation that resolves a pathname. If the parent's canonical path
  // has drifted, we refuse and abort. This does not eliminate the race
  // (Node's high-level fs API has no openat), but it tightens the window
  // to the kernel call's own scheduling boundary.
  const touchedAbsolutePaths: string[] = [];
  for (const w of staged) {
    const parentDriftCheck = (op: string):
      | { ok: true }
      | { ok: false; reason: string } => {
      let nowReal: string;
      try {
        nowReal = fs.realpathSync(w.parent);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException | undefined)?.code;
        return { ok: false, reason: `parent realpath threw ${code ?? "ERR"} before ${op}` };
      }
      if (nowReal !== w.parent) {
        return {
          ok: false,
          reason: `parent canonical drifted from "${w.parent}" to "${nowReal}" before ${op}`,
        };
      }
      return { ok: true };
    };

    const tempName =
      path.basename(w.absolute) +
      "." +
      crypto.randomBytes(8).toString("hex") +
      ".metaedit-tmp";
    const tempPath = path.join(w.parent, tempName);

    let preDrift = parentDriftCheck("temp open");
    if (!preDrift.ok) {
      warnings.push(
        `parent directory TOCTOU detected for "${w.canonical}": ${preDrift.reason}`,
      );
      return { applied: false, warnings };
    }

    let fd: number | null = null;
    try {
      fd = fs.openSync(
        tempPath,
        // eslint-disable-next-line no-bitwise
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
        0o600,
      );
      fs.writeFileSync(fd, w.output, { encoding: "utf8" });
      fs.fsyncSync(fd);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      warnings.push(
        `failed to stage temp file for "${w.canonical}": ${code ?? "ERR"}`,
      );
      cleanupTemp(tempPath);
      return { applied: false, warnings };
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore close errors
        }
      }
    }

    try {
      // Apply the mode we captured at read time (NOT a fresh stat — that
      // would be vulnerable to a swap-and-chmod race exposing
      // attacker-chosen permissions on the new content).
      if (w.mode !== null) {
        try {
          fs.chmodSync(tempPath, w.mode);
        } catch {
          // best effort; leave at 0o600
        }
      }

      preDrift = parentDriftCheck("rename");
      if (!preDrift.ok) {
        warnings.push(
          `parent directory TOCTOU detected for "${w.canonical}": ${preDrift.reason}`,
        );
        cleanupTemp(tempPath);
        return { applied: false, warnings };
      }

      fs.renameSync(tempPath, w.absolute);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      warnings.push(
        `failed to atomically rename temp into "${w.canonical}": ${code ?? "ERR"}`,
      );
      cleanupTemp(tempPath);
      // Note: previous staged renames that already succeeded remain on
      // disk. Phase 3 MVP does not implement multi-file rollback; this is
      // documented as a known limitation in IMPLEMENTATION-LOG.md.
      return { applied: false, warnings };
    }

    // Best-effort: fsync the parent dir so the rename is durable. On some
    // filesystems (tmpfs, certain network mounts) and on macOS, fsync of a
    // directory FD is either a no-op or rejected; we treat any failure as
    // non-fatal. Full durability would require F_FULLFSYNC on macOS.
    try {
      const dirFd = fs.openSync(w.parent, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // best-effort durability; ignore.
    }

    touchedAbsolutePaths.push(w.absolute);
  }

  return { applied: true, warnings, touchedAbsolutePaths };
}

function cleanupTemp(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    // ignore — temp file may not exist
  }
}

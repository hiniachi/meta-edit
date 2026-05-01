import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { isProtectedPath, normalizeRepoRelative } from "../state/protected-paths.js";
import type { ContentChange } from "./common.js";

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
//
// Known limitation (acknowledged, not closed): if the captured parent
// directory is unlinked AND a NEW directory is created at the same
// canonical string between the first read and the rename, our
// `parentDriftCheck` (which compares `realpathSync(parent)` to the same
// path) cannot detect the swap by string equality alone. Closing that
// race fully requires fd-pinned (openat) operations, which Node's
// high-level fs API does not expose. The threat model is single-user
// local TOCTOU; we document this rather than promise full coverage.

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
  changes: ContentChange[],
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
  // The validation layer (common.ts validateRequest) already rejects
  // patches that contain multiple sections targeting the same canonical
  // path, so by the time changes reach this loop every entry has a unique
  // canonical. If that invariant is ever violated upstream, we want to
  // notice loudly rather than silently overwrite — the assertion below
  // catches it.
  const seenCanonical = new Set<string>();

  for (const ch of changes) {
    if (seenCanonical.has(ch.canonical)) {
      warnings.push(
        `internal error: applyChanges received duplicate canonical "${ch.canonical}" — validateRequest should have rejected this. No write performed.`,
      );
      return { applied: false, warnings };
    }
    seenCanonical.add(ch.canonical);

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
      // ENOENT means the file does not exist. The content-pair shape is
      // modify-only — there is no representation for file creation, so a
      // missing file at apply time is always a request error rather than
      // an instruction to create the file.
      if (code === "ENOENT") {
        warnings.push(
          `change.file "${ch.canonical}" does not exist; modify-only requires the file already exist`,
        );
      } else {
        warnings.push(
          `failed to read "${ch.canonical}" for change application: ${code ?? "ERR"}`,
        );
      }
      return { applied: false, warnings };
    }

    if (original !== ch.oldContent) {
      // Distinguish length mismatch from content mismatch so a common
      // failure mode (caller passed a snippet because they were thinking
      // in Anthropic Edit's old_string semantics, where old_string is a
      // fragment) gets a self-explanatory diagnostic instead of a
      // misleading "file changed" message that triggers a re-read loop.
      // See dogfood-002. We report UTF-8 byte lengths via Buffer.byteLength
      // because agents reasoning about file contents typically think in
      // bytes (e.g. `wc -c`), while a generic "characters" framing
      // confuses on UTF-16 surrogate pairs and emoji. PR #42 self-review.
      const diskBytes = Buffer.byteLength(original, "utf8");
      const oldBytes = Buffer.byteLength(ch.oldContent, "utf8");
      const delta = oldBytes - diskBytes;
      if (delta !== 0) {
        // Trailing-newline / leading-whitespace mistakes (|delta| ≤ 2)
        // dominate snippet-style misuses for autoformatted source files.
        // Calling the agent's input "a snippet" when they actually
        // shipped 99 % of the file misroutes the fix; surface the more
        // probable cause first. PR #42 self-review (Bug 2).
        if (Math.abs(delta) <= 2) {
          const direction = delta > 0 ? "longer" : "shorter";
          warnings.push(
            `old_content for "${ch.canonical}" is ${Math.abs(delta)} byte(s) ` +
              `${direction} than the file on disk (${oldBytes} vs ${diskBytes} bytes); ` +
              `likely a trailing-newline or leading-whitespace mismatch. ` +
              `Re-read the file with the same encoding and pass its complete byte-for-byte contents.`,
          );
        } else {
          warnings.push(
            `old_content for "${ch.canonical}" is ${oldBytes} bytes but the file on disk is ${diskBytes} bytes; ` +
              `old_content must be the EXACT current full file content, not a snippet. ` +
              `Re-read the file and pass its complete contents.`,
          );
        }
      } else {
        warnings.push(
          `stale old_content for "${ch.canonical}": same length as disk (${diskBytes} bytes) but bytes differ; ` +
            `the file changed since old_content was captured, or old_content used a different encoding/transcoding. ` +
            `Re-read the file and retry.`,
        );
      }
      return { applied: false, warnings };
    }

    staged.push({
      canonical: ch.canonical,
      absolute: realAbs,
      parent: realParent,
      output: ch.newContent,
      mode: originalMode,
    });
  }

  // All preconditions cleared. Two-phase commit: write every sibling
  // temp file first; only after every write succeeds do we run the
  // renames. This keeps multi-file batches atomic on the write
  // failure case — a temp-write error in change N leaves no target
  // modified, regardless of how many earlier renames had already
  // committed (zero, by construction). Rename failures part-way are
  // still possible (rename is essentially atomic on POSIX, so this
  // should be vanishingly rare) and are surfaced as a partial-write
  // warning.
  //
  // To shrink the parent-directory TOCTOU window between staging and
  // write, we re-realpath the parent immediately before each filesystem
  // operation that resolves a pathname. If the parent's canonical path
  // has drifted, we refuse and abort. This does not eliminate the race
  // (Node's high-level fs API has no openat), but it tightens the window
  // to the kernel call's own scheduling boundary. NOTE: drift-string
  // equality only catches drift to a different canonical *string* —
  // bind mounts or symlink layouts that yield the same realpath but
  // a different inode are out of scope.
  const parentDriftCheck = (
    parent: string,
    op: string,
  ): { ok: true } | { ok: false; reason: string } => {
    let nowReal: string;
    try {
      nowReal = fs.realpathSync(parent);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      return { ok: false, reason: `parent realpath threw ${code ?? "ERR"} before ${op}` };
    }
    if (nowReal !== parent) {
      return {
        ok: false,
        reason: `parent canonical drifted from "${parent}" to "${nowReal}" before ${op}`,
      };
    }
    return { ok: true };
  };

  // Phase 2 — write every sibling temp file. If any fails, cleanup all
  // temps written so far and bail without modifying any target.
  type Pending = { w: Staged; tempPath: string };
  const pending: Pending[] = [];
  const cleanupAllPending = (): void => {
    for (const p of pending) {
      cleanupTemp(p.tempPath);
    }
  };

  for (const w of staged) {
    const tempName =
      path.basename(w.absolute) +
      "." +
      crypto.randomBytes(8).toString("hex") +
      ".metaedit-tmp";
    const tempPath = path.join(w.parent, tempName);

    const driftBeforeOpen = parentDriftCheck(w.parent, "temp open");
    if (!driftBeforeOpen.ok) {
      warnings.push(
        `parent directory TOCTOU detected for "${w.canonical}": ${driftBeforeOpen.reason}`,
      );
      cleanupAllPending();
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
      cleanupAllPending();
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

    // Apply the mode we captured at read time (NOT a fresh stat — that
    // would be vulnerable to a swap-and-chmod race exposing
    // attacker-chosen permissions on the new content). chmod is
    // intentionally best-effort: if it fails (e.g. EPERM under a
    // restricted user), the new content lands with the temp's 0o600.
    // We surface the fall-back as a warning so callers know the mode
    // was tightened from whatever the original was, but do NOT abort
    // — failing here would force an otherwise-valid edit through a
    // best-effort permission carry-over, and the resulting 0o600
    // mode is conservative (more restrictive, never more permissive).
    if (w.mode !== null) {
      try {
        fs.chmodSync(tempPath, w.mode);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException | undefined)?.code;
        warnings.push(
          `failed to restore original mode 0o${w.mode.toString(8)} on "${w.canonical}" (${code ?? "ERR"}); new content will land at 0o600`,
        );
      }
    }

    pending.push({ w, tempPath });
  }

  // Phase 3 — commit every rename. If a rename fails after some have
  // already committed, surface a partial-write warning that names the
  // files. Rename is essentially atomic on POSIX so this branch is
  // vanishingly rare in practice; the diagnostic is for human recovery
  // (VCS revert, follow-up edit_* call).
  const touchedAbsolutePaths: string[] = [];
  for (let idx = 0; idx < pending.length; idx++) {
    const { w, tempPath } = pending[idx]!;

    const driftBeforeRename = parentDriftCheck(w.parent, "rename");
    if (!driftBeforeRename.ok) {
      warnings.push(
        `parent directory TOCTOU detected for "${w.canonical}": ${driftBeforeRename.reason}`,
      );
      // Cleanup remaining unrenamed temps; renamed targets stay (we
      // cannot atomically roll back a rename without re-recording the
      // original content, which we don't capture for that purpose).
      for (let j = idx; j < pending.length; j++) {
        cleanupTemp(pending[j]!.tempPath);
      }
      if (touchedAbsolutePaths.length > 0) {
        warnings.push(
          `partial write: ${touchedAbsolutePaths.length} file(s) were already renamed before this failure and remain on disk: ${touchedAbsolutePaths.join(", ")}. meta-edit does not roll back; recover via VCS history or a follow-up edit_* call.`,
        );
      }
      return { applied: false, warnings };
    }

    try {
      fs.renameSync(tempPath, w.absolute);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      warnings.push(
        `failed to atomically rename temp into "${w.canonical}": ${code ?? "ERR"}`,
      );
      cleanupTemp(tempPath);
      for (let j = idx + 1; j < pending.length; j++) {
        cleanupTemp(pending[j]!.tempPath);
      }
      if (touchedAbsolutePaths.length > 0) {
        warnings.push(
          `partial write: ${touchedAbsolutePaths.length} file(s) were already renamed before this failure and remain on disk: ${touchedAbsolutePaths.join(", ")}. meta-edit does not roll back; recover via VCS history or a follow-up edit_* call.`,
        );
      }
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

// Apply create-only changes for the `edit_create_file` tool.
//
// Contract (paired with src/tools/common.ts validateRequest's create branch):
// for each entry, `oldContent` is the empty string by upstream validation
// and the file MUST NOT exist on disk. The server opens the final target
// directly with O_CREAT | O_EXCL | O_NOFOLLOW so EEXIST is the kernel-level
// race-safe enforcement of the "did not exist" precondition; the preflight
// lstat is purely for an early failure with a friendlier message and to
// guarantee the all-or-nothing behaviour on multi-file creates when no
// race occurs.
//
// Unlike the modify path there is no temp + rename: the EEXIST check
// IS the atomic precondition, and a temp+rename would defeat it (rename
// silently overwrites). On multi-file creates a later open() failing with
// EEXIST after earlier creates succeeded leaves a partial-write state
// surfaced via warning, mirroring the modify path's diagnostics.
export function applyCreates(
  repoRoot: string,
  changes: ContentChange[],
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

  type StagedCreate = {
    canonical: string;
    // Absolute path built from `realParent` + leaf basename — NOT from the
    // original lexical path. This matters when an ancestor in the lexical
    // path was a symlink: realpath-of-ancestor at staging time captures
    // the canonical parent, and the open MUST use that canonical parent
    // so a same-string-but-flipped ancestor symlink between staging and
    // open cannot redirect the write through a freshly-pointed link.
    absolute: string;
    parent: string;
    // The original lexical parent string we realpath'd. Re-realpath'ing
    // THIS at drift-check time (rather than re-realpath'ing the already-
    // resolved `parent`) is what catches an ancestor-symlink flip whose
    // canonical form drifts between staging and open.
    lexicalParent: string;
    output: string;
  };
  const staged: StagedCreate[] = [];
  const seenCanonical = new Set<string>();

  for (const ch of changes) {
    if (seenCanonical.has(ch.canonical)) {
      warnings.push(
        `internal error: applyCreates received duplicate canonical "${ch.canonical}" — validateRequest should have rejected this. No write performed.`,
      );
      return { applied: false, warnings };
    }
    seenCanonical.add(ch.canonical);

    const lexicalAbs = path.join(realRoot, ch.canonical);

    // Reject early when the canonical lands in a protected dir. The same
    // check ran at validate time, but apply re-asserts so a future caller
    // that bypasses validation (e.g. unit tests, future internal call
    // sites) cannot land writes in the audit area.
    if (isProtectedPath(ch.canonical)) {
      warnings.push(
        `apply-time canonical for "${ch.canonical}" lands in a protected directory; refusing`,
      );
      return { applied: false, warnings };
    }

    const lexicalParent = path.dirname(lexicalAbs);
    let realParent: string;
    try {
      realParent = fs.realpathSync(lexicalParent);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      warnings.push(
        `parent directory for "${ch.canonical}" cannot be resolved (${code ?? "ERR"}); applyCreates does not implicitly mkdir, so the parent must exist before creation`,
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

    // The parent dir's canonical (after realpath) must not itself land in
    // the protected area. A novel-looking leaf under .meta-edit/state/...
    // is still a write into the audit area.
    const reCanonicalParent = normalizeRepoRelative(
      path.relative(realRoot, realParent),
    );
    if (
      reCanonicalParent.length > 0 &&
      isProtectedPath(reCanonicalParent)
    ) {
      warnings.push(
        `apply-time parent for "${ch.canonical}" lands in a protected directory; refusing`,
      );
      return { applied: false, warnings };
    }

    // Build the absolute path from the canonicalized parent + leaf so the
    // open does not traverse any ancestor symlink that was canonicalized
    // away at staging time. A subsequent flip of an ancestor symlink would
    // be caught by the drift check (which re-realpaths the *original*
    // lexical parent — see Phase 2) before this absolute path is opened.
    const absolute = path.join(realParent, path.basename(ch.canonical));

    // Preflight: the leaf must NOT exist (file, dir, or symlink). lstat
    // hits the symlink itself rather than its target, so a dangling
    // symlink at the leaf path is treated as preexisting and rejected.
    let preexists = false;
    try {
      fs.lstatSync(absolute);
      preexists = true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        warnings.push(
          `apply-time preflight lstat for "${ch.canonical}" failed (${code ?? "ERR"}); refusing`,
        );
        return { applied: false, warnings };
      }
    }
    if (preexists) {
      warnings.push(
        `change.file "${ch.canonical}" already exists on disk; edit_create_file refuses to overwrite (use a modify-only edit_* tool instead)`,
      );
      return { applied: false, warnings };
    }

    staged.push({
      canonical: ch.canonical,
      absolute,
      parent: realParent,
      lexicalParent,
      output: ch.newContent,
    });
  }

  // Phase 2 — open each final target with O_CREAT|O_EXCL|O_NOFOLLOW. We
  // do NOT pre-write a temp and rename: rename silently overwrites, which
  // would defeat the create-only contract. The kernel's atomic O_EXCL is
  // the race-safe enforcement.
  const touchedAbsolutePaths: string[] = [];
  const partialWriteWarning = (): void => {
    if (touchedAbsolutePaths.length > 0) {
      warnings.push(
        `partial write: ${touchedAbsolutePaths.length} file(s) were already created before this failure and remain on disk: ${touchedAbsolutePaths.join(", ")}. meta-edit does not roll back; recover via VCS history or a follow-up edit_* call.`,
      );
    }
  };

  for (const w of staged) {
    // Re-realpath the *original lexical* parent immediately before open
    // to shrink the parent-dir TOCTOU window. Re-resolving `w.parent` (the
    // already-canonical form) would miss the case where a flipped ancestor
    // symlink in the lexical path now points elsewhere — its realpath would
    // still equal itself. Re-resolving from the lexical string forces the
    // walk to follow whichever symlink content is current. Drift is then
    // a string mismatch against the staging-time canonical. String-equality
    // drift detection only catches drift to a different canonical *string*
    // — bind mounts that yield the same realpath are out of scope.
    let nowParent: string;
    try {
      nowParent = fs.realpathSync(w.lexicalParent);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      warnings.push(
        `parent directory TOCTOU detected for "${w.canonical}": parent realpath threw ${code ?? "ERR"} before open`,
      );
      partialWriteWarning();
      return { applied: false, warnings };
    }
    if (nowParent !== w.parent) {
      warnings.push(
        `parent directory TOCTOU detected for "${w.canonical}": parent canonical drifted from "${w.parent}" to "${nowParent}" before open`,
      );
      partialWriteWarning();
      return { applied: false, warnings };
    }

    let fd: number | null = null;
    try {
      fd = fs.openSync(
        w.absolute,
        // eslint-disable-next-line no-bitwise
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          O_NOFOLLOW,
        0o644,
      );
      fs.writeFileSync(fd, w.output, { encoding: "utf8" });
      fs.fsyncSync(fd);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      const reason =
        code === "EEXIST"
          ? `change.file "${w.canonical}" appeared on disk between preflight and create; refusing (raced)`
          : code === "ELOOP"
            ? `change.file "${w.canonical}" resolves through a symlink at the leaf; O_NOFOLLOW refused`
            : `failed to create "${w.canonical}": ${code ?? "ERR"}`;
      warnings.push(reason);
      partialWriteWarning();
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

    // Best-effort: fsync the parent dir so the create is durable. On some
    // filesystems and on macOS, directory fsync is either a no-op or
    // rejected; treat any failure as non-fatal.
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

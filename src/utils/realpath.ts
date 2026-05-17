// Shared realpath helper for symlink-aware path canonicalization.
//
// Both the protected-paths guard (src/state/protected-paths.ts) and the
// patch-application path validator (src/tools/common.ts) need to resolve a
// path through any existing symlink components even when the leaf does not
// yet exist on disk (e.g. the file is about to be created). Centralizing the
// helper here removes duplication and ensures both call sites share identical
// semantics.
//
// Behavior:
//   - Walks parent directories until fs.realpathSync succeeds, then re-attaches
//     the missing tail components lexically.
//   - On ENOENT/ENOTDIR for the input itself, recurses up to the parent.
//   - On EACCES/EPERM/ELOOP/EMFILE/etc., returns null so the caller can
//     fail closed rather than silently fall back to the lexical form.

import * as fs from "node:fs";
import * as path from "node:path";

export function realpathOfDeepestExisting(p: string): string | null {
  let cur = p;
  const tail: string[] = [];
  while (true) {
    try {
      const real = fs.realpathSync(cur);
      if (tail.length === 0) {
        return real;
      }
      return path.join(real, ...tail.reverse());
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        const parent = path.dirname(cur);
        if (parent === cur) {
          return p;
        }
        tail.push(path.basename(cur));
        cur = parent;
        continue;
      }
      // EACCES, EPERM, ELOOP, EMFILE, etc. — return null to signal that the
      // caller could not canonicalize this path safely.
      return null;
    }
  }
}

/**
 * Existence-INDEPENDENT canonicalization. Realpaths the deepest existing
 * *directory* ancestor of `p` and re-attaches every remaining component
 * — INCLUDING the leaf basename — lexically. Unlike
 * `realpathOfDeepestExisting`, this never calls `fs.realpathSync` on the
 * leaf itself, so the result is byte-identical whether or not the leaf
 * (or its not-yet-created intermediate parent dirs) exists on disk —
 * the property the grant issue/consume binding parity depends on
 * (issues/2026-05-17-grant-binding-canonicalization-parity.md).
 *
 * A real symlink in the agent-created (not-yet-existing) portion of the
 * path would still be resolved differently between the two calls, but
 * agent-created directories are plain `mkdir` dirs, never symlinks, so
 * under the non-adversarial threat model (SPEC Article 3) the canonical
 * form is stable across the declare→write window.
 *
 * Returns null on EACCES / EPERM / ELOOP / EMFILE (fail-closed), matching
 * `realpathOfDeepestExisting`'s contract.
 */
export function canonicalDirRealpath(p: string): string | null {
  let cur = path.dirname(p);
  const tail: string[] = [path.basename(p)];
  while (true) {
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(cur);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        // EACCES / EPERM / ELOOP / EMFILE — cannot canonicalize safely.
        return null;
      }
      st = null;
    }
    if (st !== null && st.isDirectory()) {
      let real: string;
      try {
        real = fs.realpathSync(cur);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          // Raced away between statSync and realpathSync — treat as
          // non-existent and keep walking up.
          real = "";
        } else {
          return null;
        }
      }
      if (real !== "") {
        return path.join(real, ...tail.reverse());
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) {
      // Reached the filesystem root without an existing directory
      // (degenerate; "/" normally exists). Fall back to the lexical form.
      return path.join(cur, ...tail.reverse());
    }
    tail.push(path.basename(cur));
    cur = parent;
  }
}

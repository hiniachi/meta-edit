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

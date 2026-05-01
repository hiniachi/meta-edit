// Protected paths within the repository that meta-edit must never let an
// edit_* tool modify. Edits to these paths are rejected during validation.
//
// The MVP protects only the meta-edit state and tmp directories. Hooks
// (deny-bash-write-bypass) extend best-effort coverage to shell-level
// writes, but the server's own gate is here.

export const PROTECTED_PREFIXES: readonly string[] = [
  ".meta-edit/state/",
  ".meta-edit/tmp/",
];

export function normalizeRepoRelative(p: string): string {
  let n = p.replace(/\\/g, "/");
  while (n.startsWith("./")) {
    n = n.slice(2);
  }
  while (n.startsWith("/")) {
    n = n.slice(1);
  }
  return n.replace(/\/+/g, "/");
}

export function isProtectedPath(p: string): boolean {
  const norm = normalizeRepoRelative(p);
  // Match against both the literal form (for case-sensitive filesystems) and a
  // lowercased form (for case-insensitive filesystems such as default macOS
  // and Windows). The prefixes are already lowercase, so a startsWith check
  // on the folded form covers ".META-EDIT/STATE/..." aliases.
  //
  // Additionally, match the exact directory name (the prefix minus its
  // trailing slash) so a caller passing the bare protected directory path
  // (e.g. ".meta-edit/state") is also rejected. See issue 017 (a4-03).
  const folded = norm.toLowerCase();
  return PROTECTED_PREFIXES.some((prefix) => {
    const dir = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return (
      norm.startsWith(prefix) ||
      folded.startsWith(prefix) ||
      norm === dir ||
      folded === dir
    );
  });
}

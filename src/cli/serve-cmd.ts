// `meta-edit serve` argument parsing.
//
// The only flag is `--repo-root <path>` (also `--repo-root=<path>`),
// the explicit override for the MCP server's repository root. Without
// it the server falls back to $META_EDIT_REPO_ROOT and then
// process.cwd() (see src/server.ts). The override exists so the server
// can be pointed at the real repository root when the launch cwd is
// not the git top-level — a jj workspace, a git worktree, or a
// sub-directory launch — where target_file would otherwise resolve
// against the wrong root and be rejected.

export type ParseServeArgsResult =
  | { ok: true; repoRoot?: string }
  | { ok: false; error: string };

export function parseServeArgs(argv: string[]): ParseServeArgsResult {
  let repoRoot: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo-root") {
      const v = argv[++i];
      if (v === undefined || v.length === 0) {
        return {
          ok: false,
          error: "--repo-root requires a path argument",
        };
      }
      repoRoot = v;
    } else if (arg !== undefined && arg.startsWith("--repo-root=")) {
      const v = arg.slice("--repo-root=".length);
      if (v.length === 0) {
        return {
          ok: false,
          error: "--repo-root requires a path argument",
        };
      }
      repoRoot = v;
    } else {
      return { ok: false, error: `unknown flag: ${arg}` };
    }
  }
  return repoRoot !== undefined ? { ok: true, repoRoot } : { ok: true };
}

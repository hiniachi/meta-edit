// Repository-root sentinel check (issue 1530 / Article 4 / SPEC §3).
//
// Before v0.2.3, `assertIsRepo` lived in `src/server.ts` and threw
// synchronously inside `createServer`. That eager throw had a silent and
// damaging side effect on the typed-edit hypothesis: when Claude Code
// launched the MCP server in a directory without `.git` (a fresh-checkout
// onboarding flow, a sibling repo, or a scratch dir), the server died
// before the transport handshake. Claude Code marked the MCP server as
// failed for the session and the eighteen tool descriptions never
// reached the running agent's context — even after the user ran
// `git init` and reconnected, descriptions might never re-inject. The
// agent kept calling typed_edit (validation/audit looked healthy) while
// the cognitive intervention was absent.
//
// Fix: move the check to a non-throwing predicate consumed by
// `validateRequest` at per-tool-call time. The MCP server boots
// successfully; ListTools returns eighteen descriptions; and the per-
// tool path-validation gate surfaces a clear `not_a_repository` error
// until the user runs `git init`.

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Verify that `dir` looks like a repository root by checking for a known
 * VCS sentinel (`.git` or `.jj`). Shallow check by design — full git
 * integrity is out of scope per SPEC.md §3 / Article 7. The goal is to
 * prevent silent misconfiguration: launching `meta-edit serve` from
 * `/tmp`, `/home`, `/`, etc. would otherwise let the MCP server treat
 * that directory as the editable root.
 *
 * Non-throwing. Returns `{ ok: false }` with a remediation-friendly
 * error message that callers (validateRequest / advisory log lines) can
 * surface verbatim. The matching `assertIsRepo` wrapper below is kept
 * for legacy throwing call-sites; new code should prefer this predicate.
 */
export function repoIsValid(
  dir: string,
): { ok: true } | { ok: false; error: string } {
  const sentinels = [".git", ".jj"];
  const found = sentinels.some((s) => fs.existsSync(path.join(dir, s)));
  if (found) return { ok: true };
  return {
    ok: false,
    error:
      `meta-edit: "${dir}" does not appear to be a repository root ` +
      `(no .git or .jj directory found). ` +
      `Run \`git init\` in this directory or restart the MCP server with ` +
      `--repo-root pointed at the actual repository root.`,
  };
}

/**
 * Throwing wrapper retained for backwards compatibility with any caller
 * that relied on the v0.1.x / v0.2.x behavior of `assertIsRepo` raising
 * synchronously. Modern callers (server.ts, tools/common.ts) consume
 * `repoIsValid` instead.
 */
export function assertIsRepo(dir: string): void {
  const result = repoIsValid(dir);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

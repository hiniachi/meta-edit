import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/registry.js";
import { type ValidationContext } from "./tools/common.js";
import { repoIsValid } from "./tools/repo-validity.js";
import { makeIssuingHandler } from "./tools/apply.js";
import { EditLog } from "./state/edit-log.js";
import { createGrantsStore } from "./state/grants.js";
import { VERSION } from "./version.js";

export type CreateServerOptions = {
  repoRoot?: string;
};

// Resolution precedence, kept STRUCTURALLY identical to the hooks'
// resolveRepoRoot (src/hooks/session-onboarding.ts /
// src/hooks/deny-raw-edit.ts): explicit override → $META_EDIT_REPO_ROOT
// → process.cwd(). Override branches are `path.resolve`-d; the cwd
// branch is returned bare (already absolute/normalized) — the same
// per-branch shape the hooks use, NOT a chain-wide resolve. The server
// and the hooks MUST land on the same root or their canonical forms
// diverge and the grant binding lookup fails (the jj-workspace /
// git-worktree / sub-directory-launch failure mode). The server's
// explicit-override branch is `options.repoRoot` (the `--repo-root`
// CLI flag); it occupies the slot the hooks fill with `eventCwd`.
function resolveRepoRoot(optionRepoRoot: string | undefined): string {
  if (typeof optionRepoRoot === "string" && optionRepoRoot.length > 0) {
    return path.resolve(optionRepoRoot);
  }
  const envRoot = process.env["META_EDIT_REPO_ROOT"];
  if (typeof envRoot === "string" && envRoot.length > 0) {
    return path.resolve(envRoot);
  }
  return process.cwd();
}

export function createServer(options: CreateServerOptions = {}): Server {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  // Issue 1530: do NOT throw here even if the repo-root sentinel is
  // absent. A synchronous throw inside createServer kills the MCP server
  // before transport handshake — Claude Code marks the server failed
  // for the session and the eighteen tool descriptions never reach the
  // running agent's context. Boot the server, let ListTools land the
  // descriptions, and let validateRequest surface the per-tool
  // not_a_repository error when the agent actually tries to edit.
  // Emit one advisory line to stderr so the operator sees the
  // misconfiguration without having to wait for the first failed call.
  const repoCheck = repoIsValid(repoRoot);
  if (!repoCheck.ok) {
    process.stderr.write(`[meta-edit] WARN: ${repoCheck.error}\n`);
  }
  const context: ValidationContext = { repoRoot };
  const log = new EditLog(repoRoot);
  const grants = createGrantsStore(repoRoot);
  const handler = makeIssuingHandler({
    ctx: context,
    log,
    grants,
  });

  const server = new Server(
    {
      name: "meta-edit",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );
  registerTools(server, { context, handler });
  return server;
}

export async function runStdioServer(options: CreateServerOptions = {}): Promise<void> {
  const server = createServer(options);
  const transport = new StdioServerTransport();

  process.stdin.once("end", () => {
    transport.close().catch(() => {
      /* transport already closing or closed; nothing to do */
    });
  });

  await server.connect(transport);

  await new Promise<void>((resolve) => {
    const previousOnClose = transport.onclose;
    transport.onclose = () => {
      previousOnClose?.call(transport);
      resolve();
    };
  });
}

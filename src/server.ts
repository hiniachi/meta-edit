import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/registry.js";
import { type ValidationContext } from "./tools/common.js";
import { repoIsValid } from "./tools/repo-validity.js";
import { makeIssuingHandler } from "./tools/apply.js";
import { EditLog } from "./state/edit-log.js";
import { createGrantsStore } from "./state/grants.js";
import { resolveRepoRoot } from "./utils/repo-paths.js";
import { VERSION } from "./version.js";

export type CreateServerOptions = {
  repoRoot?: string;
};

export function createServer(options: CreateServerOptions = {}): Server {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  // Issue 1530: do NOT throw here even if the repo-root sentinel is
  // absent. A synchronous throw inside createServer kills the MCP server
  // before transport handshake — Claude Code marks the server failed
  // for the session and the twenty-one tool descriptions never reach the
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

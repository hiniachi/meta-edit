import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/registry.js";
import {
  makeApplyingHandler,
  type ValidationContext,
} from "./tools/common.js";
import { applyChanges } from "./tools/apply.js";
import { EditLog } from "./state/edit-log.js";

export type CreateServerOptions = {
  repoRoot?: string;
};

export function createServer(options: CreateServerOptions = {}): Server {
  const repoRoot = options.repoRoot ?? process.cwd();
  const context: ValidationContext = { repoRoot };
  const log = new EditLog(repoRoot);
  const handler = makeApplyingHandler({
    ctx: context,
    log,
    applyChanges,
  });

  const server = new Server(
    {
      name: "meta-edit",
      version: "0.1.0",
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
  await server.connect(transport);
}

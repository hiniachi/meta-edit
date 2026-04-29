import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/registry.js";
import type { ValidationContext } from "./tools/common.js";

export type CreateServerOptions = {
  repoRoot?: string;
};

export function createServer(options: CreateServerOptions = {}): Server {
  const context: ValidationContext = {
    repoRoot: options.repoRoot ?? process.cwd(),
  };
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
  registerTools(server, { context });
  return server;
}

export async function runStdioServer(options: CreateServerOptions = {}): Promise<void> {
  const server = createServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

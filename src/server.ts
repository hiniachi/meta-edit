import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/registry.js";

export function createServer(): Server {
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
  registerTools(server);
  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

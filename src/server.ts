import * as fs from "node:fs";
import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/registry.js";
import {
  makeApplyingHandler,
  type ValidationContext,
} from "./tools/common.js";
import { applyChanges } from "./tools/apply.js";
import { EditLog } from "./state/edit-log.js";
import { VERSION } from "./version.js";

export type CreateServerOptions = {
  repoRoot?: string;
};

/**
 * Verify that `dir` looks like a repository root by checking for a known VCS
 * sentinel (`.git` or `.jj`).  This is intentionally a shallow check — full
 * git integrity is out of scope per SPEC.md §3.  The goal is to prevent
 * silent misconfiguration: launching `meta-edit serve` from `/tmp`, `/home`,
 * `/`, etc. would otherwise let the MCP server treat that directory as the
 * editable root.
 */
function assertIsRepo(dir: string): void {
  const sentinels = [".git", ".jj"];
  const found = sentinels.some((s) => fs.existsSync(path.join(dir, s)));
  if (!found) {
    throw new Error(
      `meta-edit: "${dir}" does not appear to be a repository root ` +
        `(no .git or .jj directory found). ` +
        `Start the server from the repository root or pass --repo-root.`,
    );
  }
}

export function createServer(options: CreateServerOptions = {}): Server {
  const repoRoot = options.repoRoot ?? process.cwd();
  assertIsRepo(repoRoot);
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

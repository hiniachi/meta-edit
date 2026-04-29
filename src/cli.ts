#!/usr/bin/env node
import { runStdioServer } from "./server.js";

const NOT_IMPLEMENTED = "not implemented (Phase 1 stub)";

async function main(argv: string[]): Promise<number> {
  const [, , subcommand, ...rest] = argv;

  switch (subcommand) {
    case undefined:
    case "-h":
    case "--help":
      printHelp();
      return 0;

    case "--version":
    case "-v":
      console.log("meta-edit 0.1.0");
      return 0;

    case "serve":
      await runStdioServer();
      return 0;

    case "log":
    case "summary":
    case "install-hooks":
    case "uninstall-hooks":
      console.error(`meta-edit ${subcommand}: ${NOT_IMPLEMENTED}`);
      return 64;

    default:
      console.error(`meta-edit: unknown subcommand "${subcommand}"`);
      printHelp();
      return 64;
  }
  // Unreachable; rest is reserved for future flag parsing.
  void rest;
}

function printHelp(): void {
  console.log(`meta-edit 0.1.0

Usage:
  meta-edit serve              Run the MCP stdio server.
  meta-edit log [filters]      Print edits.jsonl entries.
  meta-edit summary            Aggregate statistics from the edit log.
  meta-edit install-hooks      Install Claude Code hooks into settings.json.
  meta-edit uninstall-hooks    Remove Claude Code hooks from settings.json.
  meta-edit --version          Show version.
  meta-edit --help             Show this help.

See docs/SPEC.md for full specification.`);
}

main(process.argv).then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

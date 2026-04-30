#!/usr/bin/env node
import { runStdioServer } from "./server.js";
import { parseLogArgs, runLogCommand } from "./cli/log-cmd.js";
import { parseSummaryArgs, runSummaryCommand } from "./cli/summary-cmd.js";
import {
  parseHooksArgs,
  runInstallHooks,
  runUninstallHooks,
} from "./cli/hooks-cmd.js";

async function main(argv: string[]): Promise<number> {
  const [, , subcommand, ...rest] = argv;
  const out = process.stdout;
  const err = process.stderr;

  switch (subcommand) {
    case undefined:
    case "-h":
    case "--help":
      printHelp();
      return 0;

    case "--version":
    case "-v":
      out.write("meta-edit 0.1.1\n");
      return 0;

    case "serve":
      await runStdioServer();
      return 0;

    case "log": {
      const parsed = parseLogArgs(rest);
      if (!parsed.ok) {
        err.write(`meta-edit log: ${parsed.error}\n`);
        return 64;
      }
      return runLogCommand({
        repoRoot: process.cwd(),
        filters: parsed.filters,
        out,
        err,
      });
    }

    case "summary": {
      const parsed = parseSummaryArgs(rest);
      if (!parsed.ok) {
        err.write(`meta-edit summary: ${parsed.error}\n`);
        return 64;
      }
      return runSummaryCommand({
        repoRoot: process.cwd(),
        ...(parsed.since !== undefined ? { since: parsed.since } : {}),
        out,
        err,
      });
    }

    case "install-hooks": {
      const parsed = parseHooksArgs(rest);
      if (!parsed.ok) {
        err.write(`meta-edit install-hooks: ${parsed.error}\n`);
        return 64;
      }
      return runInstallHooks({ scope: parsed.scope, out, err });
    }

    case "uninstall-hooks": {
      const parsed = parseHooksArgs(rest);
      if (!parsed.ok) {
        err.write(`meta-edit uninstall-hooks: ${parsed.error}\n`);
        return 64;
      }
      return runUninstallHooks({ scope: parsed.scope, out, err });
    }

    default:
      err.write(`meta-edit: unknown subcommand "${subcommand}"\n`);
      printHelp();
      return 64;
  }
}

function printHelp(): void {
  process.stdout.write(`meta-edit 0.1.1

Usage:
  meta-edit serve                          Run the MCP stdio server.
  meta-edit log [--tool NAME] [--risk LEVEL] [--since DATE]
                                           Print edits.jsonl entries.
  meta-edit summary [--since DATE]         Aggregate statistics from the edit log.
  meta-edit install-hooks --scope user|project
                                           Install Claude Code hooks into settings.json.
  meta-edit uninstall-hooks --scope user|project
                                           Remove Claude Code hooks from settings.json.
  meta-edit --version                      Show version.
  meta-edit --help                         Show this help.

See docs/SPEC.md for full specification.
`);
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

#!/usr/bin/env node
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runStdioServer } from "./server.js";
import { parseLogArgs, runLogCommand } from "./cli/log-cmd.js";
import { parseSummaryArgs, runSummaryCommand } from "./cli/summary-cmd.js";
import {
  parseHooksArgs,
  runInstallHooks,
  runUninstallHooks,
} from "./cli/hooks-cmd.js";
import { VERSION } from "./version.js";
import { SPEC_URL } from "./docs-urls.js";

export async function main(argv: string[]): Promise<number> {
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
      out.write(`meta-edit ${VERSION}\n`);
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
  process.stdout.write(`meta-edit ${VERSION}

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

See ${SPEC_URL} for full specification.
`);
}

// Only run when invoked directly as a script (not when imported by tests).
// ESM-equivalent of `if (require.main === module)`.
//
// Codex review #36 caught a regression: comparing the raw `process.argv[1]`
// URL against `import.meta.url` breaks under the standard `npm`/`bun`
// install layout where `node_modules/.bin/meta-edit` is a symlink pointing
// at `dist/cli.js`. Node's ESM loader canonicalizes `import.meta.url` to
// the real path of the loaded module, while `process.argv[1]` retains the
// symlink path. The strings never match, so `meta-edit --version` (or any
// other subcommand) silently no-ops on every symlinked invocation — which
// is precisely the published entry point.
//
// Fix: canonicalize both sides via `fs.realpathSync` before comparison.
// Falls back to false on any error (typically ENOENT during unusual
// invocation modes — safer to treat as "not main" than to throw out of a
// top-level guard).
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    const argv1Real = fs.realpathSync(process.argv[1]);
    const moduleReal = fs.realpathSync(fileURLToPath(import.meta.url));
    return argv1Real === moduleReal;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv).then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}

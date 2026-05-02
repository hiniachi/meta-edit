// `meta-edit install-opencode` / `meta-edit uninstall-opencode`
// installer CLI for the opencode harness.
//
// Mirror of cli/hooks-cmd.ts (Claude Code installer). Reads / writes
// `opencode.json` for the chosen scope and adds (or removes) the two
// keys meta-edit needs to be active in opencode:
//
//   {
//     "mcp": {
//       "meta-edit": {
//         "type": "local",
//         "command": ["meta-edit", "serve"],
//         "enabled": true
//       }
//     },
//     "plugin": ["@hiniachi/meta-edit/opencode"]
//   }
//
// The MCP block brings the eighteen typed_edit tool descriptions into
// the agent's context (same stdio MCP server the Claude Code path
// uses). The plugin array entry loads `dist/opencode/plugin.js` (via
// the `./opencode` subpath export added in OC-5) into opencode's
// in-process plugin runtime; that plugin denies raw `edit` / `write` /
// `apply_patch` and dangerous `bash`.
//
// Symmetry with hooks-cmd.ts:
//   - `--scope user|project` chooses the config target.
//   - install / uninstall are idempotent (running twice is a no-op).
//   - Atomic write (stage to tmp, fsync, rename) preserves prior
//     content on failure.
//   - Unrelated keys / non-meta-edit `mcp` entries / non-meta-edit
//     `plugin` entries are preserved verbatim. uninstall touches only
//     the entries it owns.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Scope = "user" | "project";

/**
 * Canonical names of the opencode resources meta-edit owns. Used by
 * uninstall to know what to delete; install just uses these as keys.
 */
export const META_EDIT_OPENCODE_RESOURCES = {
  mcpServerName: "meta-edit",
  pluginPackage: "@hiniachi/meta-edit/opencode",
} as const;

/** Subset of opencode.json shape we read / write. */
export interface OpencodeConfigShape {
  mcp?: Record<string, unknown> | null;
  plugin?: unknown[] | unknown;
  [k: string]: unknown;
}

export interface InstallOpencodeOptions {
  scope: Scope;
  home?: string;
  cwd?: string;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
}

export function configPathForScope(
  scope: Scope,
  options: { home?: string; cwd?: string } = {},
): string {
  const home = options.home ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  if (scope === "user") {
    // opencode reads global config from $XDG_CONFIG_HOME/opencode/
    // (default ~/.config/opencode/) per its docs.
    return path.join(home, ".config", "opencode", "opencode.json");
  }
  return path.join(cwd, "opencode.json");
}

export function runInstallOpencode(opts: InstallOpencodeOptions): number {
  const target = configPathForScope(opts.scope, opts);
  let existing: OpencodeConfigShape;
  try {
    existing = readConfig(target);
  } catch (e) {
    opts.err.write(`meta-edit: ${(e as Error).message}\n`);
    return 1;
  }
  const updated = installMetaEditOpencode(existing);
  writeConfig(target, updated);
  opts.out.write(
    `meta-edit: installed opencode mcp + plugin into ${target}\n`,
  );
  return 0;
}

export function runUninstallOpencode(opts: InstallOpencodeOptions): number {
  const target = configPathForScope(opts.scope, opts);
  if (!fs.existsSync(target)) {
    opts.out.write(
      `meta-edit: ${target} does not exist; nothing to uninstall.\n`,
    );
    return 0;
  }
  let existing: OpencodeConfigShape;
  try {
    existing = readConfig(target);
  } catch (e) {
    opts.err.write(`meta-edit: ${(e as Error).message}\n`);
    return 1;
  }
  const updated = uninstallMetaEditOpencode(existing);
  writeConfig(target, updated);
  opts.out.write(
    `meta-edit: removed opencode mcp + plugin from ${target}\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------
// Pure transforms (export for unit testing without filesystem)
// ---------------------------------------------------------------------

export function installMetaEditOpencode(
  config: OpencodeConfigShape,
): OpencodeConfigShape {
  const out: OpencodeConfigShape = clone(config);

  // 1. mcp.meta-edit
  if (out.mcp === null || typeof out.mcp !== "object" || Array.isArray(out.mcp)) {
    // Hand-edited opencode.json may have `mcp` as garbage; replace
    // with empty object rather than crash. We only own the
    // `meta-edit` key; other sibling keys are preserved by clone().
    out.mcp = {};
  }
  const mcp = out.mcp as Record<string, unknown>;
  // Always overwrite our own entry so a stale config (e.g. older
  // command form) gets refreshed. We do not touch other servers.
  mcp[META_EDIT_OPENCODE_RESOURCES.mcpServerName] = {
    type: "local",
    command: ["meta-edit", "serve"],
    enabled: true,
  };

  // 2. plugin array
  let plugins: unknown[];
  if (Array.isArray(out.plugin)) {
    plugins = [...out.plugin];
  } else {
    // `plugin` missing or malformed → start fresh. We do NOT preserve
    // a non-array `plugin` value because opencode itself would reject
    // such a config; better to land a working install than to keep a
    // broken upstream value.
    plugins = [];
  }
  if (!plugins.includes(META_EDIT_OPENCODE_RESOURCES.pluginPackage)) {
    plugins.push(META_EDIT_OPENCODE_RESOURCES.pluginPackage);
  }
  out.plugin = plugins;

  return out;
}

export function uninstallMetaEditOpencode(
  config: OpencodeConfigShape,
): OpencodeConfigShape {
  const out: OpencodeConfigShape = clone(config);

  // 1. Drop our mcp entry (preserve siblings).
  if (out.mcp !== null && typeof out.mcp === "object" && !Array.isArray(out.mcp)) {
    const mcp = out.mcp as Record<string, unknown>;
    delete mcp[META_EDIT_OPENCODE_RESOURCES.mcpServerName];
    if (Object.keys(mcp).length === 0) {
      delete out.mcp;
    }
  }

  // 2. Drop our plugin entry (preserve siblings).
  if (Array.isArray(out.plugin)) {
    const remaining = (out.plugin as unknown[]).filter(
      (p) => p !== META_EDIT_OPENCODE_RESOURCES.pluginPackage,
    );
    if (remaining.length === 0) {
      delete out.plugin;
    } else {
      out.plugin = remaining;
    }
  }

  return out;
}

// ---------------------------------------------------------------------
// I/O helpers (mirror hooks-cmd.ts patterns)
// ---------------------------------------------------------------------

function readConfig(filePath: string): OpencodeConfigShape {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as OpencodeConfigShape;
  } catch (e) {
    throw new Error(
      `failed to parse ${filePath} as JSON: ${(e as Error).message}`,
    );
  }
}

function writeConfig(filePath: string, config: OpencodeConfigShape): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  let mode = 0o600;
  try {
    mode = fs.statSync(filePath).mode & 0o7777;
  } catch {
    /* missing file is fine */
  }

  const tempName =
    path.basename(filePath) +
    "." +
    crypto.randomBytes(8).toString("hex") +
    ".metaedit-tmp";
  const tempPath = path.join(dir, tempName);

  let fd: number | null = null;
  try {
    fd = fs.openSync(
      tempPath,
      // eslint-disable-next-line no-bitwise
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fs.writeFileSync(fd, JSON.stringify(config, null, 2) + "\n", {
      encoding: "utf8",
    });
    fs.fsyncSync(fd);
  } catch (e) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }

  try {
    fs.chmodSync(tempPath, mode);
  } catch {
    /* best effort */
  }

  try {
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function parseOpencodeArgs(argv: string[]): {
  ok: true;
  scope: Scope;
} | {
  ok: false;
  error: string;
} {
  let scope: Scope | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope") {
      const v = argv[++i];
      if (v !== "user" && v !== "project") {
        return { ok: false, error: `--scope must be "user" or "project" (got "${v}")` };
      }
      scope = v;
    } else {
      return { ok: false, error: `unknown flag: ${arg}` };
    }
  }
  if (scope === undefined) {
    return { ok: false, error: "--scope <user|project> is required" };
  }
  return { ok: true, scope };
}

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Scope = "user" | "project";

export const META_EDIT_CODEX_HOOK_COMMANDS = {
  preToolUse: "meta-edit-codex-deny-raw-edit",
  sessionStart: "meta-edit-codex-session-onboarding",
} as const;

export const META_EDIT_CODEX_PRE_TOOL_USE_MATCHER =
  "Bash|apply_patch|Edit|Write|MultiEdit|NotebookEdit";

const BEGIN = "# BEGIN meta-edit managed Codex config";
const END = "# END meta-edit managed Codex config";
const LEGACY_HEADER = "# meta-edit managed Codex hooks";

export function codexConfigPathForScope(
  scope: Scope,
  options: { home?: string; cwd?: string } = {},
): string {
  const home = options.home ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  if (scope === "user") {
    const codexHome = process.env.CODEX_HOME?.trim();
    if (codexHome !== undefined && codexHome.length > 0) {
      return path.join(codexHome, "config.toml");
    }
    return path.join(home, ".codex", "config.toml");
  }
  return path.join(cwd, ".codex", "config.toml");
}

export function installMetaEditCodex(configText: string): string {
  const withoutOld = removeManagedBlock(configText);
  if (hasUnmanagedMetaEditMcpServer(withoutOld)) {
    throw new Error(
      "refusing to install meta-edit Codex config: existing [mcp_servers.meta-edit] table is not managed by meta-edit",
    );
  }
  const trimmed = withoutOld.replace(/\s+$/u, "");
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  return `${prefix}${managedBlock()}\n`;
}

export function uninstallMetaEditCodex(configText: string): string {
  return removeLegacyLooseLines(removeManagedBlock(configText));
}

export type CodexCmdOptions = {
  scope: Scope;
  home?: string;
  cwd?: string;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
};

export function runInstallCodex(options: CodexCmdOptions): number {
  const target = codexConfigPathForScope(options.scope, options);
  let existing: string;
  try {
    existing = readTextConfig(target);
    writeTextConfig(target, installMetaEditCodex(existing));
  } catch (e) {
    options.err.write(`meta-edit: ${(e as Error).message}\n`);
    return 1;
  }
  options.out.write(`meta-edit: installed Codex hooks into ${target}\n`);
  return 0;
}

export function runUninstallCodex(options: CodexCmdOptions): number {
  const target = codexConfigPathForScope(options.scope, options);
  if (!fs.existsSync(target)) {
    options.out.write(
      `meta-edit: ${target} does not exist; nothing to uninstall.\n`,
    );
    return 0;
  }
  try {
    const existing = readTextConfig(target);
    writeTextConfig(target, uninstallMetaEditCodex(existing));
  } catch (e) {
    options.err.write(`meta-edit: ${(e as Error).message}\n`);
    return 1;
  }
  options.out.write(`meta-edit: removed Codex hooks from ${target}\n`);
  return 0;
}

export function parseCodexArgs(argv: string[]): {
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
        return {
          ok: false,
          error: `--scope must be "user" or "project" (got "${v}")`,
        };
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

function managedBlock(): string {
  return [
    BEGIN,
    "",
    "[mcp_servers.meta-edit]",
    'command = "meta-edit"',
    'args = ["serve"]',
    "",
    "[[hooks.PreToolUse]]",
    `matcher = "${META_EDIT_CODEX_PRE_TOOL_USE_MATCHER}"`,
    "",
    "[[hooks.PreToolUse.hooks]]",
    'type = "command"',
    `command = "${META_EDIT_CODEX_HOOK_COMMANDS.preToolUse}"`,
    'statusMessage = "Checking meta-edit declaration"',
    "",
    "[[hooks.SessionStart]]",
    'matcher = "startup|resume|clear|compact"',
    "",
    "[[hooks.SessionStart.hooks]]",
    'type = "command"',
    `command = "${META_EDIT_CODEX_HOOK_COMMANDS.sessionStart}"`,
    'statusMessage = "Loading meta-edit onboarding"',
    "",
    END,
  ].join("\n");
}

function removeManagedBlock(configText: string): string {
  const start = configText.indexOf(BEGIN);
  if (start === -1) return configText;
  const end = configText.indexOf(END, start);
  if (end === -1) return configText;
  const after = end + END.length;
  const beforeText = configText.slice(0, start).replace(/[ \t\r\n]*$/u, "");
  const afterText = configText.slice(after).replace(/^\s*\n?/u, "");
  if (beforeText.length === 0) return afterText;
  if (afterText.length === 0) return `${beforeText}\n`;
  return `${beforeText}\n\n${afterText}`;
}

function removeLegacyLooseLines(configText: string): string {
  const lines = configText.split(/\r?\n/u);
  const commandLines = new Set(
    Object.values(META_EDIT_CODEX_HOOK_COMMANDS).map(
      (cmd) => `command = "${cmd}"`,
    ),
  );
  const filtered: string[] = [];
  let inLegacy = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === LEGACY_HEADER) {
      inLegacy = true;
      continue;
    }
    if (inLegacy) {
      if (trimmed.length === 0 || trimmed.startsWith("[")) {
        inLegacy = false;
      } else if (commandLines.has(trimmed)) {
        continue;
      }
    }
    filtered.push(line);
  }
  return filtered.join("\n").replace(/\s+$/u, "") + "\n";
}

function hasUnmanagedMetaEditMcpServer(configText: string): boolean {
  const key = String.raw`(?:"meta-edit"|'meta-edit'|meta-edit)`;
  const root = String.raw`(?:"mcp_servers"|'mcp_servers'|mcp_servers)`;
  return new RegExp(
    String.raw`^\s*\[\s*${root}\s*\.\s*${key}\s*\]\s*(?:#.*)?$`,
    "mu",
  ).test(configText);
}

function readTextConfig(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function writeTextConfig(filePath: string, configText: string): void {
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
    fs.writeFileSync(fd, configText, { encoding: "utf8" });
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

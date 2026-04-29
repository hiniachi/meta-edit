import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Claude Code hook configuration shape (subset). We only read/write the
// keys we care about; everything else in settings.json is left untouched.

export type HookMatcherEntry = {
  matcher: string;
  hooks: Array<{ type: "command"; command: string }>;
};

export type SettingsShape = {
  hooks?: {
    PreToolUse?: HookMatcherEntry[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

export type Scope = "user" | "project";

export const META_EDIT_HOOK_COMMANDS = {
  rawEdit: "meta-edit-deny-raw-edit",
  bashWriteBypass: "meta-edit-deny-bash-write-bypass",
} as const;

const META_EDIT_RAW_EDIT_MATCHER = "Edit|Write|MultiEdit";
const META_EDIT_BASH_MATCHER = "Bash";

export function settingsPathForScope(
  scope: Scope,
  options: { home?: string; cwd?: string } = {},
): string {
  const home = options.home ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  if (scope === "user") {
    return path.join(home, ".claude", "settings.json");
  }
  return path.join(cwd, ".claude", "settings.json");
}

export type HooksCmdOptions = {
  scope: Scope;
  home?: string;
  cwd?: string;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
};

export function runInstallHooks(options: HooksCmdOptions): number {
  const target = settingsPathForScope(options.scope, options);
  const existing = readSettings(target);
  const updated = installMetaEditHooks(existing);
  writeSettings(target, updated);
  options.out.write(
    `meta-edit: installed PreToolUse hooks into ${target}\n`,
  );
  return 0;
}

export function runUninstallHooks(options: HooksCmdOptions): number {
  const target = settingsPathForScope(options.scope, options);
  if (!fs.existsSync(target)) {
    options.out.write(
      `meta-edit: ${target} does not exist; nothing to uninstall.\n`,
    );
    return 0;
  }
  const existing = readSettings(target);
  const updated = uninstallMetaEditHooks(existing);
  writeSettings(target, updated);
  options.out.write(
    `meta-edit: removed PreToolUse hooks from ${target}\n`,
  );
  return 0;
}

export function installMetaEditHooks(
  settings: SettingsShape,
): SettingsShape {
  const out: SettingsShape = clone(settings);
  out.hooks = out.hooks ?? {};
  out.hooks.PreToolUse = out.hooks.PreToolUse ?? [];
  ensureMatcherEntry(
    out.hooks.PreToolUse,
    META_EDIT_RAW_EDIT_MATCHER,
    META_EDIT_HOOK_COMMANDS.rawEdit,
  );
  ensureMatcherEntry(
    out.hooks.PreToolUse,
    META_EDIT_BASH_MATCHER,
    META_EDIT_HOOK_COMMANDS.bashWriteBypass,
  );
  return out;
}

export function uninstallMetaEditHooks(
  settings: SettingsShape,
): SettingsShape {
  const out: SettingsShape = clone(settings);
  if (!out.hooks?.PreToolUse) {
    return out;
  }
  const stripped = out.hooks.PreToolUse.map((entry) => ({
    ...entry,
    hooks: entry.hooks.filter(
      (h) => !isMetaEditHookCommand(h.command),
    ),
  })).filter((entry) => entry.hooks.length > 0);

  if (stripped.length === 0) {
    delete out.hooks.PreToolUse;
    if (Object.keys(out.hooks).length === 0) {
      delete out.hooks;
    }
  } else {
    out.hooks.PreToolUse = stripped;
  }
  return out;
}

function ensureMatcherEntry(
  list: HookMatcherEntry[],
  matcher: string,
  command: string,
): void {
  // Idempotent only when we find a matcher entry whose `matcher` string
  // EXACTLY equals what we want and whose hooks already include our
  // command. A narrower user-edited matcher (e.g. `Edit|Write` instead
  // of `Edit|Write|MultiEdit`) does NOT count as covering us — leaving
  // it alone would silently leave `MultiEdit` unprotected. In that case
  // we add a new matcher entry with the required matcher; the user can
  // clean up the duplicate on Edit/Write afterwards (the hook decision
  // is idempotent so duplicate firing is at worst noisy, not unsafe).
  const exactMatch = list.find(
    (e) =>
      e.matcher === matcher &&
      e.hooks.some((h) => h.command === command),
  );
  if (exactMatch !== undefined) {
    return;
  }

  let entry = list.find((e) => e.matcher === matcher);
  if (entry === undefined) {
    entry = { matcher, hooks: [] };
    list.push(entry);
  }
  if (!entry.hooks.some((h) => h.command === command)) {
    entry.hooks.push({ type: "command", command });
  }
}

// Match meta-edit-owned hook commands strictly. We accept:
//   - the exact bin name (`meta-edit-deny-raw-edit`)
//   - an absolute or relative path whose BASENAME is exactly the bin name
//     (`/usr/local/bin/meta-edit-deny-raw-edit`,
//      `./node_modules/.bin/meta-edit-deny-raw-edit`)
// We do NOT match suffixed wrappers (`meta-edit-deny-raw-edit-WRAPPER.js`),
// node-invoked forms (`node /path/to/deny-raw-edit.js`), or any other
// substring containment. Plugin-managed installs use templated paths
// like `${CLAUDE_PLUGIN_ROOT}/...` — those are owned by the plugin
// runtime and uninstall-hooks deliberately does not touch them.
function isMetaEditHookCommand(cmd: string): boolean {
  const owned: readonly string[] = [
    META_EDIT_HOOK_COMMANDS.rawEdit,
    META_EDIT_HOOK_COMMANDS.bashWriteBypass,
  ];
  if (owned.includes(cmd)) return true;
  const basename = path.basename(cmd);
  return owned.includes(basename);
}

function readSettings(filePath: string): SettingsShape {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim().length === 0) return {};
  return JSON.parse(text) as SettingsShape;
}

function writeSettings(filePath: string, settings: SettingsShape): void {
  // Atomic write: stage to a same-directory temp file, fsync, rename. A
  // mid-write failure (process kill, disk full, EACCES) leaves the
  // original settings.json untouched rather than truncated.
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Preserve mode if there's an existing file; default to 0o600 so we
  // never widen permissions on a newly-created settings file.
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
    fs.writeFileSync(fd, JSON.stringify(settings, null, 2) + "\n", {
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
    // The temp file contains the full settings JSON; clean it up so we
    // don't leave a copy of the user's settings on disk under an
    // unexpected filename.
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

export function parseHooksArgs(argv: string[]): {
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

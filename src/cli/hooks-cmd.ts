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

// Matcher string written into Claude Code's PreToolUse routing config.
// MUST list every tool the runtime policy in deny-raw-edit.ts denies —
// otherwise Claude Code never invokes the hook for the missing tool and
// the deny is silently bypassed end-to-end (the bug fixed in a3-02).
// Keep this in lockstep with RAW_EDIT_TOOLS in raw-edit-policy.ts.
//
// Note on `apply_patch`: this is an opencode-only tool name added to
// RAW_EDIT_TOOLS so the same canonical set covers both harnesses
// (CLAUDE.md / SPEC Article 8). On Claude Code the tool does not exist,
// so this matcher entry is a dead route that never fires; including it
// in the matcher keeps the drift-prevention test (matcher size ===
// RAW_EDIT_TOOLS.size) honest without forking the constant per harness.
export const META_EDIT_RAW_EDIT_MATCHER =
  "Edit|Write|MultiEdit|NotebookEdit|apply_patch";
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
  let existing: SettingsShape;
  try {
    existing = readSettings(target);
  } catch (e) {
    options.err.write(`meta-edit: ${(e as Error).message}\n`);
    return 1;
  }
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
  let existing: SettingsShape;
  try {
    existing = readSettings(target);
  } catch (e) {
    options.err.write(`meta-edit: ${(e as Error).message}\n`);
    return 1;
  }
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
  // Coerce hooks/PreToolUse into a usable shape. A hand-edited
  // settings.json may have `hooks` as a non-object or `PreToolUse` as
  // a non-array; in either case we replace with an empty array rather
  // than letting `e.hooks.some(...)` crash downstream. This is safe
  // because if the user wrote garbage there, our install would already
  // be incompatible — we just need to avoid throwing.
  if (out.hooks === null || typeof out.hooks !== "object" || Array.isArray(out.hooks)) {
    out.hooks = {};
  }
  if (!Array.isArray(out.hooks.PreToolUse)) {
    out.hooks.PreToolUse = [];
  }
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
  if (!Array.isArray(out.hooks.PreToolUse)) {
    // Non-array PreToolUse — user-owned data we don't recognize. Leave
    // the value exactly as we found it.
    return out;
  }

  // Walk every entry. We only modify entries that match our typed
  // matcher-entry shape; any entry we don't recognize (non-object,
  // missing `hooks` array, ...) is preserved verbatim. We never drop
  // entries we don't own. The only entries we DO drop are the ones we
  // ourselves emptied — i.e. matcher objects whose hooks array
  // contained only meta-edit-owned commands and is empty after we
  // removed them.
  const next: HookMatcherEntry[] = [];
  for (const entry of out.hooks.PreToolUse) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      // Non-object — preserve as-is.
      next.push(entry as HookMatcherEntry);
      continue;
    }
    const handlers = (entry as { hooks?: unknown }).hooks;
    if (!Array.isArray(handlers)) {
      // Object missing/malformed `hooks` field — preserve as-is.
      next.push(entry as HookMatcherEntry);
      continue;
    }
    const remaining = handlers.filter((h) => {
      // Only consider for removal entries that are real
      // {type:"command", command:string} objects whose command we own.
      // Anything else (different shape / type) is left untouched.
      if (h === null || typeof h !== "object") return true;
      const t = (h as { type?: unknown }).type;
      const c = (h as { command?: unknown }).command;
      if (t !== "command" || typeof c !== "string") return true;
      return !isMetaEditHookCommand(c);
    });
    if (remaining.length === 0 && handlers.length > 0) {
      // We emptied this matcher entry of our own hooks; drop the now-
      // useless matcher entry to keep settings.json tidy.
      continue;
    }
    next.push({ ...(entry as object), hooks: remaining } as HookMatcherEntry);
  }

  if (next.length === 0) {
    delete out.hooks.PreToolUse;
    if (Object.keys(out.hooks).length === 0) {
      delete out.hooks;
    }
  } else {
    out.hooks.PreToolUse = next;
  }
  return out;
}

function ensureMatcherEntry(
  list: HookMatcherEntry[],
  matcher: string,
  command: string,
): void {
  // Defensive: a hand-edited settings.json may contain entries that
  // aren't objects, lack a `hooks` array, or have non-string `command`
  // fields. We must NOT crash on those, must NOT modify them (they're
  // user-owned), and must still produce a correct install for our own
  // shape.
  const safeHooksOf = (e: unknown): Array<{ command?: unknown }> | null => {
    if (e === null || typeof e !== "object") return null;
    const h = (e as { hooks?: unknown }).hooks;
    return Array.isArray(h) ? (h as Array<{ command?: unknown }>) : null;
  };
  const matcherOf = (e: unknown): string | null => {
    if (e === null || typeof e !== "object") return null;
    const m = (e as { matcher?: unknown }).matcher;
    return typeof m === "string" ? m : null;
  };

  // Idempotent only when we find a matcher entry whose `matcher` string
  // EXACTLY equals what we want and whose hooks already include our
  // command. A narrower user-edited matcher (e.g. `Edit|Write` instead
  // of `Edit|Write|MultiEdit`) does NOT count as covering us.
  const exactMatch = list.find((e) => {
    if (matcherOf(e) !== matcher) return false;
    const hooks = safeHooksOf(e);
    if (hooks === null) return false;
    return hooks.some((h) => h !== null && typeof h === "object" && (h as { command?: unknown }).command === command);
  });
  if (exactMatch !== undefined) {
    return;
  }

  let entry = list.find((e) => matcherOf(e) === matcher && safeHooksOf(e) !== null) as
    | HookMatcherEntry
    | undefined;
  if (entry === undefined) {
    entry = { matcher, hooks: [] };
    list.push(entry);
  }
  if (!entry.hooks.some((h) => h !== null && typeof h === "object" && (h as { command?: unknown }).command === command)) {
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
  try {
    return JSON.parse(text) as SettingsShape;
  } catch (e) {
    throw new Error(
      `failed to parse ${filePath} as JSON: ${(e as Error).message}`,
    );
  }
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

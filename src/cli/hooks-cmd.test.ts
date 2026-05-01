import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  installMetaEditHooks,
  uninstallMetaEditHooks,
  runInstallHooks,
  runUninstallHooks,
  settingsPathForScope,
  parseHooksArgs,
  META_EDIT_HOOK_COMMANDS,
  META_EDIT_RAW_EDIT_MATCHER,
  type HookMatcherEntry,
  type SettingsShape,
} from "./hooks-cmd.js";

let tmpRoot: string;
let collectedOut: string[];
let collectedErr: string[];
const out: NodeJS.WritableStream = {
  write: ((s: string) => {
    collectedOut.push(s);
    return true;
  }),
} as unknown as NodeJS.WritableStream;
const err: NodeJS.WritableStream = {
  write: ((s: string) => {
    collectedErr.push(s);
    return true;
  }),
} as unknown as NodeJS.WritableStream;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-hooks-cmd-"));
  collectedOut = [];
  collectedErr = [];
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("META_EDIT_RAW_EDIT_MATCHER constant (a3-02 install-hooks coverage)", () => {
  it("includes NotebookEdit so install-hooks emits a 4-tool matcher", () => {
    // The runtime policy in deny-raw-edit denies NotebookEdit (a3-02), but
    // that only fires if Claude Code's PreToolUse routing actually invokes
    // the hook for NotebookEdit calls. Routing is matcher-driven, so the
    // matcher string written by `meta-edit install-hooks` MUST list
    // NotebookEdit. If this constant drifts back to the 3-tool form,
    // a3-02 silently regresses end-to-end.
    expect(META_EDIT_RAW_EDIT_MATCHER).toBe(
      "Edit|Write|MultiEdit|NotebookEdit",
    );
  });

  it("install writes a matcher entry that names NotebookEdit", () => {
    const r = installMetaEditHooks({});
    const rawEditEntry = r.hooks?.PreToolUse?.find((e) =>
      e.hooks.some((h) => h.command === META_EDIT_HOOK_COMMANDS.rawEdit),
    );
    expect(rawEditEntry?.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
    expect(rawEditEntry?.matcher).toContain("NotebookEdit");
  });
});

describe("installMetaEditHooks (pure)", () => {
  it("creates the hooks block on an empty settings object", () => {
    const r = installMetaEditHooks({});
    expect(r.hooks?.PreToolUse?.length).toBe(2);
    expect(r.hooks?.PreToolUse?.[0]?.matcher).toBe(
      "Edit|Write|MultiEdit|NotebookEdit",
    );
    expect(r.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command).toBe(
      META_EDIT_HOOK_COMMANDS.rawEdit,
    );
    expect(r.hooks?.PreToolUse?.[1]?.matcher).toBe("Bash");
    expect(r.hooks?.PreToolUse?.[1]?.hooks?.[0]?.command).toBe(
      META_EDIT_HOOK_COMMANDS.bashWriteBypass,
    );
  });

  it("preserves unrelated keys", () => {
    const before: SettingsShape = {
      theme: "dark",
      hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo done" }] }] },
    } as unknown as SettingsShape;
    const after = installMetaEditHooks(before);
    expect(after["theme"]).toBe("dark");
    expect((after.hooks as Record<string, unknown>)["PostToolUse"]).toBeDefined();
    expect(after.hooks?.PreToolUse?.length).toBe(2);
  });

  it("is idempotent — running twice yields the same shape", () => {
    const once = installMetaEditHooks({});
    const twice = installMetaEditHooks(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("merges into an existing PreToolUse matcher without duplicating", () => {
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit|NotebookEdit",
            hooks: [{ type: "command", command: "user-custom-edit-hook" }],
          },
        ],
      },
    };
    const after = installMetaEditHooks(before);
    const editEntry = after.hooks?.PreToolUse?.find(
      (e) => e.matcher === "Edit|Write|MultiEdit|NotebookEdit",
    );
    expect(editEntry?.hooks.length).toBe(2);
    const cmds = editEntry?.hooks.map((h) => h.command);
    expect(cmds).toContain("user-custom-edit-hook");
    expect(cmds).toContain(META_EDIT_HOOK_COMMANDS.rawEdit);
  });

  it("does not crash on a malformed PreToolUse entry missing hooks", () => {
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          { matcher: "Edit|Write|MultiEdit" } as unknown as HookMatcherEntry,
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "user-bash-hook" }],
          },
        ],
      },
    };
    expect(() => installMetaEditHooks(before)).not.toThrow();
    const after = installMetaEditHooks(before);
    const cmds = (after.hooks?.PreToolUse ?? [])
      .flatMap((e) => (Array.isArray(e.hooks) ? e.hooks : []))
      .map((h) => (h as { command?: string }).command);
    expect(cmds).toContain(META_EDIT_HOOK_COMMANDS.rawEdit);
    expect(cmds).toContain(META_EDIT_HOOK_COMMANDS.bashWriteBypass);
    expect(cmds).toContain("user-bash-hook");
  });

  it("does not crash when out.hooks.PreToolUse is not an array", () => {
    const before = {
      hooks: { PreToolUse: "garbage" },
    } as unknown as SettingsShape;
    expect(() => installMetaEditHooks(before)).not.toThrow();
    const after = installMetaEditHooks(before);
    expect(Array.isArray(after.hooks?.PreToolUse)).toBe(true);
  });

  it("does not crash when out.hooks is not an object", () => {
    const before = { hooks: 42 } as unknown as SettingsShape;
    expect(() => installMetaEditHooks(before)).not.toThrow();
  });

  it("adds a full Edit|Write|MultiEdit|NotebookEdit entry even when a narrower user matcher already has our hook", () => {
    // A user-edited narrower matcher (Edit|Write) is NOT treated as
    // sufficient because MultiEdit and NotebookEdit would be
    // unprotected. install adds a new exact-matcher entry alongside;
    // the duplicate firing on Edit/Write is idempotent (deny is deny).
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [
              { type: "command", command: META_EDIT_HOOK_COMMANDS.rawEdit },
            ],
          },
        ],
      },
    };
    const after = installMetaEditHooks(before);
    const editMatchers = after.hooks?.PreToolUse?.filter((e) =>
      e.hooks.some((h) => h.command === META_EDIT_HOOK_COMMANDS.rawEdit),
    );
    expect(editMatchers?.length).toBe(2);
    expect(editMatchers?.map((e) => e.matcher).sort()).toEqual(
      ["Edit|Write", "Edit|Write|MultiEdit|NotebookEdit"].sort(),
    );
  });

  it("is idempotent when an exact-matcher entry with our hook already exists", () => {
    const before = installMetaEditHooks({});
    const after = installMetaEditHooks(before);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe("uninstallMetaEditHooks (pure)", () => {
  it("removes meta-edit hooks while keeping unrelated entries", () => {
    const installed = installMetaEditHooks({
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: "user-custom-hook" }],
          },
        ],
      },
    });
    const stripped = uninstallMetaEditHooks(installed);
    const editEntry = stripped.hooks?.PreToolUse?.find(
      (e) => e.matcher === "Edit|Write|MultiEdit",
    );
    expect(editEntry?.hooks.length).toBe(1);
    expect(editEntry?.hooks[0]?.command).toBe("user-custom-hook");
  });

  it("removes empty matcher entries entirely", () => {
    const installed = installMetaEditHooks({});
    const stripped = uninstallMetaEditHooks(installed);
    expect(stripped.hooks).toBeUndefined();
  });

  it("is a no-op on settings that have no meta-edit hooks", () => {
    const before: SettingsShape = {
      theme: "dark",
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user-hook" }] }] },
    } as unknown as SettingsShape;
    const after = uninstallMetaEditHooks(before);
    expect(after.hooks?.PreToolUse?.length).toBe(1);
    expect(after.hooks?.PreToolUse?.[0]?.hooks[0]?.command).toBe("user-hook");
  });

  it("matches absolute-path command variants", () => {
    const installed: SettingsShape = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [
              { type: "command", command: "/usr/local/bin/meta-edit-deny-raw-edit" },
            ],
          },
        ],
      },
    };
    const stripped = uninstallMetaEditHooks(installed);
    expect(stripped.hooks).toBeUndefined();
  });

  it("does not crash on a non-command hook handler (defensive iteration)", () => {
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [
              { type: "command", command: META_EDIT_HOOK_COMMANDS.rawEdit },
              // A future / non-command handler shape the user added by
              // hand. We must NOT crash and MUST leave it alone.
              { type: "script", body: "console.log('hi')" } as unknown as {
                type: "command";
                command: string;
              },
            ],
          },
        ],
      },
    };
    const after = uninstallMetaEditHooks(before);
    const editEntry = after.hooks?.PreToolUse?.find(
      (e) => e.matcher === "Edit|Write|MultiEdit",
    );
    expect(editEntry?.hooks.length).toBe(1);
    expect((editEntry?.hooks[0] as { type: string }).type).toBe("script");
  });

  it("does not crash on a hook handler missing a command field", () => {
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [
              { type: "command" } as unknown as {
                type: "command";
                command: string;
              },
              { type: "command", command: META_EDIT_HOOK_COMMANDS.rawEdit },
            ],
          },
        ],
      },
    };
    const after = uninstallMetaEditHooks(before);
    const editEntry = after.hooks?.PreToolUse?.find(
      (e) => e.matcher === "Edit|Write|MultiEdit",
    );
    expect(editEntry?.hooks.length).toBe(1);
    expect((editEntry?.hooks[0] as { command?: string }).command).toBeUndefined();
  });

  it("does not crash on a matcher entry whose hooks field is missing", () => {
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          { matcher: "Edit|Write|MultiEdit" } as unknown as HookMatcherEntry,
        ],
      },
    };
    expect(() => uninstallMetaEditHooks(before)).not.toThrow();
  });

  it("preserves non-object PreToolUse entries verbatim", () => {
    // A user might (incorrectly) hand-edit a stray string or number into
    // their PreToolUse array. We must NOT drop it just because it isn't
    // a matcher object.
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          "user-typo-entry" as unknown as HookMatcherEntry,
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: META_EDIT_HOOK_COMMANDS.rawEdit }],
          },
          42 as unknown as HookMatcherEntry,
        ],
      },
    };
    const after = uninstallMetaEditHooks(before);
    // Our hook removed; the matcher entry is now empty so it's dropped.
    // BUT the two non-object entries must remain in place and in order.
    expect(after.hooks?.PreToolUse).toEqual([
      "user-typo-entry" as unknown as HookMatcherEntry,
      42 as unknown as HookMatcherEntry,
    ]);
  });

  it("preserves matcher entries whose hooks field is malformed", () => {
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          { matcher: "Edit|Write|MultiEdit", hooks: "broken" } as unknown as HookMatcherEntry,
        ],
      },
    };
    const after = uninstallMetaEditHooks(before);
    expect(after.hooks?.PreToolUse?.length).toBe(1);
    expect((after.hooks?.PreToolUse?.[0] as { hooks: unknown }).hooks).toBe(
      "broken",
    );
  });

  it("preserves a non-array PreToolUse value verbatim", () => {
    const before = {
      hooks: { PreToolUse: "garbage" },
    } as unknown as SettingsShape;
    const after = uninstallMetaEditHooks(before);
    expect((after.hooks as { PreToolUse: unknown }).PreToolUse).toBe("garbage");
  });

  it("does NOT remove a user wrapper that merely contains the bin name as a substring", () => {
    const before: SettingsShape = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [
              {
                type: "command",
                command: "/usr/local/bin/meta-edit-deny-raw-edit-WRAPPER.js",
              },
            ],
          },
        ],
      },
    };
    const after = uninstallMetaEditHooks(before);
    const editEntry = after.hooks?.PreToolUse?.find(
      (e) => e.matcher === "Edit|Write|MultiEdit",
    );
    expect(editEntry?.hooks.length).toBe(1);
    expect(editEntry?.hooks[0]?.command).toContain("WRAPPER");
  });
});

describe("runInstallHooks (effectful)", () => {
  it("creates settings.json under --scope project", () => {
    runInstallHooks({ scope: "project", cwd: tmpRoot, out, err });
    const target = settingsPathForScope("project", { cwd: tmpRoot });
    expect(fs.existsSync(target)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.hooks.PreToolUse.length).toBe(2);
  });

  it("merges into an existing user settings.json without losing keys", () => {
    const target = settingsPathForScope("user", { home: tmpRoot });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ theme: "dark" }), "utf8");

    runInstallHooks({ scope: "user", home: tmpRoot, out, err });

    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.theme).toBe("dark");
    expect(parsed.hooks.PreToolUse.length).toBe(2);
  });

  it("uninstall removes hooks and leaves theme intact", () => {
    runInstallHooks({ scope: "project", cwd: tmpRoot, out, err });
    const target = settingsPathForScope("project", { cwd: tmpRoot });
    const installed = JSON.parse(fs.readFileSync(target, "utf8"));
    installed.theme = "light";
    fs.writeFileSync(target, JSON.stringify(installed), "utf8");

    runUninstallHooks({ scope: "project", cwd: tmpRoot, out, err });

    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.theme).toBe("light");
    expect(parsed.hooks).toBeUndefined();
  });

  it("uninstall on missing settings.json is a no-op (does not throw)", () => {
    const code = runUninstallHooks({ scope: "project", cwd: tmpRoot, out, err });
    expect(code).toBe(0);
    expect(collectedOut.join("")).toContain("nothing to uninstall");
  });
});

describe("parseHooksArgs", () => {
  it("requires --scope", () => {
    expect(parseHooksArgs([]).ok).toBe(false);
  });

  it("rejects an unknown scope", () => {
    expect(parseHooksArgs(["--scope", "everything"]).ok).toBe(false);
  });

  it("parses --scope user", () => {
    const r = parseHooksArgs(["--scope", "user"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scope).toBe("user");
  });

  it("parses --scope project", () => {
    const r = parseHooksArgs(["--scope", "project"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scope).toBe("project");
  });
});

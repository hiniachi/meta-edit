import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  asWritableStream,
  cleanTmpRoot,
  makeTmpRoot,
  StringStream,
} from "../test-helpers.js";

type Scope = "user" | "project";

type CodexArgsResult =
  | { ok: true; scope: Scope }
  | { ok: false; error: string };

type CodexCmdModule = {
  META_EDIT_CODEX_HOOK_COMMANDS: {
    preToolUse: string;
    sessionStart: string;
  };
  META_EDIT_CODEX_PRE_TOOL_USE_MATCHER: string;
  codexConfigPathForScope(
    scope: Scope,
    options?: { home?: string; cwd?: string },
  ): string;
  installMetaEditCodex(configText: string): string;
  uninstallMetaEditCodex(configText: string): string;
  parseCodexArgs(argv: string[]): CodexArgsResult;
  runInstallCodex(options: {
    scope: Scope;
    home?: string;
    cwd?: string;
    out: NodeJS.WritableStream;
    err: NodeJS.WritableStream;
  }): number;
  runUninstallCodex(options: {
    scope: Scope;
    home?: string;
    cwd?: string;
    out: NodeJS.WritableStream;
    err: NodeJS.WritableStream;
  }): number;
};

const CODEX_CMD_MODULE = "./codex-cmd.js";

async function loadCodexCmd(): Promise<CodexCmdModule> {
  return (await import(CODEX_CMD_MODULE)) as CodexCmdModule;
}

let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
  tmpHome = makeTmpRoot("codex-cmd-home");
  tmpCwd = makeTmpRoot("codex-cmd-cwd");
});

afterEach(() => {
  cleanTmpRoot(tmpHome);
  cleanTmpRoot(tmpCwd);
});

describe("META_EDIT_CODEX_HOOK_COMMANDS", () => {
  it("names the package-level Codex hook bins", async () => {
    const { META_EDIT_CODEX_HOOK_COMMANDS } = await loadCodexCmd();

    expect(META_EDIT_CODEX_HOOK_COMMANDS).toEqual({
      preToolUse: "meta-edit-codex-deny-raw-edit",
      sessionStart: "meta-edit-codex-session-onboarding",
    });
  });
});

describe("codexConfigPathForScope", () => {
  it("user scope targets CODEX_HOME-style config.toml", async () => {
    const { codexConfigPathForScope } = await loadCodexCmd();

    expect(codexConfigPathForScope("user", { home: "/h" })).toBe(
      path.join("/h", ".codex", "config.toml"),
    );
  });

  it("project scope targets <cwd>/.codex/config.toml", async () => {
    const { codexConfigPathForScope } = await loadCodexCmd();

    expect(codexConfigPathForScope("project", { cwd: "/p" })).toBe(
      path.join("/p", ".codex", "config.toml"),
    );
  });

  it("user scope uses CODEX_HOME/config.toml when CODEX_HOME is set", async () => {
    const { codexConfigPathForScope } = await loadCodexCmd();
    const oldCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(tmpHome, "codex-home");

    try {
      expect(codexConfigPathForScope("user", { home: "/ignored-home" })).toBe(
        path.join(process.env.CODEX_HOME, "config.toml"),
      );
      expect(codexConfigPathForScope("project", { cwd: "/p" })).toBe(
        path.join("/p", ".codex", "config.toml"),
      );
    } finally {
      if (oldCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = oldCodexHome;
      }
    }
  });
});

describe("parseCodexArgs", () => {
  it("requires --scope", async () => {
    const { parseCodexArgs } = await loadCodexCmd();

    expect(parseCodexArgs([])).toEqual({
      ok: false,
      error: "--scope <user|project> is required",
    });
  });

  it("accepts user and project scope", async () => {
    const { parseCodexArgs } = await loadCodexCmd();

    expect(parseCodexArgs(["--scope", "user"])).toEqual({
      ok: true,
      scope: "user",
    });
    expect(parseCodexArgs(["--scope", "project"])).toEqual({
      ok: true,
      scope: "project",
    });
  });

  it("rejects unknown flags", async () => {
    const { parseCodexArgs } = await loadCodexCmd();

    expect(parseCodexArgs(["--bogus"])).toEqual({
      ok: false,
      error: "unknown flag: --bogus",
    });
  });
});

describe("installMetaEditCodex / uninstallMetaEditCodex (pure config transform)", () => {
  it("adds PreToolUse and SessionStart hook commands while preserving existing TOML", async () => {
    const {
      installMetaEditCodex,
      META_EDIT_CODEX_HOOK_COMMANDS,
    } = await loadCodexCmd();

    const before = [
      'model = "gpt-5.5"',
      "",
      '[projects."/repo"]',
      'trust_level = "trusted"',
      "",
    ].join("\n");

    const after = installMetaEditCodex(before);

    expect(after).toContain('model = "gpt-5.5"');
    expect(after).toContain('[projects."/repo"]');
    expect(after).toContain(META_EDIT_CODEX_HOOK_COMMANDS.preToolUse);
    expect(after).toContain(META_EDIT_CODEX_HOOK_COMMANDS.sessionStart);
    expect(after).toContain("PreToolUse");
    expect(after).toContain("SessionStart");
    expect(after).toContain("Bash");
    expect(after).toContain("apply_patch");
  });

  it("is idempotent", async () => {
    const { installMetaEditCodex } = await loadCodexCmd();

    const once = installMetaEditCodex('model = "gpt-5.5"\n');
    const twice = installMetaEditCodex(once);

    expect(twice).toBe(once);
  });

  it("emits a PreToolUse matcher that routes apply_patch and every raw write tool", async () => {
    const {
      installMetaEditCodex,
      META_EDIT_CODEX_PRE_TOOL_USE_MATCHER,
    } = await loadCodexCmd();
    const after = installMetaEditCodex('model = "gpt-5.5"\n');
    expect(after).toContain(
      `matcher = "${META_EDIT_CODEX_PRE_TOOL_USE_MATCHER}"`,
    );
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      expect(after).toContain(tool);
    }
  });

  it("refuses to append duplicate mcp_servers.meta-edit TOML over an unowned table", async () => {
    const { installMetaEditCodex } = await loadCodexCmd();

    const before = [
      'model = "gpt-5.5"',
      "",
      "[mcp_servers.meta-edit]",
      'command = "custom-meta-edit-wrapper"',
      'args = ["serve"]',
      "",
    ].join("\n");

    expect(() => installMetaEditCodex(before)).toThrow(
      /meta-edit.*mcp_servers\.meta-edit/i,
    );
  });

  it("removes only meta-edit owned Codex hooks", async () => {
    const {
      installMetaEditCodex,
      uninstallMetaEditCodex,
      META_EDIT_CODEX_HOOK_COMMANDS,
    } = await loadCodexCmd();

    const before = [
      'model = "gpt-5.5"',
      "",
      "[[hooks]]",
      'event = "PreToolUse"',
      'command = "user-hook"',
      "",
    ].join("\n");
    const installed = installMetaEditCodex(before);
    const stripped = uninstallMetaEditCodex(installed);

    expect(stripped).toContain('model = "gpt-5.5"');
    expect(stripped).toContain('command = "user-hook"');
    expect(stripped).not.toContain(META_EDIT_CODEX_HOOK_COMMANDS.preToolUse);
    expect(stripped).not.toContain(META_EDIT_CODEX_HOOK_COMMANDS.sessionStart);
  });

  it("preserves user-owned lines that merely mention Codex hook command names", async () => {
    const {
      uninstallMetaEditCodex,
      META_EDIT_CODEX_HOOK_COMMANDS,
    } = await loadCodexCmd();

    const before = [
      'model = "gpt-5.5"',
      "",
      "# user note: keep wrapper that mentions meta-edit-codex-deny-raw-edit",
      '[projects."/repo"]',
      'trust_level = "trusted"',
      '# reminder: meta-edit-codex-session-onboarding is documented here',
      "",
      "# meta-edit managed Codex hooks",
      `command = "${META_EDIT_CODEX_HOOK_COMMANDS.preToolUse}"`,
      `command = "${META_EDIT_CODEX_HOOK_COMMANDS.sessionStart}"`,
      "",
    ].join("\n");

    const stripped = uninstallMetaEditCodex(before);

    expect(stripped).toContain(
      "# user note: keep wrapper that mentions meta-edit-codex-deny-raw-edit",
    );
    expect(stripped).toContain(
      "# reminder: meta-edit-codex-session-onboarding is documented here",
    );
    expect(stripped).not.toContain("# meta-edit managed Codex hooks");
    expect(stripped).not.toContain(
      `command = "${META_EDIT_CODEX_HOOK_COMMANDS.preToolUse}"`,
    );
    expect(stripped).not.toContain(
      `command = "${META_EDIT_CODEX_HOOK_COMMANDS.sessionStart}"`,
    );
  });

  it("uninstall does not leave a triple newline when content surrounds the managed block", async () => {
    const { installMetaEditCodex, uninstallMetaEditCodex } =
      await loadCodexCmd();

    // install appends the managed block after the model line:
    const withBlock = installMetaEditCodex('model = "gpt-5.5"\n');
    // simulate user content AFTER the managed block:
    const withTrailing = `${withBlock}\n[extra]\nkey = "v"\n`;

    const stripped = uninstallMetaEditCodex(withTrailing);

    expect(stripped).toContain('model = "gpt-5.5"');
    expect(stripped).toContain("[extra]");
    // observed: removeManagedBlock strips only one trailing newline from the
    // text before the block, so the `${beforeText}\n\n${afterText}` join yields
    // three consecutive newlines when content surrounds the block.
    expect(stripped).not.toContain("\n\n\n");
  });

  it("uninstall preserves a user-authored hook table that references the meta-edit bin outside the legacy region", async () => {
    const { uninstallMetaEditCodex, META_EDIT_CODEX_HOOK_COMMANDS } =
      await loadCodexCmd();

    const before = [
      'model = "gpt-5.5"',
      "",
      "[[hooks.PreToolUse.hooks]]",
      'type = "command"',
      `command = "${META_EDIT_CODEX_HOOK_COMMANDS.preToolUse}"`,
      'statusMessage = "my custom wiring"',
      "",
    ].join("\n");

    const stripped = uninstallMetaEditCodex(before);

    expect(stripped).toContain("[[hooks.PreToolUse.hooks]]");
    expect(stripped).toContain('type = "command"');
    expect(stripped).toContain('statusMessage = "my custom wiring"');
    // observed: removeLegacyLooseLines filters any bare `command = "<bin>"` line
    // globally, so the user's own table loses its command line even though there
    // is no legacy header above it.
    expect(stripped).toContain(
      `command = "${META_EDIT_CODEX_HOOK_COMMANDS.preToolUse}"`,
    );
  });
});

describe("runInstallCodex / runUninstallCodex (project scope)", () => {
  it("creates .codex/config.toml in a fresh project", async () => {
    const {
      codexConfigPathForScope,
      runInstallCodex,
      META_EDIT_CODEX_HOOK_COMMANDS,
    } = await loadCodexCmd();
    const out = new StringStream();
    const err = new StringStream();

    const code = runInstallCodex({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asWritableStream(out),
      err: asWritableStream(err),
    });

    expect(code).toBe(0);
    const target = codexConfigPathForScope("project", { cwd: tmpCwd });
    expect(fs.existsSync(target)).toBe(true);
    const text = fs.readFileSync(target, "utf8");
    expect(text).toContain(META_EDIT_CODEX_HOOK_COMMANDS.preToolUse);
    expect(text).toContain(META_EDIT_CODEX_HOOK_COMMANDS.sessionStart);
    expect(out.text).toContain("installed Codex hooks into");
    expect(err.text).toBe("");
  });

  it("refuses project install over an unowned single-quoted meta-edit MCP table", async () => {
    const { codexConfigPathForScope, runInstallCodex } =
      await loadCodexCmd();
    const target = codexConfigPathForScope("project", { cwd: tmpCwd });
    const before = [
      'model = "gpt-5.5"',
      "",
      "[mcp_servers.'meta-edit']",
      'command = "custom-meta-edit-wrapper"',
      'args = ["serve"]',
      "",
    ].join("\n");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, before, "utf8");
    const out = new StringStream();
    const err = new StringStream();

    const code = runInstallCodex({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asWritableStream(out),
      err: asWritableStream(err),
    });

    expect(code).toBe(1);
    expect(out.text).toBe("");
    expect(err.text).toContain("existing");
    expect(fs.readFileSync(target, "utf8")).toBe(before);
  });

  for (const header of [
    "[mcp_servers . 'meta-edit']",
    "[ mcp_servers . 'meta-edit' ]",
    '["mcp_servers"."meta-edit"]',
  ]) {
    it(`refuses project install over an unowned ${header} MCP table`, async () => {
      const { codexConfigPathForScope, runInstallCodex } =
        await loadCodexCmd();
      const target = codexConfigPathForScope("project", { cwd: tmpCwd });
      const before = [
        'model = "gpt-5.5"',
        "",
        header,
        'command = "custom-meta-edit-wrapper"',
        'args = ["serve"]',
        "",
      ].join("\n");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, before, "utf8");
      const out = new StringStream();
      const err = new StringStream();

      const code = runInstallCodex({
        scope: "project",
        cwd: tmpCwd,
        home: tmpHome,
        out: asWritableStream(out),
        err: asWritableStream(err),
      });

      expect(code).toBe(1);
      expect(out.text).toBe("");
      expect(err.text).toContain("existing");
      expect(fs.readFileSync(target, "utf8")).toBe(before);
    });
  }

  it("uninstalls hooks from project config while preserving unrelated settings", async () => {
    const {
      codexConfigPathForScope,
      installMetaEditCodex,
      runUninstallCodex,
      META_EDIT_CODEX_HOOK_COMMANDS,
    } = await loadCodexCmd();
    const target = codexConfigPathForScope("project", { cwd: tmpCwd });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      installMetaEditCodex('model = "gpt-5.5"\n'),
      "utf8",
    );
    const out = new StringStream();
    const err = new StringStream();

    const code = runUninstallCodex({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asWritableStream(out),
      err: asWritableStream(err),
    });

    expect(code).toBe(0);
    const text = fs.readFileSync(target, "utf8");
    expect(text).toContain('model = "gpt-5.5"');
    expect(text).not.toContain(META_EDIT_CODEX_HOOK_COMMANDS.preToolUse);
    expect(text).not.toContain(META_EDIT_CODEX_HOOK_COMMANDS.sessionStart);
    expect(out.text).toContain("removed Codex hooks from");
    expect(err.text).toBe("");
  });

  it("uninstall is a no-op when project config is missing", async () => {
    const { runUninstallCodex } = await loadCodexCmd();
    const out = new StringStream();
    const err = new StringStream();

    const code = runUninstallCodex({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asWritableStream(out),
      err: asWritableStream(err),
    });

    expect(code).toBe(0);
    expect(out.text).toContain("does not exist; nothing to uninstall");
    expect(err.text).toBe("");
  });
});

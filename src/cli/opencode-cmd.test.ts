import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  configPathForScope,
  installMetaEditOpencode,
  parseOpencodeArgs,
  runInstallOpencode,
  runUninstallOpencode,
  uninstallMetaEditOpencode,
  META_EDIT_OPENCODE_RESOURCES,
  type OpencodeConfigShape,
} from "./opencode-cmd.js";

let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-oc-cmd-home-"));
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-oc-cmd-cwd-"));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

class StringStream {
  text = "";
  write(chunk: string | Uint8Array): boolean {
    this.text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }
}
// Cast helper: the installer takes NodeJS.WritableStream but we only
// need write(); fully impersonating WritableStream (with all 17 EE
// methods) would be noise here.
function asStream(s: StringStream): NodeJS.WritableStream {
  return s as unknown as NodeJS.WritableStream;
}

// =====================================================================
// configPathForScope
// =====================================================================

describe("configPathForScope", () => {
  it("user scope → $HOME/.config/opencode/opencode.json", () => {
    expect(configPathForScope("user", { home: "/h" })).toBe(
      path.join("/h", ".config", "opencode", "opencode.json"),
    );
  });

  it("project scope → <cwd>/opencode.json", () => {
    expect(configPathForScope("project", { cwd: "/p" })).toBe(
      path.join("/p", "opencode.json"),
    );
  });
});

// =====================================================================
// parseOpencodeArgs
// =====================================================================

describe("parseOpencodeArgs", () => {
  it("requires --scope", () => {
    expect(parseOpencodeArgs([])).toEqual({
      ok: false,
      error: "--scope <user|project> is required",
    });
  });

  it("rejects an unknown scope", () => {
    expect(parseOpencodeArgs(["--scope", "global"])).toEqual({
      ok: false,
      error: '--scope must be "user" or "project" (got "global")',
    });
  });

  it("accepts user / project", () => {
    expect(parseOpencodeArgs(["--scope", "user"])).toEqual({
      ok: true,
      scope: "user",
    });
    expect(parseOpencodeArgs(["--scope", "project"])).toEqual({
      ok: true,
      scope: "project",
    });
  });

  it("rejects unknown flags", () => {
    expect(parseOpencodeArgs(["--what"])).toEqual({
      ok: false,
      error: "unknown flag: --what",
    });
  });
});

// =====================================================================
// installMetaEditOpencode (pure)
// =====================================================================

describe("installMetaEditOpencode (pure)", () => {
  it("creates mcp + plugin from an empty config", () => {
    const after = installMetaEditOpencode({});
    expect(after.mcp).toEqual({
      "meta-edit": {
        type: "local",
        command: ["meta-edit", "serve"],
        enabled: true,
      },
    });
    expect(after.plugin).toEqual([META_EDIT_OPENCODE_RESOURCES.pluginPackage]);
  });

  it("preserves unrelated mcp servers and plugins", () => {
    const before: OpencodeConfigShape = {
      mcp: {
        "context7": { type: "local", command: ["context7"], enabled: true },
      },
      plugin: ["@some/other-plugin"],
      theme: "dark",
    };
    const after = installMetaEditOpencode(before);
    expect((after.mcp as Record<string, unknown>)["context7"]).toBeDefined();
    expect((after.mcp as Record<string, unknown>)["meta-edit"]).toBeDefined();
    expect(after.plugin).toEqual([
      "@some/other-plugin",
      META_EDIT_OPENCODE_RESOURCES.pluginPackage,
    ]);
    expect(after["theme"]).toBe("dark");
  });

  it("is idempotent (running twice yields the same shape)", () => {
    const once = installMetaEditOpencode({});
    const twice = installMetaEditOpencode(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("does not duplicate the plugin entry on re-install", () => {
    const before: OpencodeConfigShape = {
      plugin: [META_EDIT_OPENCODE_RESOURCES.pluginPackage],
    };
    const after = installMetaEditOpencode(before);
    const occurrences = (after.plugin as unknown[]).filter(
      (p) => p === META_EDIT_OPENCODE_RESOURCES.pluginPackage,
    );
    expect(occurrences.length).toBe(1);
  });

  it("overwrites a stale meta-edit mcp entry", () => {
    const before: OpencodeConfigShape = {
      mcp: {
        "meta-edit": {
          type: "local",
          command: ["old-meta-edit", "serve"], // stale shape
          enabled: false,
        },
      },
    };
    const after = installMetaEditOpencode(before);
    expect((after.mcp as Record<string, Record<string, unknown>>)["meta-edit"]).toEqual({
      type: "local",
      command: ["meta-edit", "serve"],
      enabled: true,
    });
  });

  it("does not crash when mcp is malformed (replaces with empty object)", () => {
    const before = { mcp: 42 } as unknown as OpencodeConfigShape;
    const after = installMetaEditOpencode(before);
    expect(typeof after.mcp).toBe("object");
    expect((after.mcp as Record<string, unknown>)["meta-edit"]).toBeDefined();
  });

  it("does not crash when plugin is malformed (replaces with empty array)", () => {
    const before = { plugin: "garbage" } as unknown as OpencodeConfigShape;
    const after = installMetaEditOpencode(before);
    expect(Array.isArray(after.plugin)).toBe(true);
    expect((after.plugin as unknown[])[0]).toBe(
      META_EDIT_OPENCODE_RESOURCES.pluginPackage,
    );
  });
});

// =====================================================================
// uninstallMetaEditOpencode (pure)
// =====================================================================

describe("uninstallMetaEditOpencode (pure)", () => {
  it("removes meta-edit entries while keeping siblings", () => {
    const installed = installMetaEditOpencode({
      mcp: {
        "context7": { type: "local", command: ["context7"], enabled: true },
      },
      plugin: ["@some/other-plugin"],
    });
    const stripped = uninstallMetaEditOpencode(installed);
    expect((stripped.mcp as Record<string, unknown>)["context7"]).toBeDefined();
    expect((stripped.mcp as Record<string, unknown>)["meta-edit"]).toBeUndefined();
    expect(stripped.plugin).toEqual(["@some/other-plugin"]);
  });

  it("drops mcp entirely when our entry was the only one", () => {
    const installed = installMetaEditOpencode({});
    const stripped = uninstallMetaEditOpencode(installed);
    expect(stripped.mcp).toBeUndefined();
    expect(stripped.plugin).toBeUndefined();
  });

  it("is a no-op on a config that never had meta-edit", () => {
    const before: OpencodeConfigShape = {
      mcp: {
        "context7": { type: "local", command: ["context7"], enabled: true },
      },
      plugin: ["@some/other-plugin"],
    };
    const after = uninstallMetaEditOpencode(before);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("does not crash when mcp / plugin are missing or malformed", () => {
    expect(() => uninstallMetaEditOpencode({})).not.toThrow();
    expect(() =>
      uninstallMetaEditOpencode({ mcp: 42 } as unknown as OpencodeConfigShape),
    ).not.toThrow();
    expect(() =>
      uninstallMetaEditOpencode({
        plugin: "garbage",
      } as unknown as OpencodeConfigShape),
    ).not.toThrow();
  });
});

// =====================================================================
// runInstallOpencode / runUninstallOpencode (filesystem integration)
// =====================================================================

describe("runInstallOpencode (project scope)", () => {
  it("creates opencode.json in a fresh project", () => {
    const out = new StringStream();
    const err = new StringStream();
    const code = runInstallOpencode({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    expect(code).toBe(0);
    const target = path.join(tmpCwd, "opencode.json");
    expect(fs.existsSync(target)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.mcp["meta-edit"].command).toEqual(["meta-edit", "serve"]);
    expect(parsed.plugin).toContain(META_EDIT_OPENCODE_RESOURCES.pluginPackage);
    expect(out.text).toContain("installed opencode mcp + plugin into");
  });

  it("merges into an existing opencode.json", () => {
    const target = path.join(tmpCwd, "opencode.json");
    fs.writeFileSync(
      target,
      JSON.stringify(
        { theme: "dark", mcp: { context7: { type: "local", command: ["c7"] } } },
        null,
        2,
      ),
    );
    const out = new StringStream();
    const err = new StringStream();
    runInstallOpencode({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcp.context7).toBeDefined();
    expect(parsed.mcp["meta-edit"]).toBeDefined();
  });

  it("rejects malformed JSON with exit code 1", () => {
    const target = path.join(tmpCwd, "opencode.json");
    fs.writeFileSync(target, "{ this is not json");
    const out = new StringStream();
    const err = new StringStream();
    const code = runInstallOpencode({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    expect(code).toBe(1);
    expect(err.text).toContain("failed to parse");
  });
});

describe("runUninstallOpencode", () => {
  it("returns 0 with a no-op message when target file does not exist", () => {
    const out = new StringStream();
    const err = new StringStream();
    const code = runUninstallOpencode({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    expect(code).toBe(0);
    expect(out.text).toContain("does not exist; nothing to uninstall");
  });

  it("removes meta-edit entries and preserves siblings", () => {
    const target = path.join(tmpCwd, "opencode.json");
    fs.writeFileSync(
      target,
      JSON.stringify(
        installMetaEditOpencode({
          mcp: { context7: { type: "local", command: ["c7"] } },
          plugin: ["@some/other"],
        }),
        null,
        2,
      ),
    );
    const out = new StringStream();
    const err = new StringStream();
    const code = runUninstallOpencode({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.mcp.context7).toBeDefined();
    expect(parsed.mcp["meta-edit"]).toBeUndefined();
    expect(parsed.plugin).toEqual(["@some/other"]);
  });
});

describe("runInstallOpencode (user scope)", () => {
  it("creates ~/.config/opencode/opencode.json", () => {
    const out = new StringStream();
    const err = new StringStream();
    runInstallOpencode({
      scope: "user",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    const target = path.join(tmpHome, ".config", "opencode", "opencode.json");
    expect(fs.existsSync(target)).toBe(true);
  });
});

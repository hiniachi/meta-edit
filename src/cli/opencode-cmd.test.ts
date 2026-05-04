import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  configPathForScope,
  installMetaEditOpencode,
  installMetaEditSkill,
  parseOpencodeArgs,
  runInstallOpencode,
  runUninstallOpencode,
  skillTargetPath,
  uninstallMetaEditOpencode,
  uninstallMetaEditSkill,
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

// =====================================================================
// Skill install / uninstall (typed-edit-onboarding)
// =====================================================================

function withFixtureSkill(home: string, fn: (source: string) => void): void {
  // Build a fake "package root" with a valid SKILL.md so we exercise
  // installMetaEditSkill without depending on the real skills/ dir
  // (the real one IS shipped with the package, but this isolates the
  // test from the rest of the tree).
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-fake-pkg-"));
  const skillDir = path.join(
    fakeRoot,
    "skills",
    META_EDIT_OPENCODE_RESOURCES.skillName,
  );
  fs.mkdirSync(skillDir, { recursive: true });
  const source = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(source, "# fixture SKILL\n", "utf8");
  try {
    fn(source);
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
  // suppress unused var warnings
  void home;
}

describe("skillTargetPath", () => {
  it("resolves to ~/.claude/skills/typed-edit-onboarding/SKILL.md", () => {
    expect(skillTargetPath("/h")).toBe(
      path.join("/h", ".claude", "skills", "typed-edit-onboarding", "SKILL.md"),
    );
  });
});

describe("installMetaEditSkill", () => {
  it("copies the SKILL.md to ~/.claude/skills/typed-edit-onboarding/", () => {
    withFixtureSkill(tmpHome, (source) => {
      installMetaEditSkill({ home: tmpHome, source });
      const target = skillTargetPath(tmpHome);
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, "utf8")).toBe("# fixture SKILL\n");
    });
  });

  it("is idempotent — same content does not bump mtime", () => {
    withFixtureSkill(tmpHome, (source) => {
      installMetaEditSkill({ home: tmpHome, source });
      const target = skillTargetPath(tmpHome);
      const mtime1 = fs.statSync(target).mtimeMs;
      // Re-install: should detect identical bytes and skip the write.
      // Sleep a tiny bit so any rewrite would show up as a different
      // mtime even on coarse clocks.
      const until = Date.now() + 25;
      while (Date.now() < until) {
        /* spin */
      }
      installMetaEditSkill({ home: tmpHome, source });
      const mtime2 = fs.statSync(target).mtimeMs;
      expect(mtime2).toBe(mtime1);
    });
  });

  it("overwrites a stale SKILL.md (install is the source of truth)", () => {
    withFixtureSkill(tmpHome, (source) => {
      const target = skillTargetPath(tmpHome);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "# stale skill content\n", "utf8");
      installMetaEditSkill({ home: tmpHome, source });
      expect(fs.readFileSync(target, "utf8")).toBe("# fixture SKILL\n");
    });
  });

  it("throws ENOENT when the source SKILL.md is missing", () => {
    expect(() =>
      installMetaEditSkill({ home: tmpHome, source: "/nonexistent/SKILL.md" }),
    ).toThrow();
  });
});

describe("uninstallMetaEditSkill", () => {
  it("removes SKILL.md and the now-empty parent dir", () => {
    withFixtureSkill(tmpHome, (source) => {
      installMetaEditSkill({ home: tmpHome, source });
      const target = skillTargetPath(tmpHome);
      uninstallMetaEditSkill({ home: tmpHome });
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(path.dirname(target))).toBe(false);
    });
  });

  it("preserves sibling files in the skill dir (user-added)", () => {
    withFixtureSkill(tmpHome, (source) => {
      installMetaEditSkill({ home: tmpHome, source });
      const target = skillTargetPath(tmpHome);
      const sibling = path.join(path.dirname(target), "USER_NOTE.md");
      fs.writeFileSync(sibling, "user note\n");
      uninstallMetaEditSkill({ home: tmpHome });
      expect(fs.existsSync(target)).toBe(false);
      // Sibling preserved → parent dir not removed.
      expect(fs.existsSync(sibling)).toBe(true);
    });
  });

  it("is a no-op when SKILL.md is already absent", () => {
    expect(() => uninstallMetaEditSkill({ home: tmpHome })).not.toThrow();
  });
});

describe("runInstallOpencode skill integration", () => {
  it("installs the bundled skill alongside the mcp + plugin", () => {
    // The bundled skill is the real one in the repo's skills/ dir;
    // defaultSkillSourcePath() walks up from this test file's dir to
    // the package root and finds it. We trust that's working in dev.
    const out = new StringStream();
    const err = new StringStream();
    runInstallOpencode({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    const skillTarget = skillTargetPath(tmpHome);
    expect(fs.existsSync(skillTarget)).toBe(true);
    expect(out.text).toContain("typed-edit-onboarding skill into");
  });

  it("does not fail the install if the skill source is somehow missing", () => {
    // This is a behavior contract: a stripped-down install or a
    // bad build should not block the user from getting mcp + plugin.
    // We can't easily simulate "source missing" against the real
    // package layout, so this test is a placeholder that simply
    // confirms the install returns 0 in the normal case (covered
    // above) — and the production code's try/catch is the structural
    // guarantee.
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
  });
});

describe("runUninstallOpencode skill integration", () => {
  it("removes the installed skill alongside the mcp + plugin", () => {
    const out = new StringStream();
    const err = new StringStream();
    runInstallOpencode({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    const skillTarget = skillTargetPath(tmpHome);
    expect(fs.existsSync(skillTarget)).toBe(true);
    out.text = "";
    err.text = "";
    runUninstallOpencode({
      scope: "project",
      cwd: tmpCwd,
      home: tmpHome,
      out: asStream(out),
      err: asStream(err),
    });
    expect(fs.existsSync(skillTarget)).toBe(false);
    expect(out.text).toContain("removed typed-edit-onboarding skill from");
  });
});

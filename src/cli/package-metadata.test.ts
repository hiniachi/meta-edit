import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { cleanTmpRoot, makeTmpRoot } from "../test-helpers.js";

type PackageJson = {
  bin?: Record<string, string>;
  files?: string[];
  version?: string;
  scripts?: Record<string, string>;
};

type CodexPluginManifest = {
  name?: string;
  version?: string;
  hooks?: unknown;
  mcpServers?: unknown;
};

type CodexMarketplaceCatalog = {
  plugins?: Array<{
    name?: string;
    source?: {
      source?: string;
      path?: string;
    };
    policy?: {
      installation?: string;
      authentication?: string;
    };
  }>;
};

type CodexHooksJson = {
  hooks?: Record<
    string,
    Array<{
      matcher?: string;
      hooks?: Array<{
        command?: string;
      }>;
    }>
  >;
};

function readPackageJson(): PackageJson {
  const packagePath = path.resolve(import.meta.dir, "..", "..", "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageJson;
}

function codexMarketplacePath(): string {
  return path.resolve(
    import.meta.dir,
    "..",
    "..",
    ".agents",
    "plugins",
    "marketplace.json",
  );
}

function readCodexMarketplaceCatalog(): CodexMarketplaceCatalog {
  const marketplacePath = codexMarketplacePath();

  if (!fs.existsSync(marketplacePath)) {
    throw new Error(
      "Expected Codex marketplace catalog at .agents/plugins/marketplace.json",
    );
  }

  return JSON.parse(
    fs.readFileSync(marketplacePath, "utf8"),
  ) as CodexMarketplaceCatalog;
}

function readCodexHooksJson(): CodexHooksJson {
  const hooksPath = path.resolve(
    import.meta.dir,
    "..",
    "..",
    "codex",
    "hooks.json",
  );
  return JSON.parse(fs.readFileSync(hooksPath, "utf8")) as CodexHooksJson;
}

function readReadmeMarkdown(): string {
  const readmePath = path.resolve(import.meta.dir, "..", "..", "README.md");
  return fs.readFileSync(readmePath, "utf8");
}

function readCodexPluginManifest(manifestPath: string): CodexPluginManifest {
  return JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) as CodexPluginManifest;
}

function rootCodexPluginManifestPath(): string {
  return path.resolve(
    import.meta.dir,
    "..",
    "..",
    ".codex-plugin",
    "plugin.json",
  );
}

function codexPluginDirectoryPath(): string {
  return path.resolve(import.meta.dir, "..", "..", "plugins", "meta-edit");
}

function subdirectoryCodexPluginManifestPath(): string {
  return path.join(codexPluginDirectoryPath(), ".codex-plugin", "plugin.json");
}

function codexPluginDefaultHooksPath(): string {
  return path.join(codexPluginDirectoryPath(), "hooks", "hooks.json");
}

function codexPluginCodexHooksPath(): string {
  return path.join(codexPluginDirectoryPath(), "codex", "hooks.json");
}

function codexHookCommands(hooksJson: CodexHooksJson): string[] {
  return Object.values(hooksJson.hooks ?? {}).flatMap((entries) =>
    entries.flatMap((entry) =>
      (entry.hooks ?? []).flatMap((hook) =>
        hook.command === undefined ? [] : [hook.command],
      ),
    ),
  );
}

function codexHookCommandVersions(hooksJson: CodexHooksJson): string[] {
  return codexHookCommands(hooksJson).flatMap((command) => {
    const match = command.match(/\/meta-edit\/([^/"'\s]+)\/dist\/codex\//u);

    return match === null ? [] : [match[1] ?? ""];
  });
}

function packageFilesIncludesPathOrParent(
  files: string[],
  expectedPath: string,
): boolean {
  const expected = path.normalize(expectedPath);

  return files.some((entry) => {
    const normalized = path.normalize(entry);
    const normalizedWithTrailingSeparator = normalized.endsWith(path.sep)
      ? normalized
      : `${normalized}${path.sep}`;

    return (
      normalized === expected ||
      normalizedWithTrailingSeparator === `${expected}${path.sep}` ||
      expected.startsWith(normalizedWithTrailingSeparator)
    );
  });
}

function expectLocalFile(filePath: string): void {
  expect(fs.existsSync(filePath)).toBe(true);

  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);

    expect(stat.isFile()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
  }
}

function expectLocalDirectory(directoryPath: string): void {
  expect(fs.existsSync(directoryPath)).toBe(true);

  if (fs.existsSync(directoryPath)) {
    const stat = fs.lstatSync(directoryPath);

    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
  }
}

function writeFixtureFile(root: string, rel: string, content: string): string {
  const filePath = path.join(root, rel);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");

  return filePath;
}

describe("package metadata for Codex hook bins", () => {
  it("publishes the Codex PreToolUse and SessionStart hook bins", () => {
    const pkg = readPackageJson();

    expect(pkg.bin?.["meta-edit-codex-deny-raw-edit"]).toBe(
      "dist/codex/deny-raw-edit.js",
    );
    expect(pkg.bin?.["meta-edit-codex-session-onboarding"]).toBe(
      "dist/codex/session-onboarding.js",
    );
  });

  it("keeps hardcoded Codex hook command versions in sync with package.json", () => {
    const pkg = readPackageJson();
    const packageVersion = pkg.version;

    expect(typeof packageVersion).toBe("string");
    if (typeof packageVersion !== "string") {
      throw new Error("package.json version must be a string");
    }

    const hookFiles = [
      readCodexHooksJson(),
      JSON.parse(
        fs.readFileSync(codexPluginDefaultHooksPath(), "utf8"),
      ) as CodexHooksJson,
      JSON.parse(
        fs.readFileSync(codexPluginCodexHooksPath(), "utf8"),
      ) as CodexHooksJson,
    ];

    for (const hooksJson of hookFiles) {
      const versions = codexHookCommandVersions(hooksJson);

      expect(versions.length).toBeGreaterThan(0);
      expect(new Set(versions)).toEqual(new Set([packageVersion]));
    }
  });

  it("build script includes the Codex hook entrypoints", () => {
    const pkg = readPackageJson();
    const build = pkg.scripts?.["build"] ?? "";

    expect(build).toContain("src/codex/deny-raw-edit.ts");
    expect(build).toContain("src/codex/session-onboarding.ts");
  });

  it("does not make codex/hooks.json depend on globally installed npm bin names", () => {
    const pkg = readPackageJson();
    const hooks = readCodexHooksJson();
    const packageBinNames = new Set(Object.keys(pkg.bin ?? {}));

    for (const command of codexHookCommands(hooks)) {
      expect(packageBinNames.has(command)).toBe(false);
    }
  });

  it("runs the build before packing so generated Codex artifacts are fresh", () => {
    // Observed (ISSUE G) in package.json: files[] ships build-only artifacts
    // (dist/, plugins/meta-edit/**, dist/codex/**) produced by `npm run build`
    // (bun build ... && node scripts/sync-codex-plugin.mjs), but no
    // prepack/prepare/prepublishOnly lifecycle script exists, so `npm pack` /
    // `npm publish` run WITHOUT a fresh build and pack stale Codex artifacts.
    const pkg = readPackageJson();
    const scripts = pkg.scripts ?? {};
    // npm runs prepack (and prepare) for both `npm pack` and `npm publish`.
    const lifecycle =
      scripts["prepack"] ??
      scripts["prepare"] ??
      scripts["prepublishOnly"] ??
      "";
    expect(lifecycle).toContain("build");
  });
});

describe("README metadata", () => {
  it("keeps the impl-tool count consistent with the workflow-axis count", () => {
    const readme = readReadmeMarkdown().replace(/\s+/g, " ");

    expect(readme).toContain(
      "The 15 impl tools (everything except the 6 workflow-axis kinds)",
    );
  });
});

describe("scripts/sync-codex-plugin.mjs", () => {
  it("removes stale files from copied plugin artifacts", () => {
    const tmpRoot = makeTmpRoot("codex-plugin-sync");

    try {
      const scriptSourcePath = path.resolve(
        import.meta.dir,
        "..",
        "..",
        "scripts",
        "sync-codex-plugin.mjs",
      );
      const scriptPath = writeFixtureFile(
        tmpRoot,
        "scripts/sync-codex-plugin.mjs",
        fs.readFileSync(scriptSourcePath, "utf8"),
      );
      writeFixtureFile(tmpRoot, ".codex-plugin/plugin.json", "{}\n");
      writeFixtureFile(tmpRoot, ".mcp.json", "{}\n");
      writeFixtureFile(tmpRoot, "AGENTS.md", "# agents\n");
      writeFixtureFile(tmpRoot, "codex/hooks.json", '{"hooks":{}}\n');
      writeFixtureFile(tmpRoot, "dist/cli.js", "console.log('fresh');\n");
      writeFixtureFile(
        tmpRoot,
        "skills/typed-edit-onboarding/SKILL.md",
        "# skill\n",
      );
      const freshCopiedFile = path.join(
        tmpRoot,
        "plugins",
        "meta-edit",
        "dist",
        "cli.js",
      );
      const freshCopiedHooksFile = path.join(
        tmpRoot,
        "plugins",
        "meta-edit",
        "hooks",
        "hooks.json",
      );
      const staleCopiedFile = writeFixtureFile(
        tmpRoot,
        "plugins/meta-edit/dist/stale.js",
        "console.log('stale');\n",
      );
      const staleCopiedHookFile = writeFixtureFile(
        tmpRoot,
        "plugins/meta-edit/hooks/stale.json",
        "{}\n",
      );

      const result = spawnSync("node", [scriptPath], {
        cwd: tmpRoot,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(fs.existsSync(freshCopiedFile)).toBe(true);
      expect(fs.existsSync(freshCopiedHooksFile)).toBe(true);
      expect(fs.existsSync(staleCopiedFile)).toBe(false);
      expect(fs.existsSync(staleCopiedHookFile)).toBe(false);
    } finally {
      cleanTmpRoot(tmpRoot);
    }
  });
});

describe("package metadata for Codex marketplace catalog", () => {
  it("contains a Codex marketplace catalog", () => {
    expect(fs.existsSync(codexMarketplacePath())).toBe(true);
  });

  it("declares the local meta-edit plugin as available", () => {
    const catalog = readCodexMarketplaceCatalog();
    const plugin = catalog.plugins?.find((entry) => entry.name === "meta-edit");

    expect(plugin).toBeDefined();
    expect(plugin?.source?.source).toBe("local");
    expect(plugin?.source?.path).toBe("./plugins/meta-edit");
    expect(plugin?.policy?.installation).toBe("AVAILABLE");
    expect(plugin?.policy?.authentication).toBe("ON_INSTALL");
  });

  it("packs the Codex marketplace catalog and plugin subdirectory", () => {
    const pkg = readPackageJson();
    const files = pkg.files ?? [];

    expect(packageFilesIncludesPathOrParent(files, ".agents")).toBe(true);
    expect(
      packageFilesIncludesPathOrParent(files, "plugins/meta-edit"),
    ).toBe(true);
  });

  it("packs the root MCP manifest referenced by Codex plugin manifests", () => {
    const pkg = readPackageJson();
    const files = pkg.files ?? [];
    const rootManifest = readCodexPluginManifest(rootCodexPluginManifestPath());
    const subdirectoryManifest = readCodexPluginManifest(
      subdirectoryCodexPluginManifestPath(),
    );
    const rootMcpManifestPath = path.resolve(
      import.meta.dir,
      "..",
      "..",
      ".mcp.json",
    );

    expectLocalFile(rootMcpManifestPath);
    expect(rootManifest.mcpServers).toBe("./.mcp.json");
    expect(subdirectoryManifest.mcpServers).toBe("./.mcp.json");
    expect(packageFilesIncludesPathOrParent(files, ".mcp.json")).toBe(true);
  });

  it("publishes a subdirectory Codex plugin manifest matching the root manifest", () => {
    const pkg = readPackageJson();
    const rootManifest = readCodexPluginManifest(rootCodexPluginManifestPath());
    const subdirectoryManifestPath = subdirectoryCodexPluginManifestPath();

    expectLocalFile(subdirectoryManifestPath);

    if (fs.existsSync(subdirectoryManifestPath)) {
      const subdirectoryManifest = readCodexPluginManifest(
        subdirectoryManifestPath,
      );

      expect(subdirectoryManifest.name).toBe(rootManifest.name);
      expect(subdirectoryManifest.version).toBe(rootManifest.version);
      expect(subdirectoryManifest.version).toBe(pkg.version);
    }
  });

  it("keeps Codex plugin manifests validator-compatible by omitting top-level hooks", () => {
    const rootManifest = readCodexPluginManifest(rootCodexPluginManifestPath());
    const subdirectoryManifest = readCodexPluginManifest(
      subdirectoryCodexPluginManifestPath(),
    );

    expect(rootManifest).not.toHaveProperty("hooks");
    expect(subdirectoryManifest).not.toHaveProperty("hooks");
  });

  it("keeps all Codex runtime assets local to the plugin subdirectory", () => {
    const pluginDirectory = codexPluginDirectoryPath();

    expectLocalFile(path.join(pluginDirectory, ".mcp.json"));
    expectLocalFile(path.join(pluginDirectory, "codex", "hooks.json"));
    expectLocalFile(codexPluginDefaultHooksPath());
    expectLocalFile(path.join(pluginDirectory, "AGENTS.md"));
    expectLocalDirectory(path.join(pluginDirectory, "skills"));
  });

  it("keeps the bundled default Codex hook commands in sync with codex/hooks.json", () => {
    const rootHooks = readCodexHooksJson();
    const defaultHooks = JSON.parse(
      fs.readFileSync(codexPluginDefaultHooksPath(), "utf8"),
    ) as CodexHooksJson;

    expect(codexHookCommands(defaultHooks)).toEqual(
      codexHookCommands(rootHooks),
    );
  });
});

describe("Codex hook routing and fail-closed behavior", () => {
  it("Codex PreToolUse matcher routes apply_patch and every raw write tool", () => {
    const hooks = readCodexHooksJson();
    const preToolUse = (hooks.hooks?.["PreToolUse"] ?? []) as Array<{
      matcher?: string;
    }>;
    expect(preToolUse.length).toBeGreaterThan(0);
    const routedTools = new Set(
      preToolUse.flatMap((e) => (e.matcher ?? "").split("|")).filter(Boolean),
    );
    expect(routedTools).toEqual(
      new Set([
        "Bash",
        "apply_patch",
        "Edit",
        "Write",
        "MultiEdit",
        "NotebookEdit",
      ]),
    );
  });

  it("each Codex hook command fails closed with a block decision when the pinned binary is missing", () => {
    const commands = codexHookCommands(readCodexHooksJson());
    expect(commands.length).toBeGreaterThan(0);
    const tmp = makeTmpRoot("codex-hook-failclosed");
    try {
      // empty plugin cache so the version-pinned find matches nothing
      fs.mkdirSync(path.join(tmp, "plugins", "cache"), { recursive: true });
      for (const command of commands) {
        const result = spawnSync("sh", ["-c", command], {
          env: { ...process.env, CODEX_HOME: tmp, HOME: tmp },
          input: JSON.stringify({
            hook_event_name: "PreToolUse",
            tool_name: "apply_patch",
            tool_input: { patch: "x" },
          }),
          encoding: "utf8",
        });
        // A find-miss must NEVER crash (a non-zero exit / empty output is the fail-OPEN bug).
        expect(result.status).toBe(0);
        if (command.includes("deny-raw-edit")) {
          // Enforcement hook: fail CLOSED with a block carrying a non-empty reason.
          const parsed = JSON.parse(result.stdout) as {
            decision?: string;
            reason?: string;
          };
          expect(parsed.decision).toBe("block");
          expect(typeof parsed.reason).toBe("string");
          expect((parsed.reason ?? "").length).toBeGreaterThan(0);
        } else {
          // Advisory (session-onboarding) hook: graceful no-op — no spurious block.
          const out = result.stdout.trim();
          if (out.length > 0) {
            const parsed = JSON.parse(out) as { decision?: string };
            expect(parsed.decision).not.toBe("block");
          }
        }
      }
    } finally {
      cleanTmpRoot(tmp);
    }
  });
});

#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginRoot = join(repoRoot, "plugins", "meta-edit");

const copies = [
  [".codex-plugin", ".codex-plugin"],
  [".mcp.json", ".mcp.json"],
  ["AGENTS.md", "AGENTS.md"],
  ["codex", "codex"],
  ["dist", "dist"],
  ["skills", "skills"],
];

mkdirSync(pluginRoot, { recursive: true });

for (const [source, target] of copies) {
  const targetPath = join(pluginRoot, target);
  rmSync(targetPath, { recursive: true, force: true });
  cpSync(join(repoRoot, source), targetPath, {
    recursive: true,
    force: true,
  });
}

const hooksRoot = join(pluginRoot, "hooks");
rmSync(hooksRoot, { recursive: true, force: true });
mkdirSync(hooksRoot, { recursive: true });
cpSync(
  join(repoRoot, "codex", "hooks.json"),
  join(hooksRoot, "hooks.json"),
  { force: true },
);

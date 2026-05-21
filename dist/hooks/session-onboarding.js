#!/usr/bin/env node
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/hooks/session-onboarding.ts
import * as fs4 from "node:fs";
import * as path4 from "node:path";

// src/hooks/hook-runtime.ts
async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    process.stdin.on("error", reject);
  });
}
function replyAllow() {
  process.stdout.write("");
  return 0;
}
function replyDeny(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}
function replyAllowWithWarning(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason,
      additionalContext: reason
    }
  };
  process.stdout.write(JSON.stringify(payload));
  process.stderr.write(`[meta-edit] ${reason}
`);
  return 0;
}

// src/utils/repo-paths.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";

// src/utils/realpath.ts
import * as fs from "node:fs";
import * as path from "node:path";
function realpathOfDeepestExisting(p) {
  let cur = p;
  const tail = [];
  while (true) {
    try {
      const real = fs.realpathSync(cur);
      if (tail.length === 0) {
        return real;
      }
      return path.join(real, ...tail.reverse());
    } catch (e) {
      const code = e?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        const parent = path.dirname(cur);
        if (parent === cur) {
          return p;
        }
        tail.push(path.basename(cur));
        cur = parent;
        continue;
      }
      return null;
    }
  }
}
function canonicalDirRealpath(p) {
  let cur = path.dirname(p);
  const tail = [path.basename(p)];
  while (true) {
    let st = null;
    try {
      st = fs.statSync(cur);
    } catch (e) {
      const code = e?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return null;
      }
      st = null;
    }
    if (st !== null && st.isDirectory()) {
      let real;
      try {
        real = fs.realpathSync(cur);
      } catch (e) {
        const code = e?.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          real = "";
        } else {
          return null;
        }
      }
      if (real !== "") {
        return path.join(real, ...[...tail].reverse());
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) {
      return path.join(cur, ...[...tail].reverse());
    }
    tail.push(path.basename(cur));
    cur = parent;
  }
}

// src/state/protected-paths.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
var PROTECTED_PREFIXES = [
  ".meta-edit/state/",
  ".meta-edit/tmp/"
];
function normalizeRepoRelative(p) {
  if (p.includes("\x00")) {
    throw new Error("path contains NUL byte");
  }
  let n = p.replace(/\\/g, "/");
  while (n.startsWith("./")) {
    n = n.slice(2);
  }
  while (n.startsWith("/")) {
    n = n.slice(1);
  }
  return n.replace(/\/+/g, "/");
}
var CASE_INSENSITIVE_FS = process.platform === "darwin" || process.platform === "win32";
function matchesProtectedPrefix(norm) {
  const folded = CASE_INSENSITIVE_FS ? norm.toLowerCase() : null;
  return PROTECTED_PREFIXES.some((prefix) => {
    const dir = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    if (norm.startsWith(prefix) || norm === dir) {
      return true;
    }
    if (folded !== null && (folded.startsWith(prefix) || folded === dir)) {
      return true;
    }
    return false;
  });
}
function isProtectedPath(p, options = {}) {
  let norm;
  try {
    norm = normalizeRepoRelative(p);
  } catch {
    return true;
  }
  if (matchesProtectedPrefix(norm)) {
    return true;
  }
  const repoRoot = options.repoRoot;
  if (repoRoot && !path2.isAbsolute(p)) {
    try {
      const absInput = path2.resolve(repoRoot, norm);
      const realResolved = realpathOfDeepestExisting(absInput);
      if (realResolved === null) {
        return false;
      }
      let realRoot;
      try {
        realRoot = fs2.realpathSync(repoRoot);
      } catch {
        realRoot = path2.resolve(repoRoot);
      }
      if (realResolved === realRoot || realResolved.startsWith(realRoot + path2.sep)) {
        const canonicalRel = normalizeRepoRelative(path2.relative(realRoot, realResolved));
        if (matchesProtectedPrefix(canonicalRel)) {
          return true;
        }
      }
    } catch {}
  }
  return false;
}

// src/utils/repo-paths.ts
function discoverRepoRoot(start) {
  let dir = path3.resolve(start);
  let found = null;
  for (;; ) {
    if (fs3.existsSync(path3.join(dir, ".git")) || fs3.existsSync(path3.join(dir, ".jj"))) {
      found = dir;
      break;
    }
    const parent = path3.dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  const base = found ?? path3.resolve(start);
  return realpathOfDeepestExisting(base) ?? path3.resolve(base);
}
function resolveRepoRoot(primary) {
  if (typeof primary === "string" && primary.length > 0) {
    return discoverRepoRoot(primary);
  }
  const envRoot = process.env["META_EDIT_REPO_ROOT"];
  if (typeof envRoot === "string" && envRoot.length > 0) {
    return discoverRepoRoot(envRoot);
  }
  return discoverRepoRoot(process.cwd());
}
function canonicalizeRepoRelative(inputPath, repoRoot) {
  const resolved = path3.isAbsolute(inputPath) ? path3.normalize(inputPath) : path3.resolve(repoRoot, inputPath);
  const realRoot = realpathOfDeepestExisting(path3.resolve(repoRoot)) ?? path3.resolve(repoRoot);
  const realResolved = canonicalDirRealpath(resolved);
  if (realResolved === null) {
    return {
      ok: false,
      code: "uncanonicalizable",
      error: `path "${inputPath}" could not be canonicalized via realpath; failing closed`
    };
  }
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path3.sep)) {
    return {
      ok: false,
      code: "escapes",
      error: `path "${inputPath}" escapes repository root after symlink resolution`
    };
  }
  let rel;
  try {
    rel = normalizeRepoRelative(path3.relative(realRoot, realResolved));
  } catch (e) {
    return {
      ok: false,
      code: "uncanonicalizable",
      error: `path "${inputPath}" is invalid: ${e.message}`
    };
  }
  if (rel.length === 0) {
    return {
      ok: false,
      code: "is_root",
      error: `path "${inputPath}" resolves to the repository root`
    };
  }
  return { ok: true, canonical: rel };
}

// src/hooks/session-onboarding.ts
function claimOnboardingMarker(markerPath, sessionId) {
  try {
    fs4.mkdirSync(path4.dirname(markerPath), { recursive: true });
  } catch {}
  try {
    fs4.writeFileSync(markerPath, JSON.stringify({
      session_id: sessionId,
      ts: new Date().toISOString()
    }, null, 2), { encoding: "utf8", flag: "wx" });
    return true;
  } catch (e) {
    const code = e?.code;
    if (code === "EEXIST") {
      return false;
    }
    return false;
  }
}
function buildOnboardingMessage() {
  return [
    "meta-edit reminder:",
    "",
    "I should not edit first and classify later.",
    "",
    "Before changing repository files, I should choose the typed edit tool",
    "that matches the intent of the change. The tool choice is part of the",
    "reasoning step, not just ceremony.",
    "",
    "If a direct edit or shell write would skip that declaration, I should",
    "stop and make the declaration first.",
    "",
    "---",
    "",
    "meta-edit MCP server is registered for this project. New session detected.",
    "",
    "Before your first edit, invoke the `typed-edit-onboarding` skill via the",
    "Skill tool to load the seventeen-tool catalog and selection heuristic.",
    "Empty file creation is free (no MCP declaration); content fills go through",
    "the appropriate edit_<TYPE> tool against the now-empty file. Use ToolSearch",
    "with `select:mcp__plugin_meta-edit_meta-edit__edit_<name>` to load any",
    "tool's schema on demand."
  ].join(`
`);
}
async function main() {
  const event = await readStdin();
  const sessionId = typeof event.session_id === "string" && event.session_id.length > 0 ? event.session_id : null;
  if (sessionId === null) {
    return replyAllow();
  }
  const repoRoot = resolveRepoRoot(typeof event.cwd === "string" ? event.cwd : undefined);
  const markerPath = path4.join(repoRoot, ".meta-edit", "state", "sessions", `${sessionId}.json`);
  if (!claimOnboardingMarker(markerPath, sessionId)) {
    return replyAllow();
  }
  const payload = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: buildOnboardingMessage()
    }
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}
if (__require.main == __require.module) {
  main().then((code) => process.exit(code), (err) => {
    process.stderr.write(`session-onboarding hook crashed: ${err.message}
`);
    process.exit(0);
  });
}
export {
  buildOnboardingMessage
};

//# debugId=92CFCAA638F34BAE64756E2164756E21

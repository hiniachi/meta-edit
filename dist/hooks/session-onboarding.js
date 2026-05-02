#!/usr/bin/env node
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

// src/hooks/session-onboarding.ts
import * as fs from "node:fs";
import * as path from "node:path";

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

// src/hooks/session-onboarding.ts
function resolveRepoRoot(eventCwd) {
  if (typeof eventCwd === "string" && eventCwd.length > 0) {
    return path.resolve(eventCwd);
  }
  const envRoot = process.env["META_EDIT_REPO_ROOT"];
  if (typeof envRoot === "string" && envRoot.length > 0) {
    return path.resolve(envRoot);
  }
  return process.cwd();
}
function alreadyOnboarded(markerPath) {
  try {
    fs.statSync(markerPath);
    return true;
  } catch (e) {
    if (e.code === "ENOENT")
      return false;
    return true;
  }
}
function writeMarker(markerPath, sessionId) {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({
      session_id: sessionId,
      ts: new Date().toISOString()
    }, null, 2), { encoding: "utf8" });
  } catch {}
}
function buildOnboardingMessage() {
  return [
    "meta-edit MCP server is registered for this project. New session detected.",
    "",
    "Before your first edit, invoke the `typed-edit-onboarding` skill via the",
    "Skill tool to load the eighteen-tool catalog and selection heuristic.",
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
  const repoRoot = resolveRepoRoot(event.cwd);
  const markerPath = path.join(repoRoot, ".meta-edit", "state", "sessions", `${sessionId}.json`);
  if (alreadyOnboarded(markerPath)) {
    return replyAllow();
  }
  writeMarker(markerPath, sessionId);
  const payload = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: buildOnboardingMessage()
    }
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}
main().then((code) => process.exit(code), (err) => {
  process.stderr.write(`session-onboarding hook crashed: ${err.message}
`);
  process.exit(0);
});

//# debugId=03CBDB34DFC6BC4764756E2164756E21

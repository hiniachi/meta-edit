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

// src/hooks/raw-edit-policy.ts
var RAW_EDIT_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit"
]);
function evaluateRawEdit(toolName) {
  if (RAW_EDIT_TOOLS.has(toolName)) {
    return {
      decision: "deny",
      reason: `meta-edit forbids the raw "${toolName}" tool. ` + `Choose one of the seventeen edit_* tools that match the kind of ` + `change you are making (see docs/SPEC.md §4). If no edit_* tool ` + `fits, stop and ask the user before bypassing the typed surface.`
    };
  }
  return { decision: "allow" };
}

// src/hooks/deny-raw-edit.ts
async function main() {
  const event = await readStdin();
  const toolName = typeof event["tool_name"] === "string" ? event["tool_name"] : "";
  const decision = evaluateRawEdit(toolName);
  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-raw-edit");
  }
  return replyAllow();
}
main().then((code) => process.exit(code), (err) => {
  console.error(`deny-raw-edit hook crashed: ${err.message}`);
  process.exit(2);
});

//# debugId=51F39A1BD626367064756E2164756E21

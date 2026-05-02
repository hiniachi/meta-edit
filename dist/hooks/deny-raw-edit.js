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
// package.json
var package_default = {
  name: "@hiniachi/meta-edit",
  version: "0.1.5",
  description: "MCP server with nineteen kind-specific edit tools that encode test obligations in tool descriptions",
  license: "MIT",
  author: "nia <nia@yukinofurumachi.com>",
  type: "module",
  bin: {
    "meta-edit": "dist/cli.js",
    "meta-edit-deny-raw-edit": "dist/hooks/deny-raw-edit.js",
    "meta-edit-deny-bash-write-bypass": "dist/hooks/deny-bash-write-bypass.js"
  },
  main: "./dist/server.js",
  files: [
    "dist/",
    "docs/SPEC.md",
    ".claude-plugin/",
    "hooks/",
    "README.md",
    "LICENSE"
  ],
  scripts: {
    build: "bun build src/cli.ts src/server.ts src/hooks/deny-raw-edit.ts src/hooks/deny-bash-write-bypass.ts --target node --outdir dist --root src --sourcemap=external",
    test: "bun test",
    "test:node": "node --test --experimental-strip-types --no-warnings",
    typecheck: "tsc --noEmit",
    start: "bun run src/cli.ts"
  },
  engines: {
    node: ">=20"
  },
  dependencies: {
    "@modelcontextprotocol/sdk": "^1.0.0",
    diff: "^9",
    zod: "^3.23.0"
  },
  devDependencies: {
    "@types/bun": "^1.3.13",
    "@types/diff": "^8",
    "@types/node": "^22.0.0",
    typescript: "^5.6.0"
  },
  repository: {
    type: "git",
    url: "git+https://github.com/hiniachi/meta-edit.git"
  },
  keywords: [
    "mcp",
    "claude-code",
    "ai-coding",
    "edit-tools",
    "test-obligations"
  ]
};

// src/version.ts
var VERSION = package_default.version;

// src/docs-urls.ts
var BASE = `https://github.com/hiniachi/meta-edit/blob/v${VERSION}`;
var SPEC_URL = `${BASE}/docs/SPEC.md`;
var SPEC_TOOLS_URL = `${BASE}/docs/SPEC.md#4-the-nineteen-tool-descriptions`;
var SPEC_BASH_HOOK_URL = `${BASE}/docs/SPEC.md#52-deny-bash-write-bypass`;

// src/hooks/raw-edit-policy.ts
var RAW_EDIT_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit"
]);
var LOWER_RAW_EDIT_TOOLS = new Set([...RAW_EDIT_TOOLS].map((t) => t.toLowerCase()));
function evaluateRawEdit(toolName) {
  if (LOWER_RAW_EDIT_TOOLS.has(toolName.toLowerCase())) {
    return {
      decision: "deny",
      reason: `meta-edit forbids the raw "${toolName}" tool. ` + `Choose one of the nineteen edit_* tools that match the kind of ` + `change you are making (full list: ${SPEC_TOOLS_URL}). If no ` + `edit_* tool fits, stop and ask the user before bypassing the ` + `typed surface.`
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
  if (decision.decision === "warn") {
    return replyAllowWithWarning(decision.reason ?? "warned by deny-raw-edit");
  }
  return replyAllow();
}
main().then((code) => process.exit(code), (err) => {
  console.error(`deny-raw-edit hook crashed: ${err.message}`);
  process.exit(2);
});

//# debugId=D36BD3DAD710B03864756E2164756E21

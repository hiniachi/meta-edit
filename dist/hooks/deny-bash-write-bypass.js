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

// src/hooks/bash-write-policy.ts
var DENY_SUBSTRINGS = [
  "sed -i",
  "sed --in-place",
  "perl -pi",
  "perl -i",
  "cat >",
  "cat >>",
  "tee ",
  "tee\t",
  "tee -a",
  "git apply",
  "rsync ",
  "rsync\t"
];
var PROTECTED_PATH_NEEDLES = [
  ".meta-edit/state",
  ".meta-edit/tmp"
];
function evaluateBashCommand(command) {
  if (typeof command !== "string" || command.length === 0) {
    return { decision: "allow" };
  }
  const segments = splitSegments(command);
  if (segments.length === 0) {
    return { decision: "allow" };
  }
  for (const segment of segments) {
    const decision = evaluateSegment(segment);
    if (decision.decision === "deny") {
      return decision;
    }
  }
  return { decision: "allow" };
}
function evaluateSegment(rawSegment) {
  const normalized = collapsePathDoublings(rawSegment.replace(/\\/g, ""));
  if (touchesProtectedPath(normalized)) {
    return {
      decision: "deny",
      reason: "command touches a protected meta-edit path " + "(.meta-edit/state/** or .meta-edit/tmp/**); writes to these " + "paths must go through an edit_policy_change tool call."
    };
  }
  for (const needle of DENY_SUBSTRINGS) {
    if (normalized.includes(needle)) {
      return {
        decision: "deny",
        reason: denyReason(needle)
      };
    }
  }
  const verb = extractCommandVerb(normalized.trimStart());
  if (verb !== null && DENY_VERBS.has(verb)) {
    return {
      decision: "deny",
      reason: denyReason(verb)
    };
  }
  if (matchesPythonNodeWrite(normalized)) {
    return {
      decision: "deny",
      reason: `inline "python -c" / "node -e" with write_text, .write, open(..., 'w'), or writeFile* is a bash bypass; use an edit_* tool instead.`
    };
  }
  return { decision: "allow" };
}
function splitSegments(cmd) {
  const segments = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0;i < cmd.length; i++) {
    const c = cmd[i];
    const next = cmd[i + 1];
    if (!inSingle && c === "\\" && i + 1 < cmd.length) {
      buf += c + next;
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      buf += c;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      buf += c;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (c === "&" && next === "&") {
        segments.push(buf);
        buf = "";
        i++;
        continue;
      }
      if (c === "|" && next === "|") {
        segments.push(buf);
        buf = "";
        i++;
        continue;
      }
      if (c === ";" || c === "|" || c === `
`) {
        segments.push(buf);
        buf = "";
        continue;
      }
      if (c === "&") {
        const prev = i > 0 ? cmd[i - 1] : undefined;
        if (next === ">" || prev === ">") {
          buf += c;
          continue;
        }
        segments.push(buf);
        buf = "";
        continue;
      }
    }
    buf += c;
  }
  segments.push(buf);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}
function denyReason(pattern) {
  return `command matches deny pattern "${pattern}". meta-edit reserves ` + `direct file writes for the seventeen edit_* tools; if a formatter ` + `or codegen needs to run, route it through the allowlist (see ` + `docs/SPEC.md §5.2).`;
}
var WRAPPER_VERBS = new Set([
  "sudo",
  "doas",
  "env",
  "xargs",
  "nice",
  "ionice",
  "nohup",
  "time",
  "command",
  "exec",
  "eval",
  "stdbuf",
  "chrt",
  "taskset"
]);
var DENY_VERBS = new Set(["mv", "cp", "patch"]);
function collapsePathDoublings(s) {
  let prev;
  let cur = s;
  do {
    prev = cur;
    cur = cur.replace(/\/(\.\/)+/g, "/");
    cur = cur.replace(/\/[^/]+\/\.\.(?=\/|$)/g, "");
    cur = cur.replace(/\/{2,}/g, "/");
  } while (cur !== prev);
  return cur;
}
function extractCommandVerb(segment) {
  let s = stripLeadingEnvAssignments(segment);
  for (let safety = 0;safety < 32; safety++) {
    s = stripLeadingEnvAssignments(s);
    const m = /^(\S+)/.exec(s);
    if (m === null || m[0] === undefined)
      return null;
    const word = m[0];
    const baseStart = word.lastIndexOf("/");
    const base = baseStart >= 0 ? word.slice(baseStart + 1) : word;
    if (WRAPPER_VERBS.has(base)) {
      s = s.slice(word.length).replace(/^\s+/, "");
      while (true) {
        const optMatch = /^(-[^\s-]\S*|--[^\s=]+(?:=\S*)?)/.exec(s);
        if (optMatch === null || optMatch[0] === undefined)
          break;
        s = s.slice(optMatch[0].length).replace(/^\s+/, "");
      }
      continue;
    }
    return base;
  }
  return null;
}
function stripLeadingEnvAssignments(s) {
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === " " || s[i] === "\t")) {
      i++;
    }
    const nameStart = i;
    if (i < s.length && (s[i] >= "A" && s[i] <= "Z" || s[i] >= "a" && s[i] <= "z" || s[i] === "_")) {
      i++;
      while (i < s.length && (s[i] >= "A" && s[i] <= "Z" || s[i] >= "a" && s[i] <= "z" || s[i] >= "0" && s[i] <= "9" || s[i] === "_")) {
        i++;
      }
      if (s[i] !== "=") {
        return s.slice(nameStart);
      }
      i++;
      let inSingle = false;
      let inDouble = false;
      while (i < s.length) {
        const c = s[i];
        if (!inSingle && c === "\\" && i + 1 < s.length) {
          i += 2;
          continue;
        }
        if (c === "'" && !inDouble) {
          inSingle = !inSingle;
          i++;
          continue;
        }
        if (c === '"' && !inSingle) {
          inDouble = !inDouble;
          i++;
          continue;
        }
        if (!inSingle && !inDouble && (c === " " || c === "\t")) {
          break;
        }
        i++;
      }
      continue;
    }
    return s.slice(i);
  }
  return "";
}
function touchesProtectedPath(command) {
  for (const needle of PROTECTED_PATH_NEEDLES) {
    if (command.includes(needle)) {
      return true;
    }
  }
  return false;
}
var PYTHON_WRITE_RE = /write_text|\.write\(|open\(\s*[^)]*['"]w/;
var NODE_WRITE_RE = /writeFile|writeFileSync/;
function matchesPythonNodeWrite(command) {
  if (/(?:^|[\s;&|(])python3?\s+-c\b/.test(command)) {
    if (PYTHON_WRITE_RE.test(command)) {
      return true;
    }
  }
  if (/(?:^|[\s;&|(])node\s+(?:-e\b|--eval(?:\b|=))/.test(command)) {
    if (NODE_WRITE_RE.test(command)) {
      return true;
    }
  }
  return false;
}

// src/hooks/deny-bash-write-bypass.ts
async function main() {
  const event = await readStdin();
  const toolName = typeof event["tool_name"] === "string" ? event["tool_name"] : "";
  if (toolName !== "Bash") {
    return replyAllow();
  }
  const input = event["tool_input"] ?? {};
  const command = typeof input.command === "string" ? input.command : "";
  const decision = evaluateBashCommand(command);
  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-bash-write-bypass");
  }
  return replyAllow();
}
main().then((code) => process.exit(code), (err) => {
  console.error(`deny-bash-write-bypass hook crashed: ${err.message}`);
  process.exit(2);
});

//# debugId=229BB9B9D520D27D64756E2164756E21

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
function containsAsPathComponent(s, needle) {
  let from = 0;
  while (from <= s.length - needle.length) {
    const idx = s.indexOf(needle, from);
    if (idx < 0)
      return false;
    const after = idx + needle.length < s.length ? s[idx + needle.length] : undefined;
    if (isPathComponentContinuation(after)) {
      from = idx + 1;
      continue;
    }
    if (hasAcceptableBeforeBoundary(s, idx)) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}
function isPathComponentContinuation(c) {
  if (c === undefined)
    return false;
  return /^[A-Za-z0-9._-]$/.test(c);
}
function hasAcceptableBeforeBoundary(s, pos) {
  if (pos === 0)
    return true;
  const before = s[pos - 1];
  if (before === "/")
    return true;
  if (!isPathComponentContinuation(before))
    return true;
  const tokenStart = findTokenStart(s, pos);
  const prefix = s.slice(tokenStart, pos);
  if (/^-[A-Za-z]+$/.test(prefix))
    return true;
  if (/^--[A-Za-z][A-Za-z0-9-]*=$/.test(prefix))
    return true;
  return false;
}
function findTokenStart(s, pos) {
  let i = pos;
  while (i > 0) {
    const c = s[i - 1];
    if (c === " " || c === "\t" || c === `
` || c === "\r" || c === "'" || c === '"' || c === "(" || c === ";" || c === "|" || c === "&" || c === ">" || c === "<" || c === "=" || c === "$") {
      break;
    }
    i--;
  }
  return i;
}
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
    const verb2 = extractCommandVerb(normalized.trimStart());
    const isReadOnly = verb2 !== null && READ_ONLY_VERBS.has(verb2);
    const writeTargetsProtected = redirectsToProtected(normalized);
    if (!isReadOnly || writeTargetsProtected) {
      return {
        decision: "deny",
        reason: "command would write to a protected meta-edit path " + "(.meta-edit/state/** or .meta-edit/tmp/**); writes to these " + "paths must go through an edit_policy_change tool call."
      };
    }
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
  if (verb !== null && DENY_VERBS.has(verb) && !hasSafetyFlag(normalized, verb)) {
    return {
      decision: "deny",
      reason: denyReason(verb)
    };
  }
  if (matchesPythonNodeWrite(normalized, rawSegment)) {
    return {
      decision: "deny",
      reason: `inline "python -c" / "node -e" with write_text, .write, open(..., 'w'), or writeFile* is a bash bypass; use an edit_* tool instead.`
    };
  }
  return { decision: "allow" };
}
function splitSegments(cmd) {
  const main = primarySplitSegments(cmd);
  const result = [];
  for (const seg of main) {
    result.push(seg);
    for (const inner of extractSubstitutionInners(seg)) {
      for (const innerSeg of splitSegments(inner)) {
        result.push(innerSeg);
      }
    }
  }
  return result;
}
function primarySplitSegments(cmd) {
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
` || c === "\r" || c === "\u2028" || c === "\u2029") {
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
function extractSubstitutionInners(seg) {
  const inners = [];
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < seg.length) {
    const c = seg[i];
    if (!inSingle && c === "\\" && i + 1 < seg.length) {
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
    if (!inSingle && c === "$" && seg[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      let innerSingle = false;
      let innerDouble = false;
      while (j < seg.length && depth > 0) {
        const cj = seg[j];
        if (cj === "\\" && !innerSingle && j + 1 < seg.length) {
          j += 2;
          continue;
        }
        if (cj === "'" && !innerDouble) {
          innerSingle = !innerSingle;
          j++;
          continue;
        }
        if (cj === '"' && !innerSingle) {
          innerDouble = !innerDouble;
          j++;
          continue;
        }
        if (!innerSingle && !innerDouble) {
          if (cj === "(") {
            depth++;
          } else if (cj === ")") {
            depth--;
            if (depth === 0)
              break;
          }
        }
        j++;
      }
      if (depth === 0) {
        inners.push(seg.slice(i + 2, j));
        i = j + 1;
        continue;
      }
      return inners;
    }
    if (!inSingle && c === "`") {
      let j = i + 1;
      while (j < seg.length) {
        const cj = seg[j];
        if (cj === "\\" && j + 1 < seg.length) {
          j += 2;
          continue;
        }
        if (cj === "`")
          break;
        j++;
      }
      if (j < seg.length) {
        inners.push(seg.slice(i + 1, j));
        i = j + 1;
        continue;
      }
      return inners;
    }
    i++;
  }
  return inners;
}
function denyReason(pattern) {
  return `command matches deny pattern "${pattern}". meta-edit reserves ` + `direct file writes for the eighteen edit_* tools; if a formatter ` + `or codegen needs to run, route it through the allowlist (see ` + `docs/SPEC.md §5.2).`;
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
var WRAPPER_VALUE_OPTS = {
  sudo: new Set([
    "-u",
    "-g",
    "-h",
    "-C",
    "-D",
    "-p",
    "-r",
    "-t",
    "-T",
    "-R",
    "-c",
    "-U"
  ]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "-C", "-S"])
};
var READ_ONLY_VERBS = new Set([
  "tail",
  "head",
  "cat",
  "grep",
  "egrep",
  "fgrep",
  "wc",
  "cut",
  "tr",
  "od",
  "hexdump",
  "stat",
  "ls",
  "du",
  "df",
  "jq",
  "diff",
  "cmp"
]);
function redirectsToProtected(s) {
  let i = 0;
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
    if (inSingle || inDouble || c !== ">") {
      i++;
      continue;
    }
    if (s[i + 1] === "&") {
      i += 2;
      continue;
    }
    let j = i + 1;
    if (s[j] === ">")
      j++;
    while (j < s.length && (s[j] === " " || s[j] === "\t"))
      j++;
    const tokenStart = j;
    while (j < s.length) {
      const tc = s[j];
      if (tc === " " || tc === "\t" || tc === ";" || tc === "|" || tc === "&" || tc === `
` || tc === ">" || tc === "<") {
        break;
      }
      j++;
    }
    let target = s.slice(tokenStart, j);
    target = target.replace(/^["']|["']$/g, "");
    for (const needle of PROTECTED_PATH_NEEDLES) {
      if (containsAsPathComponent(target, needle)) {
        return true;
      }
    }
    i = j;
  }
  return false;
}
function hasSafetyFlag(segment, verb) {
  if (verb === "cp") {
    return /(?:^|\s)(?:--no-clobber|-n)(?:\s|$)/.test(segment);
  }
  if (verb === "patch") {
    return /(?:^|\s)(?:--dry-run|--check)(?:\s|$)/.test(segment);
  }
  return false;
}
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
    const m = s.match(/^(\S+)/);
    if (m === null || m[0] === undefined)
      return null;
    const word = m[0];
    const baseStart = word.lastIndexOf("/");
    const base = baseStart >= 0 ? word.slice(baseStart + 1) : word;
    if (WRAPPER_VERBS.has(base)) {
      const valueOpts = WRAPPER_VALUE_OPTS[base];
      s = s.slice(word.length).replace(/^\s+/, "");
      while (true) {
        const optMatch = s.match(/^(-[^\s-]\S*|--[^\s=]+(?:=\S*)?)/);
        if (optMatch === null || optMatch[0] === undefined)
          break;
        const opt = optMatch[0];
        s = s.slice(opt.length).replace(/^\s+/, "");
        if (valueOpts !== undefined && !opt.includes("=") && valueOpts.has(opt)) {
          const valMatch = s.match(/^\S+/);
          if (valMatch !== null && valMatch[0] !== undefined) {
            s = s.slice(valMatch[0].length).replace(/^\s+/, "");
          }
        }
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
    if (containsAsPathComponent(command, needle)) {
      return true;
    }
  }
  return false;
}
var PYTHON_WRITE_RE = /write_text|\.write\(|open\(\s*[^)]*['"]w/;
var NODE_WRITE_RE = /writeFile|writeFileSync/;
var NODE_INVOCATION_RE = /(?:^|[\s;&|(])node\s+(?:-e\b|--[e]val\b=?)/;
var NODE_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])node\s+(?:-e\b|--[e]val\b=?)\s*/;
function matchesPythonNodeWrite(normalized, raw) {
  if (/(?:^|[\s;&|(])python3?\s+-c\b/.test(normalized)) {
    const rawHit = raw.match(/(?:^|[\s;&|(])python3?\s+-c\s+/);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null) {
        const masked = maskLanguageStringLiterals(arg);
        if (PYTHON_WRITE_RE.test(masked))
          return true;
      } else if (PYTHON_WRITE_RE.test(normalized)) {
        return true;
      }
    } else if (PYTHON_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  if (NODE_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(NODE_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null) {
        const masked = maskLanguageStringLiterals(arg);
        if (NODE_WRITE_RE.test(masked))
          return true;
      } else if (NODE_WRITE_RE.test(normalized)) {
        return true;
      }
    } else if (NODE_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  return false;
}
function readShellArg(s, start) {
  if (start >= s.length)
    return null;
  const first = s[start];
  if (first === '"') {
    let i2 = start + 1;
    let buf = "";
    while (i2 < s.length) {
      if (s[i2] === "\\" && i2 + 1 < s.length) {
        buf += s[i2 + 1];
        i2 += 2;
        continue;
      }
      if (s[i2] === '"')
        return buf;
      buf += s[i2];
      i2++;
    }
    return null;
  }
  if (first === "'") {
    const j = s.indexOf("'", start + 1);
    if (j < 0)
      return null;
    return s.slice(start + 1, j);
  }
  if (first === "$" && s[start + 1] === "'") {
    let i2 = start + 2;
    let buf = "";
    while (i2 < s.length) {
      if (s[i2] === "\\" && i2 + 1 < s.length) {
        buf += s[i2 + 1];
        i2 += 2;
        continue;
      }
      if (s[i2] === "'")
        return buf;
      buf += s[i2];
      i2++;
    }
    return null;
  }
  let i = start;
  while (i < s.length && !/\s/.test(s[i]))
    i++;
  return s.slice(start, i);
}
function maskLanguageStringLiterals(s) {
  let result = "";
  let i = 0;
  while (i < s.length) {
    const start = detectStringStart(s, i);
    if (start === null) {
      result += s[i];
      i++;
      continue;
    }
    const { prefixLen, quote, isF } = start;
    const quoteStart = i + prefixLen;
    const prefix = s.slice(i, quoteStart);
    if (s[quoteStart + 1] === quote && s[quoteStart + 2] === quote) {
      const triple = quote + quote + quote;
      const end = s.indexOf(triple, quoteStart + 3);
      if (end < 0) {
        result += s.slice(i);
        return result;
      }
      if (isF) {
        const inner = s.slice(quoteStart + 3, end);
        result += prefix + triple + preserveFInterpolations(inner) + triple;
      } else {
        result += prefix + triple + triple;
      }
      i = end + 3;
      continue;
    }
    let j = quoteStart + 1;
    while (j < s.length) {
      if (s[j] === "\\" && j + 1 < s.length) {
        j += 2;
        continue;
      }
      if (s[j] === quote)
        break;
      j++;
    }
    if (j >= s.length) {
      result += s.slice(i);
      return result;
    }
    if (isF) {
      const inner = s.slice(quoteStart + 1, j);
      result += prefix + quote + preserveFInterpolations(inner) + quote;
    } else {
      result += prefix + quote + quote;
    }
    i = j + 1;
  }
  return result;
}
function detectStringStart(s, i) {
  const c0 = s[i];
  if (c0 === undefined)
    return null;
  if (c0 === "'" || c0 === '"') {
    return { prefixLen: 0, quote: c0, isF: false };
  }
  const isPrefixChar = (c) => c !== undefined && /^[fFrRbBuU]$/.test(c);
  if (isPrefixChar(c0) && (s[i + 1] === "'" || s[i + 1] === '"')) {
    return {
      prefixLen: 1,
      quote: s[i + 1],
      isF: c0 === "f" || c0 === "F"
    };
  }
  if (isPrefixChar(c0) && isPrefixChar(s[i + 1]) && (s[i + 2] === "'" || s[i + 2] === '"')) {
    const c1 = s[i + 1];
    return {
      prefixLen: 2,
      quote: s[i + 2],
      isF: c0 === "f" || c0 === "F" || c1 === "f" || c1 === "F"
    };
  }
  return null;
}
function preserveFInterpolations(content) {
  let result = "";
  let i = 0;
  while (i < content.length) {
    const c = content[i];
    if (c === "{" && content[i + 1] === "{") {
      i += 2;
      continue;
    }
    if (c === "}" && content[i + 1] === "}") {
      i += 2;
      continue;
    }
    if (c === "{") {
      let j = i + 1;
      let depth = 1;
      while (j < content.length && depth > 0) {
        const cj = content[j];
        if (cj === "{") {
          depth++;
        } else if (cj === "}") {
          depth--;
          if (depth === 0)
            break;
        }
        j++;
      }
      if (depth === 0) {
        result += content.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      return result;
    }
    i++;
  }
  return result;
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

//# debugId=9D4E1C7DBD47FD5164756E2164756E21

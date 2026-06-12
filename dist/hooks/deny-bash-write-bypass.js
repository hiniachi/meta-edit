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
function replyWithAdditionalContext(additionalContext) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext
    }
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}

// src/hooks/bash-write-policy.ts
import * as path3 from "node:path";

// src/state/protected-paths.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";

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

// src/hooks/bash-write-policy.ts
var DENY_SUBSTRINGS = [
  "sed -i",
  "sed --in-place",
  "perl -pi",
  "perl -i",
  "cat >",
  "cat >>",
  "git apply"
];
var VERB_ARG_SEPARATORS = [" ", "\t"];
var DENY_VERB_NAMES = ["patch"];
var WARN_VERB_NAMES = ["mv", "cp", "rsync"];
function expandVerbPrefixes(verbs) {
  return verbs.flatMap((v) => VERB_ARG_SEPARATORS.map((s) => v + s));
}
var DENY_PREFIX_PATTERNS = expandVerbPrefixes(DENY_VERB_NAMES);
var WARN_PREFIX_PATTERNS = expandVerbPrefixes(WARN_VERB_NAMES);
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
function evaluateBashCommand(command, opts = {}) {
  if (typeof command !== "string" || command.length === 0) {
    return { decision: "allow" };
  }
  command = command.replace(new RegExp("(>>|>\\||>)([\\r\\n\\u2028\\u2029]+)", "g"), (_m, op) => `${op} `);
  if (matchesDecodeAndExecute(stripQuotedContent(command))) {
    return {
      decision: "deny",
      reason: "decoder piped into a shell interpreter (e.g. `base64 -d | bash`) " + "executes arbitrary commands at runtime, bypassing every static " + "deny pattern. Use an edit_* tool instead."
    };
  }
  const segments = splitSegments(command);
  if (segments.length === 0) {
    return { decision: "allow" };
  }
  let firstWarn = null;
  for (const segment of segments) {
    const decision = evaluateSegment(segment, opts);
    if (decision.decision === "deny") {
      return decision;
    }
    if (decision.decision === "warn" && firstWarn === null) {
      firstWarn = decision;
    }
  }
  if (firstWarn !== null)
    return firstWarn;
  return { decision: "allow" };
}
function evaluateSegment(rawSegment, opts = {}) {
  const ansiExpanded = expandAnsiCQuoting(rawSegment);
  const normalized = collapsePathDoublings(ansiExpanded.replace(/\\/g, ""));
  const scanText = stripQuotedContent(normalized);
  if (touchesProtectedPathTokenized(rawSegment)) {
    const verb2 = extractCommandVerb(normalized.trimStart());
    const isReadOnly = verb2 !== null && READ_ONLY_VERBS.has(verb2);
    const writeTargetsProtected = redirectsToProtected(normalized, opts);
    if (!isReadOnly || writeTargetsProtected) {
      return {
        decision: "deny",
        reason: "command would write to a protected meta-edit path " + "(.meta-edit/state/** or .meta-edit/tmp/**); writes to these " + "paths must go through an edit_policy_change tool call."
      };
    }
  }
  if (opts.cwd && redirectsToProtected(normalized, opts)) {
    return {
      decision: "deny",
      reason: "command would write to a protected meta-edit path " + "(.meta-edit/state/** or .meta-edit/tmp/**) via a symlinked " + "redirect target; writes to these paths must go through an " + "edit_policy_change tool call."
    };
  }
  const trimOffset = normalized.length - normalized.trimStart().length;
  const verbInfo = extractCommandVerbInfo(normalized.trimStart());
  const verbWindowEnd = verbInfo === null ? scanText.length : trimOffset + verbInfo.verbEnd + VERB_WINDOW_TAIL_CHARS;
  let firstWarn = null;
  for (const needle of DENY_SUBSTRINGS) {
    const pos = scanText.indexOf(needle);
    if (pos < 0)
      continue;
    if (pos < verbWindowEnd) {
      return {
        decision: "deny",
        reason: denyReason(needle)
      };
    }
    if (firstWarn === null) {
      firstWarn = {
        decision: "warn",
        reason: `pattern "${needle}" appears at argument position (verb is "${verbInfo?.verb ?? "unknown"}"); ` + `not denied because the typed-edit hypothesis (Article 3 + Article 4) trusts ` + `descriptions to guide the agent away from real bypass intent. Recorded as ` + `bypass-risk and may be tightened in a future version (1107).`
      };
    }
  }
  const cpBypass = matchesReadOnlyVerbCpBypass(rawSegment);
  if (cpBypass !== null) {
    return cpBypass;
  }
  const hosted = evaluateShellHostedPayload(rawSegment, opts);
  if (hosted !== null) {
    if (hosted.decision === "deny")
      return hosted;
    if (hosted.decision === "warn" && firstWarn === null)
      firstWarn = hosted;
  }
  if (redirectsOutsideSafeSinkAllowlist(rawSegment) && firstWarn === null) {
    firstWarn = {
      decision: "warn",
      reason: `meta-edit reminder:

` + "I was about to write files through Bash redirection " + "(`>` / `>>` / `>|`) to a path outside the safe-sink allowlist " + `(/dev/null, /tmp/, /var/tmp/, /run/, /sys/).

` + "If this command changes repository files, that would bypass meta-edit's typed edit surface. " + "The next move should be to declare the edit kind first " + "(e.g. edit_state_transition / edit_cosmetic for source code; " + "edit_explanation / edit_progress / edit_observation / edit_proposal / edit_decision " + "for Markdown / docs depending on intent; " + 'for new files, native Write with content = "" is ' + "hook-authorized first, then declare the typed edit_* for the content) " + `and use the normal edit path.

` + "If the command is only inspecting files or running tests, it should not write to the repository. " + "This redirect is permitted but recorded as a bypass-risk and may be tightened to deny in a future version."
    };
  }
  const heredocScan = stripQuotedContent(unquoteHeredocDelimiters(normalized));
  if (/<<-?\s*['"]?[A-Za-z_][\w]*['"]?[^<\n]*?(?<!>)>(?!>|&)/.test(heredocScan)) {
    return {
      decision: "deny",
      reason: "heredoc-with-redirect (`<<MARKER ... > target`) writes to a file. " + "Use an edit_* tool instead of redirecting a heredoc body to a path."
    };
  }
  const verb = extractCommandVerb(normalized.trimStart());
  if (verb !== null && DENY_VERBS.has(verb) && !hasSafetyFlag(normalized, verb)) {
    return {
      decision: "deny",
      reason: denyReason(verb)
    };
  }
  if (verb !== null && WARN_VERBS.has(verb) && !hasSafetyFlag(normalized, verb)) {
    if (commandOperandResolvesProtected(normalized, opts)) {
      return {
        decision: "deny",
        reason: "command would write to a protected meta-edit path " + "(.meta-edit/state/** or .meta-edit/tmp/**) via a symlinked " + "operand; writes to these paths must go through an " + "edit_policy_change tool call."
      };
    }
    if (firstWarn === null) {
      firstWarn = {
        decision: "warn",
        reason: warnVerbReason(verb)
      };
    }
  }
  if (matchesDangerousDd(rawSegment)) {
    return {
      decision: "deny",
      reason: "`dd of=<path>` writes to an arbitrary file when the target is " + "an in-repo path. Use an edit_* tool instead."
    };
  }
  if (matchesDangerousTee(rawSegment)) {
    return {
      decision: "deny",
      reason: "`tee <path>` writes to a file when the target is an in-repo " + "path. Use an edit_* tool instead."
    };
  }
  if (matchesEvalDeferredString(rawSegment)) {
    return {
      decision: "deny",
      reason: "`eval` of a non-literal argument (command substitution / backticks / " + "variable expansion) executes a payload that cannot be statically " + "inspected, bypassing every deny pattern. Use an edit_* tool instead."
    };
  }
  if (matchesPythonNodeWrite(normalized, rawSegment)) {
    return {
      decision: "deny",
      reason: "inline interpreter write (python -c / node -e / perl -e / ruby -e / php -r) " + "is a bash bypass; use an edit_* tool instead."
    };
  }
  if (firstWarn !== null)
    return firstWarn;
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
    for (const inner of extractFindExecInners(seg)) {
      for (const innerSeg of splitSegments(inner)) {
        result.push(innerSeg);
      }
    }
  }
  return result;
}
function extractFindExecInners(seg) {
  const inners = [];
  if (!/(?:^|\s)-exec(?:dir)?(?:\s|$)/.test(seg))
    return inners;
  const verb = extractCommandVerb(seg.trimStart());
  if (verb === null || !FIND_VERBS.has(verb))
    return inners;
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
    if (!inSingle && !inDouble) {
      if (c === "-" && (seg.slice(i, i + 5) === "-exec" || seg.slice(i, i + 8) === "-execdir") && (i === 0 || /\s/.test(seg[i - 1]))) {
        const tokenLen = seg.slice(i, i + 8) === "-execdir" ? 8 : 5;
        const after = seg[i + tokenLen];
        if (after === undefined || /\s/.test(after)) {
          let j = i + tokenLen;
          while (j < seg.length && /\s/.test(seg[j]))
            j++;
          const bodyStart = j;
          let bSingle = false;
          let bDouble = false;
          while (j < seg.length) {
            const cj = seg[j];
            if (!bSingle && cj === "\\" && j + 1 < seg.length) {
              if (seg[j + 1] === ";") {
                break;
              }
              j += 2;
              continue;
            }
            if (cj === "'" && !bDouble) {
              bSingle = !bSingle;
              j++;
              continue;
            }
            if (cj === '"' && !bSingle) {
              bDouble = !bDouble;
              j++;
              continue;
            }
            if (!bSingle && !bDouble) {
              if (cj === "+" && (seg[j + 1] === undefined || /\s/.test(seg[j + 1])) && /\s/.test(seg[j - 1] ?? " ")) {
                break;
              }
            }
            j++;
          }
          let body = seg.slice(bodyStart, j).trim();
          body = body.replace(/(^|\s)\{\}(\s|$)/g, "$1$2").trim();
          if (body.length > 0)
            inners.push(body);
          i = j;
          continue;
        }
      }
    }
    i++;
  }
  return inners;
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
      if (c === "|" && cmd[i - 1] === ">") {
        buf += c;
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
    if (!inSingle && (c === "<" || c === ">") && seg[i + 1] === "(") {
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
function unquoteHeredocDelimiters(s) {
  let out = s.replace(/(<<-?\s*)(['"])([A-Za-z_]\w*)\2/g, (_m, prefix, _q, name) => `${prefix}${name}`);
  out = out.replace(/(<<-?\s*)\\([A-Za-z_]\w*)/g, (_m, prefix, name) => `${prefix}${name}`);
  return out;
}
var ANSI_C_ESCAPE_MAP = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  e: "\x1B",
  f: "\f",
  n: `
`,
  r: "\r",
  t: "\t",
  v: "\v",
  "0": "\x00"
};
function expandAnsiCQuoting(s) {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < s.length) {
    const c = s[i];
    if (!inSingle && !inDouble && c === "$" && s[i + 1] === "'") {
      let j = i + 2;
      while (j < s.length && s[j] !== "'") {
        if (s[j] === "\\" && j + 1 < s.length) {
          const next = s[j + 1];
          if (next === "x") {
            let k = j + 2;
            let hex = "";
            while (k < s.length && k < j + 4 && /[0-9A-Fa-f]/.test(s[k])) {
              hex += s[k];
              k++;
            }
            if (hex.length > 0) {
              out += String.fromCharCode(parseInt(hex, 16));
              j = k;
              continue;
            }
          }
          out += ANSI_C_ESCAPE_MAP[next] ?? next;
          j += 2;
          continue;
        }
        out += s[j];
        j++;
      }
      i = j < s.length ? j + 1 : j;
      continue;
    }
    if (!inDouble && c === "'") {
      inSingle = !inSingle;
      out += c;
      i++;
      continue;
    }
    if (!inSingle && c === '"') {
      inDouble = !inDouble;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function stripQuotedContent(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      out += "'";
      i++;
      while (i < s.length && s[i] !== "'") {
        out += " ";
        i++;
      }
      if (i < s.length) {
        out += "'";
        i++;
      }
      continue;
    }
    if (c === '"') {
      out += '"';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) {
          out += "  ";
          i += 2;
          continue;
        }
        out += " ";
        i++;
      }
      if (i < s.length) {
        out += '"';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function denyReason(pattern) {
  return `command matches deny pattern "${pattern}".`;
}
function warnVerbReason(verb) {
  return `meta-edit reminder:

` + `I was about to use "${verb}", which can write into the repository ` + `(rename/move, copy, or sync).

` + `If this command changes repository content, the next move should be to declare the edit kind first ` + `(e.g. edit_cosmetic / edit_state_transition for source code; ` + `edit_explanation / edit_progress / edit_observation / edit_proposal / edit_decision ` + `for Markdown / docs depending on intent; ` + `for new files, native Write with content = "" is hook-authorized first, then declare the typed edit_* for the content) ` + `and use the normal edit path.

` + `If "${verb}" here is a legitimate non-edit use (rename/move, copy templates/fixtures, backup, deploy/sync), ` + `it is permitted — but recorded as a bypass-risk and may be tightened back to deny in a future version. ` + `Writes to .meta-edit/state/** and .meta-edit/tmp/** remain hard-denied regardless of verb. ` + `See OBSERVED-FAILURES.md for the warn→deny restore trigger.`;
}
var FIND_VERBS = new Set([
  "find",
  "fdfind",
  "fd",
  "gfind"
]);
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
  "taskset",
  "busybox",
  "toybox"
]);
var DENY_VERBS = new Set(DENY_VERB_NAMES);
var WARN_VERBS = new Set(WARN_VERB_NAMES);
var SAFE_ABSOLUTE_PREFIXES = [
  "/tmp/",
  "/var/tmp/",
  "/run/",
  "/sys/"
];
var SAFE_EXACT_TARGETS = new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/zero"
]);
var SAFE_PATH_COMPONENT_NEEDLES = [".claude"];
function isInRepoWriteTarget(target) {
  if (target.length === 0)
    return false;
  if (SAFE_EXACT_TARGETS.has(target))
    return false;
  const resolved = path3.normalize(target);
  if (SAFE_EXACT_TARGETS.has(resolved))
    return false;
  for (const needle of SAFE_PATH_COMPONENT_NEEDLES) {
    if (containsAsPathComponent(resolved, needle))
      return false;
  }
  if (resolved.startsWith("/")) {
    return !SAFE_ABSOLUTE_PREFIXES.some((p) => resolved.startsWith(p));
  }
  return true;
}
function tokenizeSegment(segment) {
  const tokens = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let hasContent = false;
  for (let i = 0;i < segment.length; i++) {
    const c = segment[i];
    if (!inSingle && c === "\\" && i + 1 < segment.length) {
      buf += segment[i + 1];
      hasContent = true;
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      hasContent = true;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      hasContent = true;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (hasContent) {
        tokens.push(buf);
        buf = "";
        hasContent = false;
      }
      continue;
    }
    buf += c;
    hasContent = true;
  }
  if (hasContent)
    tokens.push(buf);
  return tokens;
}
function matchesDangerousDd(segment) {
  const trimmed = stripLeadingEnvAssignments(segment.trimStart());
  const verb = extractCommandVerb(trimmed);
  if (verb !== "dd")
    return false;
  const tokens = tokenizeSegment(trimmed);
  for (const tok of tokens) {
    if (tok.startsWith("of=")) {
      const target = tok.slice(3);
      if (isInRepoWriteTarget(target))
        return true;
    }
  }
  return false;
}
function matchesDangerousTee(segment) {
  const trimmed = stripLeadingEnvAssignments(segment.trimStart());
  const verb = extractCommandVerb(trimmed);
  if (verb !== "tee")
    return false;
  const tokens = tokenizeSegment(trimmed);
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const base = tok.includes("/") ? tok.slice(tok.lastIndexOf("/") + 1) : tok;
    if (base === "tee") {
      i++;
      break;
    }
    i++;
  }
  for (;i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith("-"))
      continue;
    if (isFdRedirectToken(tok))
      continue;
    if (isInRepoWriteTarget(tok))
      return true;
  }
  for (const target of iterRedirectTargets(segment)) {
    if (target.length === 0)
      continue;
    if (isInRepoWriteTarget(target))
      return true;
  }
  return false;
}
function isFdRedirectToken(tok) {
  if (tok.length === 0)
    return false;
  if (tok.startsWith(">") || tok.startsWith("&>"))
    return true;
  if (tok.startsWith("<"))
    return true;
  return /^\d+(?:>|<)/.test(tok);
}
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
  env: new Set(["-u", "-C", "-S"]),
  xargs: new Set([
    "-I",
    "-J",
    "-E",
    "-L",
    "-n",
    "-P",
    "-s",
    "-d",
    "-a"
  ])
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
function redirectsToProtected(s, opts = {}) {
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
    if (s[j] === ">" || s[j] === "|")
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
    if (opts.cwd && target.length > 0) {
      const absolute = path3.isAbsolute(target) ? target : path3.resolve(opts.cwd, target);
      const rel = path3.relative(opts.cwd, absolute);
      if (rel.length > 0 && isProtectedPath(rel, { repoRoot: opts.cwd })) {
        return true;
      }
    }
    i = j;
  }
  return false;
}
function* operandPathCandidates(token) {
  if (token.length === 0)
    return;
  if (!token.startsWith("-")) {
    yield token;
    return;
  }
  const eq = token.indexOf("=");
  if (eq >= 0) {
    yield token.slice(eq + 1);
    return;
  }
  if (token.length > 2 && /[A-Za-z]/.test(token[1])) {
    yield token.slice(2);
  }
}
function commandOperandResolvesProtected(normalized, opts) {
  const cwd = opts.cwd;
  if (!cwd)
    return false;
  for (const token of tokenizeSegment(normalized)) {
    for (const candidate of operandPathCandidates(token)) {
      if (candidate.length === 0)
        continue;
      const absolute = path3.isAbsolute(candidate) ? candidate : path3.resolve(cwd, candidate);
      const rel = path3.relative(cwd, absolute);
      if (rel.length > 0 && isProtectedPath(rel, { repoRoot: cwd })) {
        return true;
      }
    }
  }
  return false;
}
function* iterRedirectTargets(s, opts = {}) {
  const skipSub = opts.skipSubstitutionInternal === true;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let subDepth = 0;
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
    if (!inSingle && c === "$" && s[i + 1] === "(") {
      subDepth++;
      i += 2;
      continue;
    }
    if (!inSingle && !inDouble && c === ")" && subDepth > 0) {
      subDepth--;
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
    if (skipSub && subDepth > 0) {
      i++;
      continue;
    }
    let j = i + 1;
    if (s[j] === ">" || s[j] === "|")
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
    yield target;
    i = j;
  }
}
var SHELL_HOSTING_C_RE = /(?:^|[\s;&|(])(?:[A-Za-z0-9_.\/-]*\/)?(?:r?bash|sh|dash|zsh|m?ksh|ash)\d*(?:\.\d+)*\s+(?:-o\s+[^\s-]\S*\s+|--(?:init-file|rcfile)\s+[^\s-]\S*\s+|--?[A-Za-z][^\s]*\s+)*(?:-[A-Za-z]*c[A-Za-z]*)\b\s*/;
function evaluateShellHostedPayload(rawSegment, opts) {
  const cMatch = rawSegment.match(SHELL_HOSTING_C_RE);
  if (cMatch !== null && typeof cMatch.index === "number") {
    const argStart = cMatch.index + cMatch[0].length;
    const arg = readShellArg(rawSegment, argStart);
    const hit = recursivelyEvaluateArg(arg, opts);
    if (hit !== null)
      return hit;
  }
  const evalArg = extractEvalArg(rawSegment);
  if (evalArg !== null) {
    const hit = recursivelyEvaluateArg(evalArg, opts);
    if (hit !== null)
      return hit;
  }
  return null;
}
function recursivelyEvaluateArg(arg, opts) {
  if (arg === null || arg.length === 0)
    return null;
  const deEscaped = arg.replace(/\\/g, "");
  const decision = evaluateBashCommand(deEscaped, opts);
  if (decision.decision === "deny" || decision.decision === "warn") {
    return decision;
  }
  return null;
}
function extractEvalArg(rawSegment) {
  let s = stripLeadingEnvAssignments(rawSegment.trimStart());
  for (let safety = 0;safety < 32; safety++) {
    s = stripLeadingEnvAssignments(s);
    const m = s.match(/^(\S+)/);
    if (m === null || m[0] === undefined)
      return null;
    const word = m[0];
    const baseStart = word.lastIndexOf("/");
    const base = baseStart >= 0 ? word.slice(baseStart + 1) : word;
    if (base === "eval") {
      const argStart = word.length + (s.slice(word.length).match(/^\s+/)?.[0].length ?? 0);
      return readShellArg(s, argStart);
    }
    if (!WRAPPER_VERBS.has(base))
      return null;
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
  }
  return null;
}
function redirectsOutsideSafeSinkAllowlist(rawSegment) {
  for (const target of iterRedirectTargets(rawSegment, {
    skipSubstitutionInternal: true
  })) {
    if (target.length === 0)
      continue;
    if (isInRepoWriteTarget(target))
      return true;
  }
  return false;
}
function matchesReadOnlyVerbCpBypass(rawSegment) {
  const trimmed = stripLeadingEnvAssignments(rawSegment.trimStart());
  const verb = extractCommandVerb(trimmed);
  if (verb === null || !READ_ONLY_VERBS.has(verb))
    return null;
  for (const target of iterRedirectTargets(rawSegment)) {
    if (target.length === 0)
      continue;
    if (isInRepoWriteTarget(target)) {
      return {
        decision: "deny",
        reason: `\`${verb} ... > <in-repo target>\` is functionally a copy/transform ` + `into a repo file. Use a typed edit_* tool (edit_cosmetic for source code, ` + `edit_explanation / edit_progress / edit_observation / edit_proposal / edit_decision for Markdown / docs by intent, or whichever kind-specific impl tool fits the change) instead of ` + `redirecting a read-only verb's stdout to a repository path. For ` + `new files, native Write with content = "" is hook-authorized; ` + `then declare a typed_edit for the content. Out-of-repo redirects (` + `/dev/null, /tmp/, /var/tmp/, ~/.claude/) remain allowed.`
      };
    }
  }
  return null;
}
var DECODE_AND_EXEC_RE = /(?:base64\s+(?:--decode\b|-[A-Za-z]*d[A-Za-z]*\b)|xxd\s+-[A-Za-z]*r[A-Za-z]*\b|openssl\s+(?:base64|enc)\b[^|]*?\s-d\b)[^|]*\|\s*(?:sudo\s+|env\s+(?:[A-Z][A-Z0-9_]*=\S*\s+)*)?(?:\/\S+\/)?(?:bash|sh|dash|zsh|ksh|ash)\b/;
function matchesDecodeAndExecute(command) {
  return DECODE_AND_EXEC_RE.test(command);
}
function matchesEvalDeferredString(rawSegment) {
  const trimmed = rawSegment.replace(/^\s+/, "");
  const head = stripLeadingEnvAssignments(trimmed);
  const m = head.match(/^eval\b\s*/);
  if (m === null)
    return false;
  const arg = head.slice(m[0].length);
  if (arg.length === 0)
    return false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0;i < arg.length; i++) {
    const c = arg[i];
    if (!inSingle && c === "\\" && i + 1 < arg.length) {
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle)
      continue;
    if (c === "$") {
      const next = arg[i + 1];
      if (next === "(" || next === "{")
        return true;
      if (next !== undefined && /[A-Za-z_]/.test(next))
        return true;
    }
    if (c === "`")
      return true;
  }
  return false;
}
function hasSafetyFlag(segment, verb) {
  if (verb === "patch") {
    const hasDryRun = /(?:^|\s)(?:--dry-run|--check)(?:\s|$)/.test(segment);
    if (!hasDryRun)
      return false;
    const hasOutput = /(?:^|\s)(?:-o(?:\s|=|\S|$)|--output(?:\s|=|$))/.test(segment);
    return !hasOutput;
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
  return extractCommandVerbInfo(segment)?.verb ?? null;
}
function extractCommandVerbInfo(segment) {
  let s = stripLeadingEnvAssignments(segment);
  let consumed = segment.length - s.length;
  for (let safety = 0;safety < 32; safety++) {
    const beforeStrip = s;
    s = stripLeadingEnvAssignments(s);
    consumed += beforeStrip.length - s.length;
    const m = s.match(/^(\S+)/);
    if (m === null || m[0] === undefined)
      return null;
    const word = m[0];
    const baseStart = word.lastIndexOf("/");
    const base = baseStart >= 0 ? word.slice(baseStart + 1) : word;
    if (WRAPPER_VERBS.has(base)) {
      const valueOpts = WRAPPER_VALUE_OPTS[base];
      const afterWord = s.slice(word.length).replace(/^\s+/, "");
      consumed += s.length - afterWord.length;
      s = afterWord;
      while (true) {
        const optMatch = s.match(/^(-[^\s-]\S*|--[^\s=]+(?:=\S*)?)/);
        if (optMatch === null || optMatch[0] === undefined)
          break;
        const opt = optMatch[0];
        const afterOpt = s.slice(opt.length).replace(/^\s+/, "");
        consumed += s.length - afterOpt.length;
        s = afterOpt;
        if (valueOpts !== undefined && !opt.includes("=") && valueOpts.has(opt)) {
          const valMatch = s.match(/^\S+/);
          if (valMatch !== null && valMatch[0] !== undefined) {
            const afterVal = s.slice(valMatch[0].length).replace(/^\s+/, "");
            consumed += s.length - afterVal.length;
            s = afterVal;
          }
        }
      }
      continue;
    }
    return { verb: base, verbEnd: consumed + word.length };
  }
  return null;
}
var VERB_WINDOW_TAIL_CHARS = 0;
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
function touchesProtectedPathTokenized(rawSegment) {
  for (const tok of tokenizeSegment(rawSegment)) {
    if (tok.length === 0)
      continue;
    if (/\s/.test(tok))
      continue;
    const norm = collapsePathDoublings(tok.replace(/\\/g, ""));
    for (const needle of PROTECTED_PATH_NEEDLES) {
      if (containsAsPathComponent(norm, needle))
        return true;
    }
  }
  return false;
}
var PYTHON_WRITE_RE = /write_text|\.write\(|open\(\s*[^)]*['"]w/;
var NODE_WRITE_RE = /writeFile|writeFileSync/;
var PERL_WRITE_RE = /\bopen\b[^;]*?["']>{1,2}["']|\bsyswrite\b|->\s*spew(?:_raw|_utf8)?\b|IO::File->new\b[^;]*?["']>{1,2}/;
var RUBY_WRITE_RE = /\bFile\.(?:write|open)\b|\bIO\.(?:write|binwrite)\b|\.write\b\s*\(\s*['"]/;
var PHP_WRITE_RE = /\bfile_put_contents\b|\bfwrite\b|\bfputs\b|\bfputcsv\b/;
var INTERP_PATH_PREFIX = "(?:[A-Za-z0-9_./\\-]*/)?";
var INTERP_VERSION_SUFFIX = "\\d*(?:\\.\\d+)*";
var PYTHON_OPTION_SKIP = "(?:-[WX]\\s+[^\\s-]\\S*\\s+|--check-hash-based-pycs\\s+[^\\s-]\\S*\\s+|-[A-Za-z][A-Za-z0-9]*\\s+)*";
var INTERP_OPTION_SKIP = "(?:-[IMr]\\s+[^\\s-]\\S*\\s+|-[A-Za-z0-9][^\\s]*\\s+)*";
var PYTHON_INVOCATION_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "(?:python|pypy)" + INTERP_VERSION_SUFFIX + "\\s+" + PYTHON_OPTION_SKIP + "-c\\b");
var PYTHON_INVOCATION_HEAD_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "(?:python|pypy)" + INTERP_VERSION_SUFFIX + "\\s+" + PYTHON_OPTION_SKIP + "-c\\s+");
var PERL_INVOCATION_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "perl" + INTERP_VERSION_SUFFIX + "\\s+" + INTERP_OPTION_SKIP + "-[A-Za-z]*[eE][A-Za-z]*\\b");
var PERL_INVOCATION_HEAD_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "perl" + INTERP_VERSION_SUFFIX + "\\s+" + INTERP_OPTION_SKIP + "-[A-Za-z]*[eE][A-Za-z]*\\b\\s*");
var PERL_INPLACE_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "perl" + INTERP_VERSION_SUFFIX + "\\s+(?:-[A-Za-z0-9]*\\s+)*-[a-z0-9]*i");
var RUBY_INVOCATION_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "ruby" + INTERP_VERSION_SUFFIX + "\\s+" + INTERP_OPTION_SKIP + "-[A-Za-z]*e[A-Za-z]*\\b");
var RUBY_INVOCATION_HEAD_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "ruby" + INTERP_VERSION_SUFFIX + "\\s+" + INTERP_OPTION_SKIP + "-[A-Za-z]*e[A-Za-z]*\\b\\s*");
var AWK_INVOCATION_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "(?:g|m|n)?awk" + INTERP_VERSION_SUFFIX + "\\b");
var AWK_INVOCATION_HEAD_RE = new RegExp("(?:^|[\\s;&|(])" + INTERP_PATH_PREFIX + "(?:g|m|n)?awk" + INTERP_VERSION_SUFFIX + "\\s+", "g");
var AWK_PRINT_STMT_RE = /\bprintf?\b[^;}\n]*/g;
var AWK_STMT_REDIRECT_RE = /(>>?)\s*\(*\s*(?:["']([^"']+)["']|([A-Za-z_]\w*))/g;
var AWK_QUOTED_LITERAL_RE = /"[^"]*"|'[^']*'/g;
var PHP_INVOCATION_RE = /(?:^|[\s;&|(])php\s+-[A-Za-z]*[rRB][A-Za-z]*\b/;
var PHP_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])php\s+-[A-Za-z]*[rRB][A-Za-z]*\b\s*/;
var NODE_INVOCATION_RE = /(?:^|[\s;&|(])node\s+(?:-e\b|--[e]val\b=?)/;
var NODE_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])node\s+(?:-e\b|--[e]val\b=?)\s*/;
function matchesPythonNodeWrite(normalized, raw) {
  if (PYTHON_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(PYTHON_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null) {
        if (/(?:^|[^A-Za-z0-9_])(?:exec|[e]val|compile)\s*\(/.test(arg)) {
          if (PYTHON_WRITE_RE.test(arg))
            return true;
        }
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
  if (PERL_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(PERL_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && PERL_WRITE_RE.test(arg))
        return true;
      if (arg === null && PERL_WRITE_RE.test(normalized))
        return true;
    } else if (PERL_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  if (PERL_INPLACE_RE.test(normalized))
    return true;
  if (RUBY_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(RUBY_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && RUBY_WRITE_RE.test(arg))
        return true;
      if (arg === null && RUBY_WRITE_RE.test(normalized))
        return true;
    } else if (RUBY_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  if (AWK_INVOCATION_RE.test(normalized)) {
    let awkScanText = null;
    for (const awkHit of raw.matchAll(AWK_INVOCATION_HEAD_RE)) {
      if (typeof awkHit.index !== "number")
        continue;
      let inSingle = false;
      let inDouble = false;
      for (let k = 0;k < awkHit.index; k++) {
        const qc = raw[k];
        if (qc === "\\" && !inSingle) {
          k++;
          continue;
        }
        if (qc === "'" && !inDouble)
          inSingle = !inSingle;
        else if (qc === '"' && !inSingle)
          inDouble = !inDouble;
      }
      if (inSingle || inDouble)
        continue;
      const isWordBreak = (ch) => ch === " " || ch === "\t" || ch === `
` || ch === ";" || ch === "|" || ch === "&" || ch === ">" || ch === "<";
      const skipWord = (k) => {
        while (k < raw.length && !isWordBreak(raw[k]))
          k++;
        while (k < raw.length && (raw[k] === " " || raw[k] === "\t"))
          k++;
        return k;
      };
      let i = awkHit.index + awkHit[0].length;
      while (i < raw.length && raw[i] === "-") {
        const wordStart = i;
        i = skipWord(i);
        const opt = raw.slice(wordStart, i).trimEnd();
        if (opt === "-v" || opt === "-F" || opt === "-f" || opt === "--assign" || opt === "--field-separator" || opt === "--file") {
          i = skipWord(i);
        }
      }
      const program = readShellArg(raw, i);
      awkScanText = program !== null && program.length > 0 ? program : normalized;
      break;
    }
    for (const stmt of (awkScanText ?? "").matchAll(AWK_PRINT_STMT_RE)) {
      for (const m of stmt[0].matchAll(AWK_STMT_REDIRECT_RE)) {
        let target = m[2];
        if (target === undefined) {
          const ident = m[3];
          if (ident === undefined)
            continue;
          const assign = (awkScanText ?? "").match(new RegExp("\\b" + ident + `\\s*=\\s*["']([^"']+)["']`));
          if (assign === null || assign[1] === undefined)
            continue;
          target = assign[1];
        }
        const prefix = stmt[0].slice(0, m.index).replace(AWK_QUOTED_LITERAL_RE, "");
        let depth = 0;
        for (const ch of prefix) {
          if (ch === "(")
            depth += 1;
          else if (ch === ")")
            depth -= 1;
        }
        if (depth > 0)
          continue;
        if (isInRepoWriteTarget(target))
          return true;
      }
    }
  }
  if (PHP_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(PHP_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && PHP_WRITE_RE.test(arg))
        return true;
      if (arg === null && PHP_WRITE_RE.test(normalized))
        return true;
    } else if (PHP_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  if (NODE_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(NODE_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null) {
        if (/(?:^|[^A-Za-z0-9_])(?:[e]val|Function|runInThisContext|runInNewContext)\s*\(/.test(arg)) {
          if (NODE_WRITE_RE.test(arg))
            return true;
        }
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
  let i = start;
  let buf = "";
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === `
` || c === "\r" || c === ";" || c === "|" || c === "&" || c === ">" || c === "<") {
      break;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "\\" && j + 1 < s.length) {
          buf += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === '"')
          break;
        buf += s[j];
        j++;
      }
      if (j >= s.length)
        return null;
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0)
        return null;
      buf += s.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === "$" && s[i + 1] === "'") {
      let j = i + 2;
      while (j < s.length) {
        if (s[j] === "\\" && j + 1 < s.length) {
          buf += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === "'")
          break;
        buf += s[j];
        j++;
      }
      if (j >= s.length)
        return null;
      i = j + 1;
      continue;
    }
    buf += c;
    i++;
  }
  if (i === start)
    return null;
  return buf;
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
  const cwd = typeof event["cwd"] === "string" ? event["cwd"] : undefined;
  const decision = evaluateBashCommand(command, cwd ? { cwd } : {});
  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-bash-write-bypass");
  }
  if (decision.decision === "warn") {
    return replyAllowWithWarning(decision.reason ?? "redirect target outside safe-sink allowlist");
  }
  return replyAllow();
}
main().then((code) => process.exit(code), (err) => {
  console.error(`deny-bash-write-bypass hook crashed: ${err.message}`);
  process.exit(2);
});

//# debugId=57D2C97A3D61563964756E2164756E21

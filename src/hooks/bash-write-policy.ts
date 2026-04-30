// Pure policy function for the deny-bash-write-bypass hook (SPEC §5.2).
//
// This is a *best-effort* substring filter. Determined attackers can
// always bypass it (heredocs in alternative languages, base64-encoded
// commands, indirect invocations through aliases or wrappers, etc.). The
// goal is to make the obvious bypasses higher-friction than reaching for
// an edit_* tool — not to provide a sandbox.
//
// Decision order:
//   1. Writes to .meta-edit/state/** or .meta-edit/tmp/** are denied
//      unconditionally, even if the command otherwise matches an
//      allowlist pattern.
//   2. If the command matches any allowlist pattern (formatter, codegen),
//      it is allowed.
//   3. If the command matches any deny pattern, it is denied.
//   4. Otherwise the command is allowed.
//
// The allowlist exists because formatters and code generators are part of
// normal development workflows. They are conventionally semantic-
// preserving (formatters) or driven by separate input files (codegens),
// so they are unlikely to be a deliberate bypass route.

export type HookDecision = {
  decision: "allow" | "deny";
  reason?: string;
};

export const ALLOWLIST_PATTERNS: readonly string[] = [
  "prettier --write",
  "eslint --fix",
  "gofmt -w",
  "cargo fmt",
  "ruff --fix",
  "ruff format",
  "black ",
  "black\n",
  "prisma generate",
  "openapi-generator",
  "swagger-codegen",
];

export const DENY_SUBSTRINGS: readonly string[] = [
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
  "rsync\t",
];

// Patterns that are "verb path" forms — denied when they look like they
// move/copy/patch files (rather than reading or operating on a single
// argument that is unlikely to be a repo path). Both space and tab
// argument separators are covered: shells accept either, so a malicious
// caller could otherwise sneak `mv\tfoo\tbar` past a space-only matcher.
export const DENY_PREFIX_PATTERNS: readonly string[] = [
  "mv ",
  "mv\t",
  "cp ",
  "cp\t",
  "patch ",
  "patch\t",
];

// Match the protected directory roots regardless of whether the command
// uses a trailing slash. `cat > .meta-edit/state` (no slash, treating
// the path as a literal file or about-to-be-created sibling) must trip
// the same gate as `cat > .meta-edit/state/edits.jsonl`. Acceptable
// over-rejection: legitimate paths that happen to embed `.meta-edit/state`
// as a literal substring inside an argument are vanishingly rare in
// agent-driven shell commands.
const PROTECTED_PATH_NEEDLES: readonly string[] = [
  ".meta-edit/state",
  ".meta-edit/tmp",
];

export function evaluateBashCommand(command: string): HookDecision {
  if (typeof command !== "string" || command.length === 0) {
    return { decision: "allow" };
  }

  // Split on common shell segment boundaries so an allowlist hit in one
  // segment cannot whitewash a deny pattern in another (e.g.,
  // `prettier --write src/ ; sed -i 's/x/y/' src/foo.ts`).
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

function evaluateSegment(rawSegment: string): HookDecision {
  // Best-effort defeat of trivial backslash-escape bypasses such as
  // `s\ed -i ...`. Stripping backslashes can change the *meaning* of
  // commands inside quoted regions, but for substring pattern detection
  // we don't care — we never execute the normalized form.
  // We also collapse `//` -> `/` and `/./` -> `/` so path-equivalent
  // spellings (`.meta-edit//state`, `.meta-edit/./state`) reach the
  // same protected-path needles as the canonical form.
  const normalized = collapsePathDoublings(rawSegment.replace(/\\/g, ""));

  // Protected-path edits are denied unconditionally — even when the
  // surrounding command otherwise matches a documented allowlist entry.
  if (touchesProtectedPath(normalized)) {
    return {
      decision: "deny",
      reason:
        "command touches a protected meta-edit path " +
        "(.meta-edit/state/** or .meta-edit/tmp/**); writes to these " +
        "paths must go through an edit_policy_change tool call.",
    };
  }

  // Deny patterns are checked unconditionally; we deliberately do NOT
  // short-circuit on the allowlist. A construct such as
  //   prettier --write src/ ; sed -i 's/x/y/' src/foo.ts
  //   prettier --write src/ & sed -i ...
  //   prettier --write src/ <(sed -i ...)
  //   bash -c "prettier --write && sed -i ..."
  // must still deny on the embedded `sed -i`, even if a substring of the
  // command matches an allowlist pattern. ALLOWLIST_PATTERNS is retained
  // for documentation only — none of our deny patterns currently match a
  // legitimate formatter or codegen invocation, so the allowlist is a
  // no-op in v0.1. If we tighten deny patterns in the future and they
  // start hitting formatters, the allowlist becomes the explicit override
  // surface; the architecture now reserves room for that without giving
  // deny-bypass on chained commands.
  for (const needle of DENY_SUBSTRINGS) {
    if (normalized.includes(needle)) {
      return {
        decision: "deny",
        reason: denyReason(needle),
      };
    }
  }

  // Verb-based deny: extract the actual command verb after stripping
  // leading env assignments (`FOO=bar mv a b` -> `mv`), peeling wrapper
  // verbs (`sudo mv a b`, `env mv a b`, `xargs mv -t /tmp`,
  // `nice mv a b`, ...) and taking the basename of any absolute-path
  // invocation (`/usr/bin/mv` -> `mv`). The deny set is the basename
  // form of every prefix in DENY_PREFIX_PATTERNS.
  const verb = extractCommandVerb(normalized.trimStart());
  if (verb !== null && DENY_VERBS.has(verb)) {
    return {
      decision: "deny",
      reason: denyReason(verb),
    };
  }
  if (matchesPythonNodeWrite(normalized)) {
    return {
      decision: "deny",
      reason:
        'inline "python -c" / "node -e" with write_text, .write, open(..., \'w\'), or writeFile* is a bash bypass; use an edit_* tool instead.',
    };
  }

  return { decision: "allow" };
}

// Split a command line on shell segment boundaries (; && || | newline)
// while respecting single- and double-quoted regions so we don't shred a
// `python -c "import x; ..."` invocation into nonsense.
//
// This is still best-effort: we don't expand $(...), <(...), or ${...},
// and we don't unescape ANSI-C $'...' strings. A determined attacker can
// hide a deny pattern from us. The goal is to make the obvious chained
// bypasses harder than reaching for an edit_* tool, not to provide a
// sandbox.
function splitSegments(cmd: string): string[] {
  const segments: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    const next = cmd[i + 1];

    if (!inSingle && c === "\\" && i + 1 < cmd.length) {
      // Preserve the backslash + escaped char in the buffer; the per-
      // segment normalizer strips backslashes for substring matching.
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
      if (c === ";" || c === "|" || c === "\n") {
        segments.push(buf);
        buf = "";
        continue;
      }
      if (c === "&") {
        // Bare `&` (background fork) MUST split here so a command like
        // `cargo fmt & mv a b` is broken into two segments and the
        // prefix-only deny verbs (mv/cp/patch) match against `mv`.
        // The `&&` case is handled above and consumes both characters;
        // this arm only sees a single `&`.
        //
        // BUT skip when the `&` is part of a redirection: `&>` (stdout
        // redirect) or `>&` / `2>&1` (fd duplication). For redirections
        // we leave the `&` in the current segment and keep going.
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

function denyReason(pattern: string): string {
  return (
    `command matches deny pattern "${pattern}". meta-edit reserves ` +
    `direct file writes for the seventeen edit_* tools; if a formatter ` +
    `or codegen needs to run, route it through the allowlist (see ` +
    `docs/SPEC.md §5.2).`
  );
}

// Wrapper verbs whose remaining tokens are themselves the command we
// actually care about. After encountering one of these as the first
// non-env token, peel it and continue resolving the verb.
const WRAPPER_VERBS: ReadonlySet<string> = new Set([
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
]);

// Verbs whose mere invocation is denied.
const DENY_VERBS: ReadonlySet<string> = new Set(["mv", "cp", "patch"]);

function collapsePathDoublings(s: string): string {
  let out = s;
  out = out.replace(/\/(\.\/)+/g, "/");
  out = out.replace(/\/{2,}/g, "/");
  return out;
}

function extractCommandVerb(segment: string): string | null {
  let s = stripLeadingEnvAssignments(segment);
  for (let safety = 0; safety < 16; safety++) {
    s = stripLeadingEnvAssignments(s);
    const m = /^(\S+)/.exec(s);
    if (m === null || m[0] === undefined) return null;
    const word = m[0];
    const baseStart = word.lastIndexOf("/");
    const base = baseStart >= 0 ? word.slice(baseStart + 1) : word;
    if (WRAPPER_VERBS.has(base)) {
      s = s.slice(word.length).replace(/^\s+/, "");
      continue;
    }
    return base;
  }
  return null;
}

// Strip a chain of leading `NAME=value` shell variable assignments.
// Examples:
//   "FOO=bar mv a b"          -> "mv a b"
//   "FOO=bar BAZ=qux mv a b"  -> "mv a b"
//   "FOO=$(date) mv a b"      -> "mv a b"  (value extends to next space outside quotes)
// We deliberately accept simple double-/single-quoted values so
// `LANG="en US.UTF-8" mv a b` is also stripped to `mv a b`.
function stripLeadingEnvAssignments(s: string): string {
  let i = 0;
  while (i < s.length) {
    // Skip leading whitespace between assignments.
    while (i < s.length && (s[i] === " " || s[i] === "\t")) {
      i++;
    }
    // Try to consume a NAME=value token. NAME is [A-Za-z_][A-Za-z0-9_]*.
    const nameStart = i;
    if (
      i < s.length &&
      ((s[i]! >= "A" && s[i]! <= "Z") ||
        (s[i]! >= "a" && s[i]! <= "z") ||
        s[i] === "_")
    ) {
      i++;
      while (
        i < s.length &&
        ((s[i]! >= "A" && s[i]! <= "Z") ||
          (s[i]! >= "a" && s[i]! <= "z") ||
          (s[i]! >= "0" && s[i]! <= "9") ||
          s[i] === "_")
      ) {
        i++;
      }
      if (s[i] !== "=") {
        // Not an assignment; rewind and stop stripping.
        return s.slice(nameStart);
      }
      i++; // consume '='
      // Consume the value: until whitespace at top level, respecting
      // single/double quotes.
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
      // Continue the outer loop to try another assignment.
      continue;
    }
    // Current position isn't a name start; we're done stripping.
    return s.slice(i);
  }
  return "";
}

function touchesProtectedPath(command: string): boolean {
  for (const needle of PROTECTED_PATH_NEEDLES) {
    if (command.includes(needle)) {
      return true;
    }
  }
  return false;
}

const PYTHON_WRITE_RE = /write_text|\.write\(|open\(\s*[^)]*['"]w/;
const NODE_WRITE_RE = /writeFile|writeFileSync/;

function matchesPythonNodeWrite(command: string): boolean {
  if (/(?:^|[\s;&|(])python3?\s+-c\b/.test(command)) {
    if (PYTHON_WRITE_RE.test(command)) {
      return true;
    }
  }
  if (/(?:^|[\s;&|(])node\s+-e\b/.test(command)) {
    if (NODE_WRITE_RE.test(command)) {
      return true;
    }
  }
  return false;
}

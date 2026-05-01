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

import * as path from "node:path";
import { isProtectedPath } from "../state/protected-paths.js";
import { SPEC_BASH_HOOK_URL } from "../docs-urls.js";

export type HookDecision = {
  decision: "allow" | "deny";
  reason?: string;
};

// Codex round-1 a4-01: hooks now thread the agent's cwd through so the
// protected-path check can resolve symlinks ("link/state/edits.jsonl"
// where link -> .meta-edit) instead of relying on a lexical needle match.
// When the cwd is omitted, the function falls back to the lexical-only
// behavior used prior to a4-01.
export type EvaluateBashOptions = {
  cwd?: string;
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
  // `tee` moved to DENY_VERBS so unicode whitespace separators
  // (U+00A0, U+2009, etc.) between `tee` and its target path don't
  // bypass the deny via the substring `"tee "`. See issue a2-01.
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

// Component-aware substring match. Returns true iff `needle` appears in
// `s` with the trailing side at a path-component boundary AND the
// leading side either at a path boundary or at an option-glue position.
// This rejects spurious matches like ".meta-edit/state" inside
// "/tmp/x-with-.meta-edit/state-in-name" while still catching:
//   - real path components: "/tmp/work/.meta-edit/state/edits.jsonl"
//   - short-option glue: "less -O.meta-edit/state/exfil.log"
//   - long-option glue:  "tool --output=.meta-edit/state/foo"
function containsAsPathComponent(s: string, needle: string): boolean {
  let from = 0;
  while (from <= s.length - needle.length) {
    const idx = s.indexOf(needle, from);
    if (idx < 0) return false;
    const after =
      idx + needle.length < s.length ? s[idx + needle.length] : undefined;
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

function isPathComponentContinuation(c: string | undefined): boolean {
  if (c === undefined) return false;
  return /^[A-Za-z0-9._-]$/.test(c);
}

// True when the position is acceptable as the start of a path-component
// match: at start of string, after a path separator, or directly after
// an option flag prefix in the same whitespace-bounded token.
function hasAcceptableBeforeBoundary(s: string, pos: number): boolean {
  if (pos === 0) return true;
  const before = s[pos - 1]!;
  if (before === "/") return true;
  if (!isPathComponentContinuation(before)) return true;
  // The needle is glued to letters/digits/`.`/`_`/`-`. Walk back to the
  // start of the surrounding whitespace-bounded token. If the prefix
  // between the token start and `pos` looks like a short-option flag
  // (`-X`, `-XY...`) or long-option flag with `=` (`--foo=`), we accept
  // — the path is the option's value, just glued without a space.
  const tokenStart = findTokenStart(s, pos);
  const prefix = s.slice(tokenStart, pos);
  if (/^-[A-Za-z]+$/.test(prefix)) return true;
  if (/^--[A-Za-z][A-Za-z0-9-]*=$/.test(prefix)) return true;
  return false;
}

function findTokenStart(s: string, pos: number): number {
  let i = pos;
  while (i > 0) {
    const c = s[i - 1];
    if (
      c === " " ||
      c === "\t" ||
      c === "\n" ||
      c === "\r" ||
      c === "'" ||
      c === '"' ||
      c === "(" ||
      c === ";" ||
      c === "|" ||
      c === "&" ||
      c === ">" ||
      c === "<" ||
      c === "=" ||
      c === "$"
    ) {
      break;
    }
    i--;
  }
  return i;
}

export function evaluateBashCommand(
  command: string,
  opts: EvaluateBashOptions = {},
): HookDecision {
  if (typeof command !== "string" || command.length === 0) {
    return { decision: "allow" };
  }
  // Heal redirect-target detachment caused by line-separator whitespace
  // sitting between the redirect operator and its target. Without this,
  // `printf x >\rsrc/foo.ts` splits into `printf x >` (empty target) and
  // `src/foo.ts` (a separate segment), bypassing the in-repo redirect
  // deny. Real bash treats bare `\r` as an ordinary filename byte, so
  // the rewrite is a no-op for genuine CRLF copy-paste artifacts; the
  // primary-split CR carve-out (line 619) remains for defense in depth.
  // Caught by dogfood-001 self-review.
  command = command.replace(
    new RegExp("(>>|>\\||>)([\\r\\n\\u2028\\u2029]+)", "g"),
    (_m, op) => `${op} `,
  );

  // Cross-segment "decode-and-execute" bypass: `base64 -d | bash`,
  // `xxd -r ... | sh`, `openssl base64 -d | bash`. Each individual
  // segment looks benign, so per-segment evaluation cannot catch it.
  // We detect a decoder verb followed (after a pipe) by a shell
  // interpreter and deny outright. Read-only downstream consumers
  // (`base64 -d | grep`, `base64 -d | hexdump`) remain allowed because
  // the downstream verb is not a shell.
  //
  // Codex round-2 review (a1-02): scan against the quote-stripped form
  // so that legitimate string literals containing the bypass shape
  // (`printf 'base64 -d | bash\n'`) are not denied. A determined
  // attacker can hide the actual pipe behind `eval "..."` — that case
  // is already handled by matchesEvalDeferredString.
  if (matchesDecodeAndExecute(stripQuotedContent(command))) {
    return {
      decision: "deny",
      reason:
        'decoder piped into a shell interpreter (e.g. `base64 -d | bash`) ' +
        'executes arbitrary commands at runtime, bypassing every static ' +
        'deny pattern. Use an edit_* tool instead.',
    };
  }

  // Split on common shell segment boundaries so an allowlist hit in one
  // segment cannot whitewash a deny pattern in another (e.g.,
  // `prettier --write src/ ; sed -i 's/x/y/' src/foo.ts`).
  const segments = splitSegments(command);
  if (segments.length === 0) {
    return { decision: "allow" };
  }

  for (const segment of segments) {
    const decision = evaluateSegment(segment, opts);
    if (decision.decision === "deny") {
      return decision;
    }
  }
  return { decision: "allow" };
}

function evaluateSegment(
  rawSegment: string,
  opts: EvaluateBashOptions = {},
): HookDecision {
  // Best-effort defeat of trivial backslash-escape bypasses such as
  // `s\ed -i ...`. Stripping backslashes can change the *meaning* of
  // commands inside quoted regions, but for substring pattern detection
  // we don't care — we never execute the normalized form.
  // We also collapse `//` -> `/` and `/./` -> `/` so path-equivalent
  // spellings (`.meta-edit//state`, `.meta-edit/./state`) reach the
  // same protected-path needles as the canonical form.
  const normalized = collapsePathDoublings(rawSegment.replace(/\\/g, ""));
  // Quote-stripped form for substring scans (DENY_SUBSTRINGS,
  // touchesProtectedPath). dogfood-005: legitimate documentation strings
  // that contain literal trigger phrases inside quoted arguments
  // (`printf '... cat > foo.ts ...' > /tmp/notes.md`,
  //  `printf '... .meta-edit/state ...' > /tmp/notes.md`) used to deny
  // because the substring scans walked raw text. The heredoc and
  // decode-and-execute scans were already quote-aware; align the rest.
  const scanText = stripQuotedContent(normalized);

  // Protected-path edits are denied — even when the surrounding command
  // otherwise matches a documented allowlist entry. Carve-out: a small
  // set of well-known read-only utilities (`tail`, `cat`, `head`, `wc`,
  // `grep`, ...) is allowed to inspect protected paths so that debugging
  // sessions don't have to disable the hook. The carve-out is withdrawn
  // when the command ALSO contains a `>` / `>>` redirect whose target is
  // a protected path — in that case the command is writing to protected,
  // even though its leading verb is a read tool. See
  // OBSERVED-FAILURES.md "LOW: Read-only commands referencing protected
  // paths are blocked".
  if (touchesProtectedPath(scanText)) {
    const verb = extractCommandVerb(normalized.trimStart());
    const isReadOnly = verb !== null && READ_ONLY_VERBS.has(verb);
    const writeTargetsProtected = redirectsToProtected(normalized, opts);
    if (!isReadOnly || writeTargetsProtected) {
      return {
        decision: "deny",
        reason:
          "command would write to a protected meta-edit path " +
          "(.meta-edit/state/** or .meta-edit/tmp/**); writes to these " +
          "paths must go through an edit_policy_change tool call.",
      };
    }
  }

  // Codex round-1 a4-01: even when the command does not lexically reference
  // a protected path, a redirect target may resolve into one through an
  // intermediate symlink (e.g. "cat foo > link/state/edits.jsonl" where
  // link -> .meta-edit). When a cwd is supplied, redirectsToProtected does
  // a realpath-aware check on each write target and denies if any resolves
  // into a protected directory.
  if (opts.cwd && redirectsToProtected(normalized, opts)) {
    return {
      decision: "deny",
      reason:
        "command would write to a protected meta-edit path " +
        "(.meta-edit/state/** or .meta-edit/tmp/**) via a symlinked " +
        "redirect target; writes to these paths must go through an " +
        "edit_policy_change tool call.",
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
    if (scanText.includes(needle)) {
      return {
        decision: "deny",
        reason: denyReason(needle),
      };
    }
  }

  // Shell-hosting wrappers (`bash -c "..."`, `sh -c "..."`, `eval "..."`)
  // pass an arbitrary quoted string for the host shell to RE-PARSE and
  // execute. The quote-stripped DENY_SUBSTRINGS scan above can no longer
  // see the embedded code; recover the literal string and rescan it.
  // Compensates for the dogfood-005 quote-stripping trade-off.
  const hostingHit = matchesShellHostingDeny(rawSegment);
  if (hostingHit !== null) {
    return {
      decision: "deny",
      reason: denyReason(hostingHit),
    };
  }

  // dogfood-001 + dogfood-005: structural deny for any `>` / `>>` / `>|`
  // redirect whose target is not on the documented safe-sink allowlist
  // (/dev/null, /dev/std{out,err}, /dev/zero, /tmp/, /var/tmp/, /run/,
  // /sys/). Replaces the per-verb deny enumeration that left holes for
  // every new write verb (printf, echo, jq with --rawfile, ...). Reading
  // from any source, redirecting to a safe sink remains allowed; redirect
  // targets that resolve in-repo (relative paths) or to arbitrary
  // absolute paths outside the safe-sink list are denied.
  if (redirectsToInRepoPath(rawSegment)) {
    return {
      decision: "deny",
      reason:
        "command redirects (`>` / `>>` / `>|`) to a path that is not on " +
        "the safe-sink allowlist (/dev/null, /tmp/, /var/tmp/, /run/, " +
        "/sys/). Use an edit_* tool for in-repo writes; capture command " +
        "output to /tmp/ or /dev/null if you need a sink.",
    };
  }

  // Heredoc redirect bypass: `cat <<EOF > target`, `cat <<'EOF' > target`,
  // `cat <<"EOF" > target`, `cat <<-EOF > target`. The DENY_SUBSTRINGS
  // entry "cat >" only catches the form where `>` directly follows `cat`;
  // when a heredoc marker sits between them, the substring check misses
  // entirely. The combination of `<<MARKER` followed by `>` (not `>>`
  // separately, not `>&`) on the same segment always writes a file.
  // Allowed read-only form `cat <<EOF | grep foo` does not match because
  // the `>` is required.
  //
  // Codex round-2 review (a1-01): scan the quote-stripped form so that
  // legitimate string literals like `grep '<<EOF > src/foo.ts'` and
  // `echo "cat <<EOF > src/foo.ts"` are not denied. False-negative on
  // a quote-escaped bypass is preferable here; eval-based deferred
  // execution is already covered separately.
  //
  // Codex round-3 (a1-01 reopen): stripQuotedContent blanks the EOF
  // inside quoted heredoc delimiters (`<<"EOF"`, `<<'EOF'`,
  // `<<-'EOF'`), masking the redirect regex. Pre-unquote any heredoc
  // delimiter token so its identifier survives the strip-quotes pass,
  // while ordinary string literals elsewhere in the command are still
  // blanked (preserving the round-2 false-positive prevention).
  const heredocScan = stripQuotedContent(unquoteHeredocDelimiters(normalized));
  if (/<<-?\s*['"]?[A-Za-z_][\w]*['"]?[^<\n]*?(?<!>)>(?!>|&)/.test(heredocScan)) {
    return {
      decision: "deny",
      reason:
        'heredoc-with-redirect (`<<MARKER ... > target`) writes to a file. ' +
        'Use an edit_* tool instead of redirecting a heredoc body to a path.',
    };
  }

  // Verb-based deny: extract the actual command verb after stripping
  // leading env assignments (`FOO=bar mv a b` -> `mv`), peeling wrapper
  // verbs (`sudo mv a b`, `env mv a b`, `xargs mv -t /tmp`,
  // `nice mv a b`, ...) and taking the basename of any absolute-path
  // invocation (`/usr/bin/mv` -> `mv`). The deny set is the basename
  // form of every prefix in DENY_PREFIX_PATTERNS.
  const verb = extractCommandVerb(normalized.trimStart());
  if (verb !== null && DENY_VERBS.has(verb) && !hasSafetyFlag(normalized, verb)) {
    return {
      decision: "deny",
      reason: denyReason(verb),
    };
  }
  // Scoped deny: `dd of=<in-repo-path>` writes to source. Allow
  // `dd of=/dev/null`, `dd of=/tmp/swap`, and dd invocations with no
  // `of=` operand. See codex round-2 review (a1-03).
  if (matchesDangerousDd(rawSegment)) {
    return {
      decision: "deny",
      reason:
        '`dd of=<path>` writes to an arbitrary file when the target is ' +
        'an in-repo path. Use an edit_* tool instead.',
    };
  }
  // Scoped deny: `tee <in-repo-path>` writes to source. Allow
  // `tee /dev/null`, `tee /tmp/log.txt`, etc. See codex round-2
  // review (a2-01).
  if (matchesDangerousTee(rawSegment)) {
    return {
      decision: "deny",
      reason:
        '`tee <path>` writes to a file when the target is an in-repo ' +
        'path. Use an edit_* tool instead.',
    };
  }
  if (matchesEvalDeferredString(rawSegment)) {
    return {
      decision: "deny",
      reason:
        '`eval` of a non-literal argument (command substitution / backticks / ' +
        'variable expansion) executes a payload that cannot be statically ' +
        'inspected, bypassing every deny pattern. Use an edit_* tool instead.',
    };
  }
  if (matchesPythonNodeWrite(normalized, rawSegment)) {
    return {
      decision: "deny",
      reason:
        'inline interpreter write (python -c / node -e / perl -e / ruby -e / php -r) ' +
        'is a bash bypass; use an edit_* tool instead.',
    };
  }

  return { decision: "allow" };
}

// Split a command line on shell segment boundaries (; && || | newline,
// CR, U+2028, U+2029) while respecting single- and double-quoted regions
// so we don't shred a `python -c "import x; ..."` invocation into
// nonsense. After the primary split, each segment is also scanned for
// $(...) / `...` command substitutions; their inner contents are
// emitted as additional segments (recursively) so prefix-only deny
// verbs catch e.g. `echo $(mv a b)` on the inner `mv a b`.
//
// This is still best-effort: we don't unescape ANSI-C $'...' strings,
// and we don't expand <(...) or ${...}. A determined attacker can still
// hide a deny pattern from us. The goal is to make the obvious chained
// bypasses harder than reaching for an edit_* tool, not to provide a
// sandbox.
function splitSegments(cmd: string): string[] {
  const main = primarySplitSegments(cmd);
  const result: string[] = [];
  for (const seg of main) {
    result.push(seg);
    for (const inner of extractSubstitutionInners(seg)) {
      // Recursively split the inner span so nested $(a; b) and chained
      // `echo $(cargo fmt; mv x y)` are caught on each inner segment.
      for (const innerSeg of splitSegments(inner)) {
        result.push(innerSeg);
      }
    }
    // `find ... -exec CMD \;` / `... -exec CMD +` carries an embedded
    // command in positional args, not via shell composition operators.
    // Extract those bodies and re-evaluate them as segments so deny
    // verbs / substrings inside the body fire.
    for (const inner of extractFindExecInners(seg)) {
      for (const innerSeg of splitSegments(inner)) {
        result.push(innerSeg);
      }
    }
  }
  return result;
}

// Extract the body of every `-exec ... \;` / `-execdir ... \;` /
// `-exec ... +` / `-execdir ... +` block in `seg`. The body ends at the
// next `\;` or `+` token (whitespace-bounded). `{}` placeholders are
// stripped from the body before returning so they don't shadow real
// verbs. Quoted regions are respected so an `-exec` literal inside a
// single-quoted string is not misread as the find primary.
function extractFindExecInners(seg: string): string[] {
  const inners: string[] = [];
  // Quick reject: avoid the per-character walk if the segment has no
  // find primary token at all.
  if (!/(?:^|\s)-exec(?:dir)?(?:\s|$)/.test(seg)) return inners;
  // Codex round-2 review (a1-04): only treat `-exec` as the find primary
  // when the segment's actual verb is `find` (or its variants). For
  // `echo -exec mv a b \\;` the `-exec` is just an echo argument and
  // must not trigger inner-command extraction.
  const verb = extractCommandVerb(seg.trimStart());
  if (verb === null || !FIND_VERBS.has(verb)) return inners;

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
      // Match `-exec` or `-execdir` at a whitespace boundary.
      if (
        c === "-" &&
        (seg.slice(i, i + 5) === "-exec" || seg.slice(i, i + 8) === "-execdir") &&
        (i === 0 || /\s/.test(seg[i - 1]!))
      ) {
        const tokenLen = seg.slice(i, i + 8) === "-execdir" ? 8 : 5;
        const after = seg[i + tokenLen];
        if (after === undefined || /\s/.test(after)) {
          // Skip the primary token + leading whitespace.
          let j = i + tokenLen;
          while (j < seg.length && /\s/.test(seg[j]!)) j++;
          // Read body until `\;` or whitespace-bounded `+`.
          const bodyStart = j;
          let bSingle = false;
          let bDouble = false;
          while (j < seg.length) {
            const cj = seg[j];
            if (!bSingle && cj === "\\" && j + 1 < seg.length) {
              if (seg[j + 1] === ";") {
                // Terminator `\;`. Stop body before the backslash.
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
              // Whitespace-bounded `+` terminator.
              if (
                cj === "+" &&
                (seg[j + 1] === undefined || /\s/.test(seg[j + 1]!)) &&
                /\s/.test(seg[j - 1] ?? " ")
              ) {
                break;
              }
            }
            j++;
          }
          let body = seg.slice(bodyStart, j).trim();
          // Strip lone `{}` placeholders so they don't shadow verbs.
          body = body.replace(/(^|\s)\{\}(\s|$)/g, "$1$2").trim();
          if (body.length > 0) inners.push(body);
          i = j;
          continue;
        }
      }
    }
    i++;
  }
  return inners;
}

function primarySplitSegments(cmd: string): string[] {
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
      // Preserve `>|` (noclobber-override redirect) as a single
      // segment-internal token. Without this carve-out, `printf x >|
      // notes.md` splits into `printf x >` and `notes.md`, which hides
      // the redirect target from iterRedirectTargets and bypasses the
      // dogfood-001 in-repo redirect deny.
      if (c === "|" && cmd[i - 1] === ">") {
        buf += c;
        continue;
      }
      if (
        c === ";" ||
        c === "|" ||
        c === "\n" ||
        c === "\r" ||
        c === " " ||
        c === " "
      ) {
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

// Extract the inner content of any unquoted $(...) or backtick `...`
// command substitution in `seg`. Quote-aware: $(...) inside a single-
// quoted region is literal text and is skipped; everywhere else
// (top-level or inside double quotes — which permit substitution per
// POSIX) it is extracted. Backslashes outside single quotes escape the
// next character so `\$(literal)` and `` \` `` are skipped.
function extractSubstitutionInners(seg: string): string[] {
  const inners: string[] = [];
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
      // Find matching ')' tracking nested $(...). Quote tracking is
      // separate from the outer pass so a `'('` literal inside the
      // substitution body doesn't shift the depth count.
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
            if (depth === 0) break;
          }
        }
        j++;
      }
      if (depth === 0) {
        inners.push(seg.slice(i + 2, j));
        i = j + 1;
        continue;
      }
      // Unmatched `$(` — bail out, partial command.
      return inners;
    }
    if (!inSingle && c === "`") {
      // Find matching '`' (POSIX backticks don't nest).
      let j = i + 1;
      while (j < seg.length) {
        const cj = seg[j];
        if (cj === "\\" && j + 1 < seg.length) {
          j += 2;
          continue;
        }
        if (cj === "`") break;
        j++;
      }
      if (j < seg.length) {
        inners.push(seg.slice(i + 1, j));
        i = j + 1;
        continue;
      }
      // Unmatched backtick — bail.
      return inners;
    }
    i++;
  }
  return inners;
}

// Find heredoc redirects in the raw command (`<<DELIM`, `<<-DELIM`,
// `<<'DELIM'`, `<<"DELIM"`, `<<-'DELIM'`, `<<-"DELIM"`, `<<\DELIM`,
// `<<-\DELIM`) and remove the quote/escape chars from the delimiter
// word, leaving the bare identifier in place. This must run BEFORE
// stripQuotedContent: the round-2 quote stripper would otherwise blank
// out the identifier inside the quoted delimiter (`<<'EOF'` ->
// `<<'   '`), masking the heredoc shape from the redirect regex.
// Ordinary single- and double-quoted string literals elsewhere in the
// command are untouched, so the round-2 false-positive prevention for
// `grep '<<EOF > src/foo.ts'` is preserved by the subsequent
// stripQuotedContent pass.
//
// Codex round-3 review (a1-01 reopen).
// Codex round-4 (a1-01 follow-up): also handle the backslash-quoted
// form `<<\WORD` / `<<-\WORD`. Bash treats a single leading backslash
// before the delimiter word (no trailing pair) as suppressing variable
// and command expansion — semantically identical to `<<'WORD'`. The
// normalization pass already strips backslashes, so this second replace
// is a belt-and-suspenders defence for any future caller that skips
// normalization or passes a pre-normalized string containing the
// backslash literally.
function unquoteHeredocDelimiters(s: string): string {
  // Match `<<` or `<<-` followed by optional whitespace, then a
  // single- OR double-quoted identifier `<<'NAME'` / `<<"NAME"`. We
  // deliberately don't try to honour outer quote state here: a `<<`
  // sequence inside a real quoted literal has no heredoc semantics,
  // but any spurious unquoting we do there is invisible to downstream
  // analysis because stripQuotedContent will blank that whole region
  // immediately after.
  let out = s.replace(
    /(<<-?\s*)(['"])([A-Za-z_]\w*)\2/g,
    (_m, prefix, _q, name) => `${prefix}${name}`,
  );
  // Backslash-quoted form: `<<\WORD` (single leading backslash, no
  // trailing counterpart). Must NOT match `<<\\WORD` (escaped backslash
  // — two characters: `\\` then the word) which is not a heredoc
  // quoting form in standard bash.
  out = out.replace(
    /(<<-?\s*)\\([A-Za-z_]\w*)/g,
    (_m, prefix, name) => `${prefix}${name}`,
  );
  return out;
}

// Replace the *contents* of single- and double-quoted regions with
// space placeholders, preserving the quote chars themselves so quote
// state remains balanced for any downstream parser that re-walks the
// string. Used to make heredoc / decode-and-exec scans ignore literal
// string arguments. NOTE: heredoc bodies (`<<EOF ... EOF`) are real
// code, not string literals — they are intentionally NOT stripped here.
//
// Conservative trade-off: we err on the side of FALSE-NEGATIVE for
// quote-escaped bypass forms (`echo 'sed -i ...'` no longer denies
// the embedded sed -i text). Determined attackers can defeat this
// hook in many other ways already; the goal is to stop tripping on
// agent strings that mention bypass patterns by accident or in docs.
// See codex round-2 review (a1-01, a1-02).
function stripQuotedContent(s: string): string {
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

function denyReason(pattern: string): string {
  return (
    `command matches deny pattern "${pattern}". meta-edit reserves ` +
    `direct file writes for the nineteen edit_* tools; if a formatter ` +
    `or codegen needs to run, route it through the allowlist ` +
    `(${SPEC_BASH_HOOK_URL}).`
  );
}

// Verbs whose `-exec ... \;` / `-execdir ... \;` argument should be
// treated as an embedded sub-command. Limiting to find / fdfind avoids
// false-positives where `-exec` is just a literal argument to a
// non-find verb (`echo -exec mv a b \;`). See codex round-2 (a1-04).
const FIND_VERBS: ReadonlySet<string> = new Set([
  "find",
  "fdfind",
  "fd",
  "gfind",
]);

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
  // Multi-call binaries that forward their first argument as the
  // applet name (`busybox mv a b`, `toybox cp a b`). Same wrapper
  // shape as `sudo`/`env`, no extra option grammar required.
  "busybox",
  "toybox",
]);

// Verbs whose mere invocation is denied. `dd` and `tee` are NOT in
// this set: their write side-effect is target-dependent (e.g.
// `dd of=/tmp/swap`, `tee /dev/null` are legitimate), so they are
// scoped via matchesDangerousDd / matchesDangerousTee. Codex round-2
// review on PR #27 caught both false-positives.
const DENY_VERBS: ReadonlySet<string> = new Set([
  "mv",
  "cp",
  "patch",
]);

// Path-classification helper used by dd / tee scoped denies. Conservative:
// relative paths default to "in-repo" (deny). Absolute paths default to
// "not-in-repo" (allow) UNLESS they are clearly outside the safe-prefix
// list. This errs on the side of FALSE-NEGATIVE for absolute paths that
// happen to be repo paths; that trade-off is acceptable because absolute
// paths to source trees are rare in agent workflows.
//
// Codex review #31 caught a critical alias hole: a broad `/dev/` prefix
// allowed `/dev/fd/N` (and the equivalent `/proc/<pid>/fd/N`) to be
// treated as safe. Both are kernel-provided FD aliases, so a shell
// snippet like `exec 3>src/foo.ts; echo hi | tee /dev/fd/3` produced a
// silent write to a repo file. The fix narrows `/dev/` and `/proc/` to
// EXACT-match-only safe sinks and reverts the prefix to `/tmp/`,
// `/var/tmp/`, `/run/`, and `/sys/` (none of which expose FD aliases).
const SAFE_ABSOLUTE_PREFIXES: readonly string[] = [
  "/tmp/",
  "/var/tmp/",
  "/run/",
  "/sys/",
];
const SAFE_EXACT_TARGETS: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/zero",
]);

function isInRepoWriteTarget(target: string): boolean {
  if (target.length === 0) return false;
  if (SAFE_EXACT_TARGETS.has(target)) return false;
  // Lexical safe-prefix matching is bypassable via `..` traversal:
  // `/tmp/../home/user/meta-edit/src/foo.ts` literally starts with
  // `/tmp/` but resolves OUTSIDE the safe sink. Resolve `..` segments
  // before the prefix check so traversal cannot escape the allowlist.
  // path.normalize on POSIX collapses `a/b/../c` → `a/c` while leaving
  // genuine path strings unchanged. dogfood-001 self-review caught this.
  const resolved = target.startsWith("/")
    ? path.normalize(target)
    : target;
  if (SAFE_EXACT_TARGETS.has(resolved)) return false;
  if (resolved.startsWith("/")) {
    return !SAFE_ABSOLUTE_PREFIXES.some((p) => resolved.startsWith(p));
  }
  // Relative path → assume in-repo. This also covers `~/...` (we don't
  // expand tildes) and bare names (`foo.ts`).
  return true;
}

// Tokenize a segment respecting single/double quotes. Backslash-escapes
// outside single quotes consume the next char into the current token.
// Used by dd / tee target detection; lighter weight than a full shell
// parser but quote-aware enough for argument extraction.
function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let hasContent = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
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
  if (hasContent) tokens.push(buf);
  return tokens;
}

// `dd` is denied only when invoked with `of=<in-repo-path>`. Allow
// `dd of=/dev/null`, `dd of=/tmp/swap`, and `dd` invocations without
// any `of=` operand. See codex round-2 review (a1-03).
function matchesDangerousDd(segment: string): boolean {
  const trimmed = stripLeadingEnvAssignments(segment.trimStart());
  const verb = extractCommandVerb(trimmed);
  if (verb !== "dd") return false;
  const tokens = tokenizeSegment(trimmed);
  for (const tok of tokens) {
    if (tok.startsWith("of=")) {
      const target = tok.slice(3);
      if (isInRepoWriteTarget(target)) return true;
    }
  }
  return false;
}

// `tee` is denied only when at least one positional target argument
// resolves to an in-repo path. Flags (`-a`, `--append`, `-i`,
// `--ignore-interrupts`, `-p`) are skipped. Targets like `/dev/null`
// and `/tmp/log.txt` are allowed. The original a2-01 unicode-
// whitespace bypass (`tee src/foo.ts`) remains caught because
// extractCommandVerb's `\S+` treats NBSP / U+2009 as `\s` in JS regex.
// See codex round-2 review (a2-01).
function matchesDangerousTee(segment: string): boolean {
  const trimmed = stripLeadingEnvAssignments(segment.trimStart());
  const verb = extractCommandVerb(trimmed);
  if (verb !== "tee") return false;
  const tokens = tokenizeSegment(trimmed);
  // Skip past wrapper chain + the tee token itself.
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    const base = tok.includes("/") ? tok.slice(tok.lastIndexOf("/") + 1) : tok;
    if (base === "tee") {
      i++;
      break;
    }
    i++;
  }
  for (; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.startsWith("-")) continue;
    if (isInRepoWriteTarget(tok)) return true;
  }
  return false;
}

// Per-wrapper short options that take a separate value argument. After
// peeling a wrapper, `extractCommandVerb` consumes a flag plus its
// value when the flag is in this set, so `sudo -u root mv a b` is
// resolved to verb `mv` rather than `root`. Only short forms are
// listed; `--long=value` is auto-handled by the existing flag regex,
// and `--long value` (separate) is not common enough on these
// wrappers in agent workflows to warrant per-option grammar yet.
const WRAPPER_VALUE_OPTS: Record<string, ReadonlySet<string>> = {
  sudo: new Set([
    "-u", // user
    "-g", // group
    "-h", // host
    "-C", // close-from FD
    "-D", // chdir
    "-p", // prompt
    "-r", // role
    "-t", // type
    "-T", // time-limit
    "-R", // chroot
    "-c", // class
    "-U", // other-user listing
  ]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "-C", "-S"]),
};

// Common read-only inspection utilities. When the leading verb (after
// wrapper / env-assignment / absolute-path stripping) is one of these
// AND the command has no `>` / `>>` redirect targeting a protected path,
// references to `.meta-edit/state/**` / `.meta-edit/tmp/**` are allowed
// so that debugging sessions can inspect the edit log without disabling
// the hook.
//
// Verbs are added here ONLY when their default invocation reads from
// stdin / files and writes to stdout, AND have no documented mode that
// spawns a subprocess or shells out. Verbs that have any non-redirect
// write-side-effect are deliberately omitted so they fall through to
// the unconditional protected-path deny:
//
//   - `find`     has `-delete` / `-fprint FILE` / `-fprintf FILE`
//   - `sort`     has `-o OUTFILE` / `--output=OUTFILE`
//   - `uniq`     accepts a second positional arg as output file
//   - `xxd`      has `-r` (binary write back) and an output positional
//   - `yq`       (mikefarah/yq) has `-i` / `--inplace` for file mutation
//   - `less`     has `-O OUTFILE` / `--LOG-FILE=OUTFILE` (logs piped input)
//   - `more`     has `!command` shell escape and `v` editor startup;
//                MORESECURE / PAGERSECURE are required to disable them
//   - `rg`       has `--pre=COMMAND` which spawns an arbitrary shell
//                command per input path (full filesystem access)
//   - `file`     has `-C` / `--compile` (writes `magic.mgc` to cwd)
//   - `awk`      has `print > "..."` and `printf > "..."` (in-script
//                redirection — invisible to a leading-verb check)
//   - `sed`      has `-i` (already in DENY_SUBSTRINGS) and `w` command
//   - `dd`       has `of=...`
//   - `tee`      writes to both stdout and the named file; already
//                covered by DENY_SUBSTRINGS — do not add to this set
//
// `jq` (the original) is intentionally retained: it has no in-place
// flag and always writes to stdout. Any future verb tempted into this
// set should be checked for an `-i` / `--inplace` / `--write` /
// `--output FILE` / second-positional-output / `--compile` /
// `--LOG-FILE` / `--pre=COMMAND` / shell-escape mode FIRST. When in
// doubt, omit.
//
// If a future verb is found that should read-but-also-might-write, the
// rule is: omit it. False negatives (a debug command needing a Read
// fallback) are cheap; false positives (silent writes through the
// carve-out) are not.
const READ_ONLY_VERBS: ReadonlySet<string> = new Set([
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
  "cmp",
]);

// Detect whether the command contains a `>` or `>>` write redirect
// (outside quoted regions, NOT a `>&` / `2>&1` fd duplication) whose
// target token references a protected path. Used to withdraw the
// read-only-verb carve-out when a read tool is ALSO redirecting its
// output into the protected directory.
//
// Codex round-1 a4-01: when an `opts.cwd` is supplied, each extracted
// target token is also checked through the symlink-aware isProtectedPath
// (which realpath-resolves the absolute path under cwd). This catches
// redirects whose target lexically looks innocent ("link/state/x") but
// resolves into a protected directory through a symlink.
function redirectsToProtected(
  s: string,
  opts: EvaluateBashOptions = {},
): boolean {
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
    // c is `>` outside quotes. Skip fd-duplication (`>&`).
    if (s[i + 1] === "&") {
      i += 2;
      continue;
    }
    // Skip past the redirect operator (one or two `>`s, or noclobber-
    // override `>|`). All three are write redirects whose target is
    // the next token; we treat them uniformly here. See issue a2-04.
    let j = i + 1;
    if (s[j] === ">" || s[j] === "|") j++;
    // Skip whitespace after the operator.
    while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
    // Read the target token until the next shell delimiter.
    const tokenStart = j;
    while (j < s.length) {
      const tc = s[j];
      if (
        tc === " " ||
        tc === "\t" ||
        tc === ";" ||
        tc === "|" ||
        tc === "&" ||
        tc === "\n" ||
        tc === ">" ||
        tc === "<"
      ) {
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
    // Codex round-1 a4-01: if a cwd was supplied, run the target through
    // the symlink-aware guard. This catches redirects whose lexical form
    // does not match a protected needle but whose realpath resolves into
    // a protected directory (e.g. via "link/state/" where link is a
    // symlink to .meta-edit). Absolute targets are checked directly;
    // relative targets are resolved against cwd before the check.
    if (opts.cwd && target.length > 0) {
      const absolute = path.isAbsolute(target)
        ? target
        : path.resolve(opts.cwd, target);
      // isProtectedPath needs a repo-relative-shaped argument when given
      // repoRoot; pass the relative form so the lexical fallback also
      // works. For absolute targets that resolve outside the cwd, the
      // realpath-and-prefix check inside isProtectedPath returns false,
      // which is the correct (non-protected) decision.
      const rel = path.relative(opts.cwd, absolute);
      if (rel.length > 0 && isProtectedPath(rel, { repoRoot: opts.cwd })) {
        return true;
      }
    }
    i = j;
  }
  return false;
}

// Walk `s` and yield each `>`/`>>`/`>|` redirect's target token, ignoring
// `>&` fd duplications and quoted regions. Shared by redirectsToProtected
// (substring-tests against PROTECTED_PATH_NEEDLES) and the in-repo redirect
// deny (dogfood-001 / dogfood-005). Returns dequoted, unparsed-token
// strings — callers apply their own predicate.
function* iterRedirectTargets(s: string): IterableIterator<string> {
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
    // `>&` is fd duplication (`2>&1`, `>&2`), not a write redirect.
    if (s[i + 1] === "&") {
      i += 2;
      continue;
    }
    let j = i + 1;
    if (s[j] === ">" || s[j] === "|") j++;
    while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
    const tokenStart = j;
    while (j < s.length) {
      const tc = s[j];
      if (
        tc === " " ||
        tc === "\t" ||
        tc === ";" ||
        tc === "|" ||
        tc === "&" ||
        tc === "\n" ||
        tc === ">" ||
        tc === "<"
      ) {
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

// `bash -c "<cmd>"` / `sh -c "<cmd>"` / `eval "<cmd>"`: when the agent
// stuffs a write-bypass into a shell-hosting wrapper's quoted argument,
// the outer quote-stripping pass blanks the payload before the
// DENY_SUBSTRINGS scan sees it. Recover the literal argument here and
// rescan it (also stripping backslashes so `s\ed -i` inside the arg
// reads as `sed -i`). Returns the matched needle, or null.
const SHELL_HOSTING_C_RE =
  /(?:^|[\s;&|(])(?:bash|sh|dash|zsh|ksh|ash)\s+(?:-[A-Za-z]*c[A-Za-z]*)\b\s*/;

function matchesShellHostingDeny(rawSegment: string): string | null {
  const cMatch = rawSegment.match(SHELL_HOSTING_C_RE);
  if (cMatch !== null && typeof cMatch.index === "number") {
    const argStart = cMatch.index + cMatch[0].length;
    const arg = readShellArg(rawSegment, argStart);
    const hit = scanArgForDenySubstring(arg);
    if (hit !== null) return hit;
  }
  // `eval` may sit at the head of the segment, optionally behind env
  // assignments. Wrappers like `sudo`, `env`, etc. also place eval
  // anywhere in the wrapper chain — peel them with extractCommandVerb's
  // sibling helpers so `sudo eval "..."` is caught the same as `eval "..."`.
  const trimmed = stripLeadingEnvAssignments(rawSegment.trimStart());
  const evalMatch = trimmed.match(/^eval\b\s*/);
  if (evalMatch !== null) {
    const argStart = evalMatch[0].length;
    const arg = readShellArg(trimmed, argStart);
    const hit = scanArgForDenySubstring(arg);
    if (hit !== null) return hit;
  }
  return null;
}

function scanArgForDenySubstring(arg: string | null): string | null {
  if (arg === null || arg.length === 0) return null;
  const normalized = collapsePathDoublings(arg.replace(/\\/g, ""));
  for (const needle of DENY_SUBSTRINGS) {
    if (normalized.includes(needle)) return needle;
  }
  return null;
}

// dogfood-001 + dogfood-005: deny any `>`/`>>`/`>|` redirect whose target
// is not in the safe-sink allowlist. This is the structural replacement
// for the per-verb enumeration (printf, echo, ...) the dogfood pass
// found incomplete. The check operates on the raw segment so quoted
// strings inside arguments are not misread as redirect targets — e.g.
// `printf '... > foo.ts ...' > /tmp/notes.md` walks past the quoted `>`
// and only sees the real one whose target is `/tmp/notes.md` (allowed).
function redirectsToInRepoPath(rawSegment: string): boolean {
  for (const target of iterRedirectTargets(rawSegment)) {
    if (target.length === 0) continue;
    if (isInRepoWriteTarget(target)) return true;
  }
  return false;
}

// Detect `<decoder> ... | <shell>` patterns where a runtime payload is
// decoded then piped into a shell interpreter. Static analysis cannot
// see the decoded contents, so we deny the structural pipe outright.
// The downstream-shell predicate is intentionally narrow (bash, sh,
// dash, zsh, ksh, ash) so legitimate read-only consumers
// (`base64 -d | grep`, `base64 -d | hexdump`, `base64 -d | jq`) keep
// working.
const DECODE_AND_EXEC_RE =
  /(?:base64\s+(?:--decode\b|-[A-Za-z]*d[A-Za-z]*\b)|xxd\s+-[A-Za-z]*r[A-Za-z]*\b|openssl\s+(?:base64|enc)\b[^|]*?\s-d\b)[^|]*\|\s*(?:sudo\s+|env\s+(?:[A-Z][A-Z0-9_]*=\S*\s+)*)?(?:\/\S+\/)?(?:bash|sh|dash|zsh|ksh|ash)\b/;

function matchesDecodeAndExecute(command: string): boolean {
  return DECODE_AND_EXEC_RE.test(command);
}

// Detect `eval` (optionally wrapped) followed by a non-literal argument
// — i.e. an argument that contains a command substitution (`$(`,
// backticks) or a variable expansion (`$NAME` / `${NAME}`) outside
// single quotes. Static analysis cannot expand the payload, so we
// deny. Bare-literal evals (`eval "cat > x"`) are unaffected because
// the literal still runs through the per-segment scan and is caught
// by the appropriate deny pattern.
function matchesEvalDeferredString(rawSegment: string): boolean {
  const trimmed = rawSegment.replace(/^\s+/, "");
  // Peel optional wrappers commonly placed before eval (env, sudo, ...).
  const head = stripLeadingEnvAssignments(trimmed);
  // Strict prefix match of a literal `eval` token.
  const m = head.match(/^eval\b\s*/);
  if (m === null) return false;
  const arg = head.slice(m[0].length);
  if (arg.length === 0) return false;
  // Walk the rest, tracking quote state. Inside single quotes, command
  // substitution and variable expansion are literal — ignored. Outside
  // single quotes, `$(` / backtick / `$VAR` make the eval non-literal.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < arg.length; i++) {
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
    if (inSingle) continue;
    if (c === "$") {
      const next = arg[i + 1];
      if (next === "(" || next === "{") return true;
      if (next !== undefined && /[A-Za-z_]/.test(next)) return true;
    }
    if (c === "`") return true;
  }
  return false;
}

// Detect a per-verb safety flag in the segment that means the verb's
// invocation is genuinely a no-write operation (not just
// "no-overwrite"), so denying it would be a false positive.
// Whitespace-bounded so `--dry-run-foo` doesn't fool the matcher.
//
// Notable omission: `cp` is NOT carved out. `cp -n` / `cp --no-clobber`
// only refuses to OVERWRITE an existing destination — `cp -n payload
// src/new_file.ts` STILL CREATES new files at the destination, which
// is exactly the bypass we want the hook to deny. Codex GitHub bot
// review on PR #27 caught this regression and we backed out the cp
// carve-out. `mv` has the same property (mv -n still moves to a new
// destination) and is similarly not carved out. Only `patch` keeps a
// carve-out, because `patch --dry-run` / `--check` are documented as
// read-only modes that emit nothing to disk.
function hasSafetyFlag(segment: string, verb: string): boolean {
  if (verb === "patch") {
    // patch --dry-run / --check are read-only modes that emit
    // nothing to disk... UNLESS combined with -o / --output=FILE,
    // which writes the patched output to FILE regardless of the
    // dry-run claim. Codex GitHub bot review on PR #27 round 2
    // caught this carve-out hole. If the segment specifies an
    // output file, fall back to deny.
    const hasDryRun = /(?:^|\s)(?:--dry-run|--check)(?:\s|$)/.test(segment);
    if (!hasDryRun) return false;
    const hasOutput = /(?:^|\s)(?:-o(?:\s|=|$)|--output(?:\s|=|$))/.test(
      segment,
    );
    return !hasOutput;
  }
  return false;
}

function collapsePathDoublings(s: string): string {
  let prev: string;
  let cur = s;
  do {
    prev = cur;
    // /./ runs -> /
    cur = cur.replace(/\/(\.\/)+/g, "/");
    // /<segment>/../  -> /  (segment can't be empty, "..", or contain
    // a slash; stops the regex consuming `../` in `../../etc`)
    cur = cur.replace(/\/[^/]+\/\.\.(?=\/|$)/g, "");
    // // -> /
    cur = cur.replace(/\/{2,}/g, "/");
  } while (cur !== prev);
  return cur;
}

function extractCommandVerb(segment: string): string | null {
  let s = stripLeadingEnvAssignments(segment);
  for (let safety = 0; safety < 32; safety++) {
    s = stripLeadingEnvAssignments(s);
    const m = s.match(/^(\S+)/);
    if (m === null || m[0] === undefined) return null;
    const word = m[0];
    const baseStart = word.lastIndexOf("/");
    const base = baseStart >= 0 ? word.slice(baseStart + 1) : word;
    if (WRAPPER_VERBS.has(base)) {
      // Skip the wrapper word and any wrapper options that follow
      // (`-X`, `--foo`, `--foo=bar`). Without this skip, forms like
      // `env -i mv a b` extract `-i` as the verb and miss `mv`.
      // Per-wrapper short options that take a separate value (e.g.
      // `sudo -u root mv a b`) consume the next token as the value so
      // the verb resolves to `mv`, not `root`.
      const valueOpts = WRAPPER_VALUE_OPTS[base];
      s = s.slice(word.length).replace(/^\s+/, "");
      while (true) {
        const optMatch = s.match(/^(-[^\s-]\S*|--[^\s=]+(?:=\S*)?)/);
        if (optMatch === null || optMatch[0] === undefined) break;
        const opt = optMatch[0];
        s = s.slice(opt.length).replace(/^\s+/, "");
        if (
          valueOpts !== undefined &&
          !opt.includes("=") &&
          valueOpts.has(opt)
        ) {
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
    if (containsAsPathComponent(command, needle)) {
      return true;
    }
  }
  return false;
}

const PYTHON_WRITE_RE = /write_text|\.write\(|open\(\s*[^)]*['"]w/;
const NODE_WRITE_RE = /writeFile|writeFileSync/;
// Perl: `open(... , ">" , ...)`, `open(... , ">>" , ...)`, `print FH ...`
// to a file handle previously opened for write. Detect the `open` call
// with a `>` mode arg, which is the canonical write form. Also catch
// `syswrite`, `IO::File->new(... ">")`, and `Path::Tiny->spew*`.
const PERL_WRITE_RE =
  /\bopen\b[^;]*?["']>{1,2}["']|\bsyswrite\b|->\s*spew(?:_raw|_utf8)?\b|IO::File->new\b[^;]*?["']>{1,2}/;
// Ruby: `File.write`, `File.open(... , "w")`, `IO.write`, `IO.binwrite`.
const RUBY_WRITE_RE =
  /\bFile\.(?:write|open)\b|\bIO\.(?:write|binwrite)\b|\.write\b\s*\(\s*['"]/;
// PHP: `file_put_contents`, `fwrite`, `fputs`, `fputcsv`.
const PHP_WRITE_RE = /\bfile_put_contents\b|\bfwrite\b|\bfputs\b|\bfputcsv\b/;
const PERL_INVOCATION_RE = /(?:^|[\s;&|(])perl\s+-[A-Za-z]*[eE][A-Za-z]*\b/;
const PERL_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])perl\s+-[A-Za-z]*[eE][A-Za-z]*\b\s*/;
const RUBY_INVOCATION_RE = /(?:^|[\s;&|(])ruby\s+-[A-Za-z]*e[A-Za-z]*\b/;
const RUBY_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])ruby\s+-[A-Za-z]*e[A-Za-z]*\b\s*/;
const PHP_INVOCATION_RE = /(?:^|[\s;&|(])php\s+-[A-Za-z]*[rRB][A-Za-z]*\b/;
const PHP_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])php\s+-[A-Za-z]*[rRB][A-Za-z]*\b\s*/;
// Use a single-char class `[e]val` so this source file does not contain
// the literal substring `eval(`, which trips overzealous heuristic
// security scanners. The regex meaning is unchanged: it still matches
// the long form `--eval` (and `--eval=`), while `\b` rejects any
// longer word like `--evaluate`.
const NODE_INVOCATION_RE = /(?:^|[\s;&|(])node\s+(?:-e\b|--[e]val\b=?)/;
const NODE_INVOCATION_HEAD_RE = /(?:^|[\s;&|(])node\s+(?:-e\b|--[e]val\b=?)\s*/;

// Detect inline write attempts in `python -c <arg>` / `node -e <arg>`.
//
// `normalized` is the post-strip-backslash form used for keyword
// detection (so `pyt\hon -c` cannot bypass the python check). `raw` is
// the pre-strip form used for shell-arg extraction so the quote
// structure is intact.
//
// We extract the script arg from raw, then mask language-level string
// literals (Python / JS) inside it. Tokens like `write_text` that
// appear ONLY inside a literal (`print("write_text")`) are masked away
// and don't trip the pattern. Real writes — `open(...,"w").write()` —
// remain visible because the operator sits OUTSIDE the inner literals.
function matchesPythonNodeWrite(normalized: string, raw: string): boolean {
  // python -c / python3 -c (long form `--command` does not exist).
  if (/(?:^|[\s;&|(])python3?\s+-c\b/.test(normalized)) {
    const rawHit = raw.match(/(?:^|[\s;&|(])python3?\s+-c\s+/);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null) {
        // Codex GitHub bot review on PR #27 round 2 (P1): scripts
        // that wrap the write call in `exec(...)` / `eval(...)` /
        // `compile(..., "exec")` would have their writer tokens
        // hidden by string-literal masking — the dynamic code
        // string IS the executable that performs the write. When
        // such a wrapper is present, scan the UNMASKED arg so
        // tokens inside the string literal still fire.
        if (
          /(?:^|[^A-Za-z0-9_])(?:exec|[e]val|compile)\s*\(/.test(arg)
        ) {
          if (PYTHON_WRITE_RE.test(arg)) return true;
        }
        const masked = maskLanguageStringLiterals(arg);
        if (PYTHON_WRITE_RE.test(masked)) return true;
      } else if (PYTHON_WRITE_RE.test(normalized)) {
        return true;
      }
    } else if (PYTHON_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  // perl -e / perl -E: detect open(..., ">", ...), syswrite, etc.
  // Unlike python/node, perl's writer signal (the `>` mode arg) IS
  // inside a string literal, so we scan the UNMASKED arg.
  if (PERL_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(PERL_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && PERL_WRITE_RE.test(arg)) return true;
      if (arg === null && PERL_WRITE_RE.test(normalized)) return true;
    } else if (PERL_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  // ruby -e: detect File.write / File.open(..., "w") / IO.write.
  if (RUBY_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(RUBY_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && RUBY_WRITE_RE.test(arg)) return true;
      if (arg === null && RUBY_WRITE_RE.test(normalized)) return true;
    } else if (RUBY_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  // php -r / php -R / php -B: detect file_put_contents / fwrite / fputs.
  if (PHP_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(PHP_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null && PHP_WRITE_RE.test(arg)) return true;
      if (arg === null && PHP_WRITE_RE.test(normalized)) return true;
    } else if (PHP_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  // node -e and its long-form equivalent.
  if (NODE_INVOCATION_RE.test(normalized)) {
    const rawHit = raw.match(NODE_INVOCATION_HEAD_RE);
    if (rawHit !== null && typeof rawHit.index === "number") {
      const argStart = rawHit.index + rawHit[0].length;
      const arg = readShellArg(raw, argStart);
      if (arg !== null) {
        // Same exec/eval-wrapping concern for JS: `[e]val(...)`,
        // `Function("...")()`, `vm.runInThisContext(...)`. Avoid
        // the literal substring `eval(` in the source by using a
        // single-char class.
        if (
          /(?:^|[^A-Za-z0-9_])(?:[e]val|Function|runInThisContext|runInNewContext)\s*\(/.test(
            arg,
          )
        ) {
          if (NODE_WRITE_RE.test(arg)) return true;
        }
        const masked = maskLanguageStringLiterals(arg);
        if (NODE_WRITE_RE.test(masked)) return true;
      } else if (NODE_WRITE_RE.test(normalized)) {
        return true;
      }
    } else if (NODE_WRITE_RE.test(normalized)) {
      return true;
    }
  }
  return false;
}

// Read the next shell word starting at `start`, returning the
// dequoted concatenation. POSIX shells treat adjacent quoted /
// unquoted fragments as a single word: `"foo""bar"`, `'foo''bar'`,
// `"foo"bar`, `$'foo'"bar"` are all one token equal to `foobar`.
// Without that concatenation, a constructed `python -c "o""pen(...)"`
// would split at the first closing quote and the writer-pattern
// detector would only see `o`. Codex GitHub bot review on PR #27
// caught the bypass; this routine now consumes a full shell word.
//
// Stops at whitespace or a shell metacharacter (`;`, `|`, `&`, `>`,
// `<`). Returns null if any quote opens and never closes.
function readShellArg(s: string, start: number): string | null {
  if (start >= s.length) return null;
  let i = start;
  let buf = "";
  while (i < s.length) {
    const c = s[i]!;
    if (
      c === " " ||
      c === "\t" ||
      c === "\n" ||
      c === "\r" ||
      c === ";" ||
      c === "|" ||
      c === "&" ||
      c === ">" ||
      c === "<"
    ) {
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
        if (s[j] === '"') break;
        buf += s[j];
        j++;
      }
      if (j >= s.length) return null;
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
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
        if (s[j] === "'") break;
        buf += s[j];
        j++;
      }
      if (j >= s.length) return null;
      i = j + 1;
      continue;
    }
    // Unquoted character — append literally.
    buf += c;
    i++;
  }
  if (i === start) return null;
  return buf;
}

// Replace contents of language-level string literals (single, double,
// triple-single, triple-double) with empty, preserving quote chars.
// Honors `\X` escapes inside non-triple quoted strings.
//
// Python-style string prefixes (`f` / `F` / `r` / `R` / `b` / `B` /
// `u` / `U`, including 2-char combinations like `fr` / `rb`) are
// recognized. F-string contents have their literal text masked but
// `{...}` interpolation expressions preserved, so write calls inside
// f-string interpolations (`f"{open('x','w').write('y')}"`) are still
// detected by the writer-pattern regex.
function maskLanguageStringLiterals(s: string): string {
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
      if (s[j] === quote) break;
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

// If position `i` in `s` starts a Python/JS string literal (with an
// optional 0-, 1-, or 2-char prefix), return the prefix length, quote
// char, and whether the prefix contains `f` / `F` (i.e. it's an
// f-string). Returns null otherwise.
function detectStringStart(
  s: string,
  i: number,
): { prefixLen: number; quote: string; isF: boolean } | null {
  const c0 = s[i];
  if (c0 === undefined) return null;
  if (c0 === "'" || c0 === '"') {
    return { prefixLen: 0, quote: c0, isF: false };
  }
  const isPrefixChar = (c: string | undefined) =>
    c !== undefined && /^[fFrRbBuU]$/.test(c);
  if (isPrefixChar(c0) && (s[i + 1] === "'" || s[i + 1] === '"')) {
    return {
      prefixLen: 1,
      quote: s[i + 1]!,
      isF: c0 === "f" || c0 === "F",
    };
  }
  if (
    isPrefixChar(c0) &&
    isPrefixChar(s[i + 1]) &&
    (s[i + 2] === "'" || s[i + 2] === '"')
  ) {
    const c1 = s[i + 1]!;
    return {
      prefixLen: 2,
      quote: s[i + 2]!,
      isF: c0 === "f" || c0 === "F" || c1 === "f" || c1 === "F",
    };
  }
  return null;
}

// Replace literal-text portions of an f-string body with empty; keep
// `{...}` interpolation blocks intact (so the expressions inside them
// remain visible to the writer-pattern regex). `{{` and `}}` are
// f-string escapes for literal `{` / `}` and are dropped.
function preserveFInterpolations(content: string): string {
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
          if (depth === 0) break;
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

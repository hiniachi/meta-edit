// Token-aware policy for the deny-raw-edit hook (Case C / v0.2).
//
// In v0.1.x this module denied native Edit / Write / MultiEdit /
// NotebookEdit outright — meta-edit's bet was that the AI must reach
// for a kind-specific edit_* MCP tool only. Case C inverts the routing:
// the typed_edit MCP server ISSUES grants but does NOT write, and
// native Edit / Write performs the write under hook validation
// (Article 5 / SPEC §5.1).
//
// This file owns two surfaces:
//
//   1. `evaluateRawEdit(toolName)` — the v0.1.x classification helper.
//      Returns `deny` for the four raw edit names, `allow` otherwise.
//      Kept for the CLI hooks-cmd matcher tests AND used by
//      `evaluateTokenedEdit` as the first gate.
//
//   2. `evaluateTokenedEdit({...})` — the token-aware flow per SPEC §5.1.
//      Looks up the `_meta_edit_token`, finds the matching binding,
//      verifies the disk pre-condition (current sha256 vs binding
//      before_sha256), and consumes the binding. Appends a `consumed`
//      record to the edit log on success.
//
// v0.2.1 thinning: simulate() and the after_sha256 post-condition check
// have been removed. Under Article 3 (non-adversarial threat model), the
// post-condition check protected against an honest-miss where the agent's
// proposed write differed from declaration — at the cost of (a)
// client-supplied after_sha256 friction at issue time, (b) maintaining a
// per-tool replay engine here, and (c) a NotebookEdit "UNSUPPORTED"
// branch. The cost outweighed the benefit. NotebookEdit is now denied at
// the policy level (out of v0.2 scope), and the staleness check on
// before_sha256 remains the single load-bearing pre-condition.
//
// Threat model (Article 3): non-adversarial. We do NOT HMAC-sign tokens,
// we do NOT defend against deep TOCTOU between approval and write, we do
// NOT cross-process lock. Honest mistakes only. The pre-condition sha256
// check is staleness detection — Article 5 explicitly accepts the
// residual race.

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { SPEC_TOOLS_URL } from "../docs-urls.js";
import type { HookDecision } from "./hook-runtime.js";
import type { Grant, GrantsStore } from "../state/grants.js";
import type { ConsumedEntry, EditLog } from "../state/edit-log.js";
import { isoTimestamp } from "../state/edit-log.js";
import { realpathOfDeepestExisting } from "../utils/realpath.js";
import { normalizeRepoRelative } from "../state/protected-paths.js";

export type { HookDecision };

export const RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  // NotebookEdit edits Jupyter (.ipynb) cells, which carry executable
  // code (Python, shell `!cmd`, JS). Without this entry an agent could
  // rewrite notebook cells and bypass the typed surface entirely. Per
  // v0.2.1 the hook denies NotebookEdit at the policy level (out of v0.2
  // scope) before token lookup, so a misdirected token does not get
  // partially consumed.
  "NotebookEdit",
]);

// Lower-cased copy used for case-insensitive classification so the deny
// gate is robust against host shims that deliver tool names in alternate
// casing (e.g. "edit", "WRITE", "multiedit"). The exported PascalCase
// set stays canonical for documentation / API stability.
const LOWER_RAW_EDIT_TOOLS: ReadonlySet<string> = new Set(
  [...RAW_EDIT_TOOLS].map((t) => t.toLowerCase()),
);

/**
 * Classify a tool name as one of the four raw edit primitives. Returns
 * `deny` for raw edits, `allow` otherwise. Used as the first gate by
 * `evaluateTokenedEdit` and as the matcher-sync source by hooks-cmd.
 *
 * The deny `reason` here is a fallback message ONLY: when an agent
 * reaches the token-aware flow, evaluateTokenedEdit replaces this with
 * a more specific reason (untyped, expired, binding mismatch, ...).
 */
export function evaluateRawEdit(toolName: string): HookDecision {
  if (LOWER_RAW_EDIT_TOOLS.has(toolName.toLowerCase())) {
    return {
      decision: "deny",
      reason:
        `meta-edit forbids the raw "${toolName}" tool. ` +
        `Choose one of the nineteen edit_* tools that match the kind of ` +
        `change you are making (full list: ${SPEC_TOOLS_URL}). If no ` +
        `edit_* tool fits, stop and ask the user before bypassing the ` +
        `typed surface.`,
    };
  }
  return { decision: "allow" };
}

// ---------------------------------------------------------------------
// Token-aware flow (SPEC §5.1)
// ---------------------------------------------------------------------

/** Tool input payload shape (subset). All fields optional / unknown-shaped. */
export type RawToolInput = {
  file_path?: unknown;
  old_string?: unknown;
  new_string?: unknown;
  content?: unknown;
  edits?: unknown;
  _meta_edit_token?: unknown;
};

export type TokenedEvalArgs = {
  toolName: string;
  toolInput: RawToolInput;
  repoRoot: string;
  grants: GrantsStore;
  log: EditLog;
  /** Injectable clock for tests. */
  now?: () => Date;
};

/**
 * Run the SPEC §5.1 token-aware flow on a native Edit / Write /
 * MultiEdit / NotebookEdit call.
 *
 * Decision policy (v0.2.1):
 *   - allow: the call carries a valid token, the binding matches, and
 *     before_sha256 matches disk. The binding is consumed and a `consumed`
 *     record is appended to the edit log.
 *   - deny: any of the above checks fail; OR the toolName is not one of
 *     the four raw edit primitives (the latter should never happen when
 *     wired through the matcher, but is fail-closed); OR the toolName is
 *     NotebookEdit (out of v0.2 scope).
 */
export async function evaluateTokenedEdit(args: TokenedEvalArgs): Promise<HookDecision> {
  const { toolName, toolInput, repoRoot, grants, log } = args;
  const nowFn = args.now ?? (() => new Date());

  // 0. The matcher should already have filtered to the four raw edits;
  // re-check defensively. evaluateRawEdit returns `allow` for unknown
  // names — promote that to a deny so a misconfigured matcher fails
  // closed rather than waving the call through. (We never want this
  // function to return `allow` for a non-raw-edit name.)
  if (!LOWER_RAW_EDIT_TOOLS.has(toolName.toLowerCase())) {
    return {
      decision: "deny",
      reason: `deny-raw-edit invoked for non-raw tool "${toolName}"; check hook matcher`,
    };
  }

  // 1. NotebookEdit is out of v0.2 scope. Refuse before token lookup so
  // a misdirected token does not get partially consumed.
  if (toolName.toLowerCase() === "notebookedit") {
    return {
      decision: "deny",
      reason:
        `meta-edit does not support "NotebookEdit" through the token-aware flow ` +
        `(NotebookEdit is out of v0.2 scope). Edit the notebook's source cells ` +
        `via an edit_* tool that targets a regular file, or stop and ask the user.`,
    };
  }

  // 2. Token presence.
  const tokenId = typeof toolInput._meta_edit_token === "string"
    ? toolInput._meta_edit_token
    : "";
  if (tokenId.length === 0) {
    return {
      decision: "deny",
      reason:
        `meta-edit denies "${toolName}" without a "_meta_edit_token" parameter. ` +
        `First call a typed_edit MCP tool (one of the nineteen edit_*; full list: ${SPEC_TOOLS_URL}) ` +
        `to declare the change and obtain a single-use token, then pass that token's id ` +
        `as the "_meta_edit_token" field of "${toolName}".`,
    };
  }

  // 3. Lookup. Expired tokens read as null (grants.lookup TTL filter).
  const grant = await grants.lookup(tokenId);
  if (grant === null) {
    return {
      decision: "deny",
      reason:
        `meta-edit token "${tokenId}" is expired or unknown. ` +
        `Single-use tokens have a short TTL (~5 minutes); re-issue via a fresh typed_edit call.`,
    };
  }

  // 4. Canonicalize the file_path. We must reach the same form as
  // binding[].file (post-realpath, repo-relative, normalized) — the
  // issuer populates that via tools/common.ts checkPathSafety. Failing
  // canonicalization is a deny: a path that escapes the repo or vanishes
  // under realpath cannot match any honest binding.
  const filePathRaw = typeof toolInput.file_path === "string"
    ? toolInput.file_path
    : "";
  if (filePathRaw.length === 0) {
    return {
      decision: "deny",
      reason: `${toolName} call missing "file_path"; the token-aware hook requires a file path to match the binding.`,
    };
  }
  const canonical = canonicalizeForBinding(filePathRaw, repoRoot);
  if (canonical === null) {
    return {
      decision: "deny",
      reason: `meta-edit could not canonicalize "${filePathRaw}" to a repository-relative path; failing closed.`,
    };
  }

  // 5. Find the binding for this canonical path within the token.
  const bound = findBinding(grant, canonical);
  if (bound === null) {
    return {
      decision: "deny",
      reason:
        `${toolName} targets "${canonical}" but token "${tokenId}" does not bind that file. ` +
        `Re-issue a typed_edit declaration for this file, or use the token whose binding lists it.`,
    };
  }
  if (grant.consumed_files.includes(canonical)) {
    return {
      decision: "deny",
      reason:
        `${toolName}'s binding for "${canonical}" has already been consumed by an earlier write. ` +
        `Re-issue a typed_edit declaration to obtain a fresh token.`,
    };
  }

  // 6. Pre-condition: declared starting state matches disk.
  // ENOENT is the create-file path (treated as ""); any other read
  // failure (EACCES, EISDIR, ELOOP, …) is a fail-closed deny — we
  // cannot confirm the precondition without the bytes. (Codex v0.2.0
  // medium #1, retained verbatim.)
  const diskRead = await readFileForBinding(repoRoot, canonical);
  if (!diskRead.ok) {
    return {
      decision: "deny",
      reason:
        `meta-edit could not read "${canonical}" to verify the typed_edit precondition (${diskRead.error}); ` +
        `failing closed — re-read the file and re-issue a typed_edit declaration.`,
    };
  }
  const diskContent = diskRead.content;
  const diskSha = sha256Hex(diskContent);
  if (diskSha !== bound.before_sha256) {
    return {
      decision: "deny",
      reason:
        `disk content of "${canonical}" has drifted from the typed_edit declaration ` +
        `(declared before_sha256=${shortHash(bound.before_sha256)}, actual ${shortHash(diskSha)}). ` +
        `Re-read the file and issue a fresh typed_edit declaration.`,
    };
  }

  // 7. Pre-condition met. Consume the binding via grants.consume.
  // grants.consume serialises read/modify/write through a per-token
  // IN-PROCESS mutex (state/grants.ts withSharedLock). The deny-raw-edit
  // hook is, however, a single-shot Node process per Claude Code hook
  // invocation, so two concurrent hook processes against the same token
  // share NO mutex. Cross-process locking is out of scope per Article 7;
  // this is the residual race accepted under Article 3 (non-adversarial
  // threat model). The honest-mistake outcome is that the second
  // consume() returns "binding already consumed" or "token not found" and
  // the second native write is denied — partial workflow, not corruption.
  const consumeRes = await grants.consume(tokenId, canonical);
  if (!consumeRes.consumed) {
    return {
      decision: "deny",
      reason:
        `meta-edit could not consume token "${tokenId}" for "${canonical}": ${consumeRes.error ?? "unknown error"}.`,
    };
  }

  // Consumed-log append failure is non-fatal to the allow decision: the
  // binding is already consumed (single-use property holds), and the
  // grant file mutation is the source of truth for whether the write is
  // authorized. We surface the audit gap to stderr but do not deny — the
  // friendly-AI threat model means audit completeness is git's job.
  // (SPEC §6: "consumed" records are reconciled by edit_id, gaps are
  // observable.)
  const consumed: ConsumedEntry = {
    edit_id: grant.edit_id,
    ts: isoTimestamp(nowFn()),
    phase: "consumed",
    consuming_tool: toolName,
  };
  try {
    log.appendConsumed(consumed);
  } catch (e) {
    process.stderr.write(
      `[meta-edit] WARN: failed to append consumed record for ${grant.edit_id}: ${(e as Error).message}\n`,
    );
  }

  return { decision: "allow" };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function findBinding(grant: Grant, canonical: string) {
  for (const b of grant.binding) {
    if (b.file === canonical) return b;
  }
  return null;
}

/**
 * Canonicalize an incoming `file_path` to the same form the issuer writes
 * into binding[].file: post-realpath, repository-relative, normalized.
 *
 * Returns null on:
 *   - empty / non-string input,
 *   - path that lexically escapes the repo,
 *   - realpath that resolves outside the repo,
 *   - realpath failure (EACCES / ELOOP / etc. propagated as null).
 *
 * NOTE: parity with `tools/common.ts checkPathSafety()` is load-bearing
 * — both the issue path and the consume path (this file) MUST agree on
 * the canonical form, or grants.consume() silently fails with "file_path
 * not bound by this token". The consume-side rules are intentionally a
 * SUBSET of issue-side: we accept absolute paths (Claude Code passes
 * file_path as absolute), we do NOT re-check protected prefixes here
 * (the issuer already rejected protected targets before binding), and
 * we do not require the file to exist (it may be the create-file path).
 */
export function canonicalizeForBinding(
  inputPath: string,
  repoRoot: string,
): string | null {
  if (typeof inputPath !== "string" || inputPath.length === 0) return null;

  let resolved: string;
  if (path.isAbsolute(inputPath)) {
    resolved = path.normalize(inputPath);
  } else {
    resolved = path.resolve(repoRoot, inputPath);
  }

  const realRoot = realpathOrSelfSync(repoRoot);
  const realResolved = realpathOfDeepestExisting(resolved);
  if (realResolved === null) return null;

  if (
    realResolved !== realRoot &&
    !realResolved.startsWith(realRoot + path.sep)
  ) {
    return null;
  }

  let rel: string;
  try {
    rel = normalizeRepoRelative(path.relative(realRoot, realResolved));
  } catch {
    return null;
  }
  if (rel.length === 0) return null;
  return rel;
}

function realpathOrSelfSync(p: string): string {
  // Use the synchronous realpath via realpathOfDeepestExisting so we
  // share the helper's semantics. The repo root is expected to exist;
  // if realpath fails (EACCES), fall back to a normalized lexical form
  // — the lexical form is what tools/common.ts uses on the issue path
  // when realpath fails for the root.
  const r = realpathOfDeepestExisting(p);
  return r ?? path.resolve(p);
}

/**
 * Read a file at `<repoRoot>/<canonical>` for sha256 precondition
 * verification.
 *
 *   - ENOENT → `{ ok: true, content: "" }`. The create-file path: an
 *     edit_create_file declaration binds before_sha256 = sha256("") and
 *     the hook must accept an absent file as the legitimate starting
 *     state.
 *   - Any other error (EACCES, EISDIR, ELOOP, EMFILE, …) → fail closed
 *     with `{ ok: false, error }`. We CANNOT confirm the precondition
 *     without the bytes; treating an unreadable path as "" would let an
 *     edit land against a file we never actually inspected.
 *
 * Accepted ambiguity (v0.2.1, codex review MEDIUM): a binding whose
 * `before_sha256 === sha256("")` could legitimately mean either
 *   (a) edit_create_file against an absent target, OR
 *   (b) a modify-only declaration against an existing empty file that
 *       happened to be deleted between issuance and consumption.
 * Without `after_sha256` the hook cannot tell create from modify, and
 * v0.2.1 intentionally does not carry an "is_create" flag in the
 * binding (Article 3: friendly-AI threat model — an honest agent does
 * not delete a file they declared to modify; deletion-then-write is
 * not a corruption path the hook is responsible for catching). This
 * ambiguity is recorded here so the next reviewer does not interpret
 * it as a missing check.
 */
async function readFileForBinding(
  repoRoot: string,
  canonical: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const abs = path.join(repoRoot, canonical);
  try {
    return { ok: true, content: await fs.readFile(abs, "utf8") };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { ok: true, content: "" };
    }
    return { ok: false, error: err.code ?? err.message };
  }
}

function sha256Hex(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function shortHash(h: string): string {
  return h.length >= 12 ? `${h.slice(0, 12)}…` : h;
}

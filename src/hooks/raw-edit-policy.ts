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
//   2. `evaluateTokenedEdit({...})` — the SPEC §5.1 flow. Canonicalizes
//      the native call's `file_path`, looks up the most-recently-issued
//      active grant covering it (server-side, by file path), verifies
//      the disk pre-condition (current sha256 vs binding before_sha256),
//      and consumes the binding. Appends a `consumed` record on success.
//
// v0.2.2 fix: agent-passed `_meta_edit_token` removed. Claude Code's
// native Edit / Write / MultiEdit tools have strict input schemas that
// strip / reject extra fields; the framework never delivers a token to
// the hook. The hook now resolves the declaration server-side by
// scanning the on-disk grants directory for the most-recently-issued
// unconsumed binding matching the file_path. LIFO multi-match. The
// agent makes a normal native Edit call after typed_edit; nothing
// extra crosses the wire.
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

import type { HookDecision } from "./hook-runtime.js";
import type { GrantsStore } from "../state/grants.js";
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
        `meta-edit denies raw "${toolName}"; use a typed edit_* MCP tool. ` +
        `If the typed_edit tool schemas are not loaded in your tool list, use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_refactor_only\`) to load the relevant schema before declaring.`,
    };
  }
  return { decision: "allow" };
}

// ---------------------------------------------------------------------
// Token-aware flow (SPEC §5.1)
// ---------------------------------------------------------------------

/** Tool input payload shape (subset). All fields optional / unknown-shaped.
 *
 * v0.2.2: `_meta_edit_token` removed — Claude Code's native Edit / Write /
 * MultiEdit input schemas reject extra fields, so the agent cannot pass a
 * token through. The hook resolves grants server-side by file_path.
 *
 * 1102 (path-aware): `notebook_path` recorded so the hook can scope itself
 * out of out-of-repo NotebookEdit writes (e.g. Claude Code's plan-mode
 * targeting `~/.claude/plans/*.md`). For repo-internal NotebookEdit the
 * hook still denies (v0.2 scope cap, see step 3 below). */
export type RawToolInput = {
  file_path?: unknown;
  notebook_path?: unknown;
  old_string?: unknown;
  new_string?: unknown;
  content?: unknown;
  edits?: unknown;
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
 * Run the SPEC §5.1 flow on a native Edit / Write / MultiEdit /
 * NotebookEdit call.
 *
 * Decision policy (v0.2.2):
 *   - deny: toolName is not one of the four raw edit primitives
 *     (defensive); toolName is NotebookEdit (out of v0.2 scope);
 *     `file_path` is missing or escapes the repo; no active grant
 *     covers `file_path`; before_sha256 disagrees with disk; consume
 *     fails for any reason.
 *   - allow: an active grant covers the canonicalized file_path, the
 *     binding's before_sha256 matches disk, and consume() succeeded.
 *     A `consumed` record is appended to the edit log.
 *
 * The agent passes nothing extra to native Edit / Write / MultiEdit;
 * the hook discovers the relevant grant by file_path on its own.
 */
export async function evaluateTokenedEdit(args: TokenedEvalArgs): Promise<HookDecision> {
  const { toolName, toolInput, repoRoot, grants, log } = args;
  const nowFn = args.now ?? (() => new Date());

  // 0. The matcher should already have filtered to the four raw edits;
  // re-check defensively. evaluateRawEdit returns `allow` for unknown
  // names — promote that to a deny so a misconfigured matcher fails
  // closed rather than waving the call through.
  const lcName = toolName.toLowerCase();
  if (!LOWER_RAW_EDIT_TOOLS.has(lcName)) {
    return {
      decision: "deny",
      reason: `deny-raw-edit invoked for non-raw tool "${toolName}"; check hook matcher`,
    };
  }

  // 1. Extract path: NotebookEdit uses `notebook_path`, the other three
  // use `file_path`. Missing key is fail-closed deny: the hook cannot
  // determine whether a write is repo-internal without a path, and
  // friendly-AI threat model (Article 3) does not justify trusting an
  // empty payload.
  const pathField = lcName === "notebookedit" ? "notebook_path" : "file_path";
  const pathRaw = typeof toolInput[pathField] === "string"
    ? (toolInput[pathField] as string)
    : "";
  if (pathRaw.length === 0) {
    return {
      decision: "deny",
      reason: `${toolName} call missing "${pathField}"; the deny-raw-edit hook needs a file path to look up the active typed_edit declaration.`,
    };
  }

  // 2. Issue 1102: out-of-repo writes are not governed by typed_edit.
  // The hook is scoped to repo-internal writes only — Claude Code's
  // plan-mode (~/.claude/plans/*.md), other plugins targeting agent
  // state directories, and ad-hoc /tmp/scratch writes must pass through.
  // Realpath-based check; symlink-resolved path outside repoRoot ⇒ allow.
  // Realpath failure is treated as in-repo (fail closed) — we cannot
  // confirm out-of-repo without a successful realpath.
  if (!isPathInsideRepo(pathRaw, repoRoot)) {
    return { decision: "allow" };
  }

  // 3. NotebookEdit re-allowed in v0.2.4 (issue 0105-notebookedit).
  // v0.2.0 originally denied NotebookEdit at the policy level because
  // simulate() couldn't replay notebook-shaped cell edits to verify
  // after_sha256. v0.2.1 dropped simulate() / after_sha256 entirely
  // (Article 3 + Article 4: the friction outweighed the value), which
  // made the original objection obsolete. With notebook_path extraction
  // added in v0.2.2 and the out-of-repo branch above in v0.2.3,
  // NotebookEdit now routes through the same canonicalize → grant
  // lookup → consume → before_sha256 staleness flow as the other three
  // raw edits. The staleness check on `before_sha256` remains the
  // single load-bearing pre-condition; it operates on byte-for-byte
  // file content, which is well-defined for `.ipynb` JSON regardless
  // of cell semantics. (No deny here.)

  // 4. file_path canonicalization. The grant lookup is keyed on the
  // canonical (post-realpath, repo-relative, normalized) form produced
  // at issue time by tools/common.ts checkPathSafety; we must reach the
  // same form here. A path that vanishes under realpath fails closed.
  const canonical = canonicalizeForBinding(pathRaw, repoRoot);
  if (canonical === null) {
    return {
      decision: "deny",
      reason: `meta-edit could not canonicalize "${pathRaw}" to a repository-relative path; failing closed.`,
    };
  }

  // 3. Lookup the most-recently-issued active grant covering this file.
  // The findActiveBindingForFile scan: not expired, file appears in
  // binding[], file is not yet in consumed_files. LIFO on issued_at.
  // (v0.2.2: replaces the agent-passed `_meta_edit_token` lookup —
  // Claude Code's strict input schema strips extra fields, so the
  // agent has no way to surface a token to the hook.)
  const match = await grants.findActiveBindingForFile(canonical);
  if (match === null) {
    return {
      decision: "deny",
      reason:
        `meta-edit denies "${toolName}" for "${canonical}": no active typed_edit declaration covers this file. ` +
        `Call a typed edit_* MCP tool first. ` +
        `If the typed_edit tool schemas are not loaded in your tool list, use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_refactor_only\`) to load the relevant schema before declaring.`,
    };
  }
  const { grant, binding: bound } = match;

  // 4. Pre-condition: declared starting state matches disk.
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

  // 5. Pre-condition met. Consume the binding via grants.consume.
  // grants.consume serialises read/modify/write through a per-token
  // (per-grant-file-path) IN-PROCESS mutex (state/grants.ts
  // withSharedLock). The deny-raw-edit hook is, however, a single-shot
  // Node process per Claude Code hook invocation, so two concurrent
  // hook processes against the same grant share NO mutex. Cross-process
  // locking is out of scope per Article 7; this is the residual race
  // accepted under Article 3 (non-adversarial threat model). The
  // honest-mistake outcome is that the second consume() returns
  // "binding already consumed" or "token not found" and the second
  // native write is denied — partial workflow, not corruption.
  const consumeRes = await grants.consume(grant.token_id, canonical);
  if (!consumeRes.consumed) {
    return {
      decision: "deny",
      reason:
        `meta-edit could not consume the typed_edit declaration for "${canonical}": ${consumeRes.error ?? "unknown error"}.`,
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

/**
 * Return true if `inputPath` (resolved against `repoRoot` if relative,
 * then realpath'd through the deepest existing prefix) lands inside
 * the repository tree. Issue 1102: the deny-raw-edit hook only governs
 * repo-internal writes; out-of-repo Edit/Write/MultiEdit/NotebookEdit
 * (e.g. Claude Code plan-mode targeting `~/.claude/plans/*.md`) must
 * pass through.
 *
 * Symlink-aware via `realpathOfDeepestExisting`, matching the semantics
 * `canonicalizeForBinding` uses for grant lookup. On realpath failure
 * the function returns `true` (fail-closed: keep the deny path).
 *
 * Empty / non-string inputs are treated as in-repo so the caller's
 * "missing path key" branch (step 1 in evaluateTokenedEdit) takes
 * precedence and emits a more useful deny reason.
 */
export function isPathInsideRepo(inputPath: string, repoRoot: string): boolean {
  if (typeof inputPath !== "string" || inputPath.length === 0) return true;

  const resolved = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(repoRoot, inputPath);

  const realRoot = realpathOrSelfSync(repoRoot);
  const realResolved = realpathOfDeepestExisting(resolved);
  if (realResolved === null) return true; // fail-closed

  if (realResolved === realRoot) return true;
  return realResolved.startsWith(realRoot + path.sep);
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

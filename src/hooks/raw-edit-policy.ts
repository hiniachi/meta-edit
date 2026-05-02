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
//      verifies the disk pre-condition (before_sha256), simulates the
//      proposed write, verifies the post-condition (after_sha256), and
//      consumes the binding. Appends a `consumed` record to the edit log
//      on success.
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
  // SPEC §5.1 simulate(NotebookEdit) is UNSUPPORTED — the policy below
  // denies it explicitly with a "notebook unsupported" reason.
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
 * Decision policy:
 *   - allow: the call carries a valid token, the binding matches,
 *     before_sha256 matches disk, and simulate(...) produces content
 *     whose sha256 equals the binding's after_sha256. The binding is
 *     consumed and a `consumed` record is appended to the edit log.
 *   - deny: any of the above checks fail, OR the toolName is not one
 *     of the four raw edit primitives (the latter should never happen
 *     when wired through the matcher, but is fail-closed).
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

  // 1. Token presence.
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

  // 2. NotebookEdit is structurally unsupported for simulate() — SPEC §5.1
  // marks it UNSUPPORTED. Refuse before lookup so a misdirected token
  // does not get partially consumed.
  if (toolName.toLowerCase() === "notebookedit") {
    return {
      decision: "deny",
      reason:
        `meta-edit does not support "NotebookEdit" through the token-aware flow ` +
        `(SPEC §5.1: simulate(NotebookEdit) is UNSUPPORTED). Edit the notebook's ` +
        `source cells via an edit_* tool that targets a regular file, or stop and ask the user.`,
    };
  }

  // 3. Lookup. Expired tokens read as null (grants.lookup TTL filter).
  const grant = await grants.lookup(tokenId);
  if (grant === null) {
    return {
      decision: "deny",
      reason:
        `meta-edit token "${tokenId}" is expired or unknown. ` +
        `Single-use tokens have a short TTL (~30s); re-issue via a fresh typed_edit call.`,
    };
  }

  // 4. Canonicalize the file_path. We must reach the same form as
  // binding[].file (post-realpath, repo-relative, normalized) — Task A/B
  // populate that via tools/common.ts checkPathSafety. Failing the
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
  // cannot confirm the precondition without the bytes. (Codex review
  // medium #1.)
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

  // 7. Post-condition: simulated write produces declared content.
  const sim = simulate(toolName, toolInput, diskContent);
  if (!sim.ok) {
    return {
      decision: "deny",
      reason: `${toolName} simulate() failed: ${sim.error}`,
    };
  }
  const simSha = sha256Hex(sim.content);
  if (simSha !== bound.after_sha256) {
    return {
      decision: "deny",
      reason:
        `${toolName}'s simulated result for "${canonical}" does not match the declared after_sha256 ` +
        `(declared ${shortHash(bound.after_sha256)}, would land ${shortHash(simSha)}). ` +
        `Either fix the tool input to land the declared bytes, or re-issue a typed_edit with the new after_sha256.`,
    };
  }

  // 8. All checks passed. Consume the binding via grants.consume.
  // grants.consume serialises read/modify/write through a per-token
  // IN-PROCESS mutex (state/grants.ts withSharedLock). The deny-raw-edit
  // hook is, however, a single-shot Node process per Claude Code hook
  // invocation, so two concurrent hook processes against the same token
  // share NO mutex. Cross-process locking is out of scope per Article 7;
  // this is the residual race accepted under Article 3 (non-adversarial
  // threat model). The honest-mistake outcome is that the second
  // consume() returns "binding already consumed" or "token not found" and
  // the second native write is denied — partial workflow, not corruption.
  // (Codex review medium #2: not "atomic" across processes; document the
  // assumption.)
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
// simulate() per SPEC §5.1
// ---------------------------------------------------------------------

export type SimulateResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/**
 * Pure simulation of what the native tool would write. Mirrors Claude
 * Code's documented semantics:
 *
 *   - Edit:        replace exactly one occurrence of old_string. The
 *                  native Edit tool requires old_string to be UNIQUE in
 *                  the file (single match); we mirror that — zero or
 *                  multiple matches are an error.
 *   - Write:       complete-file overwrite with toolInput.content.
 *   - MultiEdit:   apply each edit in sequence on the running buffer.
 *                  Each edit's old_string MUST be unique in the buffer
 *                  AT THAT POINT.
 *   - NotebookEdit: UNSUPPORTED — caller should reject before reaching here.
 */
export function simulate(
  toolName: string,
  toolInput: RawToolInput,
  current: string,
): SimulateResult {
  switch (toolName.toLowerCase()) {
    case "edit":
      return simulateEdit(toolInput, current);
    case "write":
      return simulateWrite(toolInput);
    case "multiedit":
      return simulateMultiEdit(toolInput, current);
    case "notebookedit":
      return {
        ok: false,
        error: "NotebookEdit is not simulatable in v0.2 (SPEC §5.1)",
      };
    default:
      return { ok: false, error: `simulate() does not support tool "${toolName}"` };
  }
}

function simulateEdit(
  toolInput: RawToolInput,
  current: string,
): SimulateResult {
  const oldStr = typeof toolInput.old_string === "string" ? toolInput.old_string : null;
  const newStr = typeof toolInput.new_string === "string" ? toolInput.new_string : null;
  if (oldStr === null) {
    return { ok: false, error: 'Edit requires "old_string" (string)' };
  }
  if (newStr === null) {
    return { ok: false, error: 'Edit requires "new_string" (string)' };
  }
  return applyUniqueReplace(current, oldStr, newStr, "Edit");
}

function simulateWrite(toolInput: RawToolInput): SimulateResult {
  const content = typeof toolInput.content === "string" ? toolInput.content : null;
  if (content === null) {
    return { ok: false, error: 'Write requires "content" (string)' };
  }
  return { ok: true, content };
}

function simulateMultiEdit(
  toolInput: RawToolInput,
  current: string,
): SimulateResult {
  if (!Array.isArray(toolInput.edits)) {
    return { ok: false, error: 'MultiEdit requires "edits" (array)' };
  }
  let buf = current;
  for (let i = 0; i < toolInput.edits.length; i++) {
    const e = toolInput.edits[i];
    if (typeof e !== "object" || e === null) {
      return { ok: false, error: `MultiEdit edits[${i}] is not an object` };
    }
    const er = e as Record<string, unknown>;
    const oldStr = typeof er.old_string === "string" ? er.old_string : null;
    const newStr = typeof er.new_string === "string" ? er.new_string : null;
    if (oldStr === null) {
      return { ok: false, error: `MultiEdit edits[${i}] requires "old_string" (string)` };
    }
    if (newStr === null) {
      return { ok: false, error: `MultiEdit edits[${i}] requires "new_string" (string)` };
    }
    const step = applyUniqueReplace(buf, oldStr, newStr, `MultiEdit edits[${i}]`);
    if (!step.ok) return step;
    buf = step.content;
  }
  return { ok: true, content: buf };
}

/**
 * Replace exactly one occurrence of `oldStr` in `current`, mirroring
 * native Edit/MultiEdit's uniqueness requirement. An empty `oldStr` is
 * structurally ambiguous (would match between every character) and is
 * rejected to avoid surprising agent behavior.
 */
function applyUniqueReplace(
  current: string,
  oldStr: string,
  newStr: string,
  label: string,
): SimulateResult {
  if (oldStr.length === 0) {
    return {
      ok: false,
      error: `${label}'s old_string is empty; native Edit requires a non-empty unique anchor`,
    };
  }
  const first = current.indexOf(oldStr);
  if (first === -1) {
    return {
      ok: false,
      error: `${label}'s old_string was not found in the current file content`,
    };
  }
  const second = current.indexOf(oldStr, first + 1);
  if (second !== -1) {
    return {
      ok: false,
      error: `${label}'s old_string is not uniquely matched in the current file content (matches at offset ${first} and ${second}); native Edit requires a unique anchor`,
    };
  }
  return {
    ok: true,
    content: current.slice(0, first) + newStr + current.slice(first + oldStr.length),
  };
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
 * Canonicalize an incoming `file_path` to the same form Task A/B writes
 * into binding[].file: post-realpath, repository-relative, normalized.
 *
 * Returns null on:
 *   - empty / non-string input,
 *   - path that lexically escapes the repo,
 *   - realpath that resolves outside the repo,
 *   - realpath failure (EACCES / ELOOP / etc. propagated as null).
 *
 * NOTE: parity with `tools/common.ts checkPathSafety()` is load-bearing
 * — both the issue path (Task A/B) and the consume path (this file)
 * MUST agree on the canonical form, or grants.consume() silently fails
 * with "file_path not bound by this token". The consume-side rules are
 * intentionally a SUBSET of issue-side: we accept absolute paths (Claude
 * Code passes file_path as absolute), we do NOT re-check protected
 * prefixes here (the issuer already rejected protected targets before
 * binding), and we do not require the file to exist (it may be the
 * create-file path).
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
 *     edit land against a file we never actually inspected. (Codex
 *     review medium #1.)
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

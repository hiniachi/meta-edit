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
// branch. All three were removed. v0.2.1 then policy-denied
// NotebookEdit at gate time as a placeholder; v0.3.0 (issue
// 0105-notebookedit) lifts that deny because the staleness check on
// before_sha256 operates on byte content (the .ipynb JSON file as a
// whole) and is well-defined regardless of cell semantics.
// NotebookEdit now routes through the same canonicalize → grant →
// consume → before_sha256 flow as Edit / Write / MultiEdit.
//
// Threat model (Article 3): non-adversarial. We do NOT HMAC-sign tokens
// and do NOT defend against deep TOCTOU between approval and write.
// Honest mistakes only. The pre-condition sha256 check is staleness
// detection — Article 5 explicitly accepts the residual race. (v0.4.2:
// grant consume IS now cross-process locked — best-effort O_EXCL — so
// parallel native writes against one multi-file grant no longer clobber
// each other; see state/grants.ts withInterProcessLock.)

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { HookDecision } from "./hook-runtime.js";
import type { GrantsStore } from "../state/grants.js";
import type { ConsumedEntry, EditLog } from "../state/edit-log.js";
import { buildReminderContext } from "../reminders/context.js";
import { isoTimestamp } from "../state/edit-log.js";
import { canonicalizeRepoRelative } from "../utils/repo-paths.js";

export type { HookDecision };

export const RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  // NotebookEdit edits Jupyter (.ipynb) cells, which carry executable
  // code (Python, shell `!cmd`, JS). Without this entry an agent could
  // rewrite notebook cells and bypass the typed surface entirely.
  // v0.3.0 routes NotebookEdit through the same grant lookup +
  // before_sha256 staleness flow as the other three raw edits; the
  // staleness check operates on byte content of the .ipynb JSON.
  "NotebookEdit",
  // opencode harness raw-edit primitive (lowercase + underscore — no
  // PascalCase canonical name exists since Claude Code does not have
  // this tool). On Claude Code the matcher entry is a dead route that
  // never fires; on opencode the plugin's pre-tool hook denies it via
  // evaluateRawEdit. Note: apply_patch's input is a unified-diff blob
  // (no top-level file_path), so it is intentionally NOT routed
  // through evaluateTokenedEdit's grant flow — calls deny outright
  // and the agent must use edit/write (which DO carry file_path) or
  // declare the change via the typed_edit MCP surface directly.
  "apply_patch",
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
        `meta-edit reminder:\n\n` +
        `I was about to edit through raw "${toolName}" without a meta-edit declaration.\n\n` +
        `That would skip the intended classification step. The correct next move is to choose the typed edit tool that best describes this change, then perform the edit.\n\n` +
        `If the typed_edit tool schemas are not loaded in my tool list, I should use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic\`) to load the relevant schema before declaring.`,
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

  // 0. The matcher should already have filtered to the raw-edit set;
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

  // 0a. opencode's apply_patch carries no top-level file_path — its
  // input is a unified-diff blob with embedded `*** Update File:` /
  // `*** Add File:` headers. The grant flow keys on a single canonical
  // file path (SPEC §5.1), so we cannot bind a grant for an apply_patch
  // call. Deny outright with an actionable reason rather than letting
  // the call fall through to the "missing file_path" path below, whose
  // wording would mislead the agent into thinking they should retry
  // with a file_path argument that the tool simply does not have.
  if (lcName === "apply_patch") {
    return {
      decision: "deny",
      reason:
        `meta-edit reminder:\n\n` +
        `I was about to use "apply_patch", whose unified-diff input has no top-level file_path that the typed_edit declaration can bind against.\n\n` +
        `The correct next move is to use the opencode \`edit\` or \`write\` tool (which DO carry file_path) after a typed_edit declaration, or to invoke a typed edit_* MCP tool directly.\n\n` +
        `If the typed_edit tool schemas are not loaded in my tool list, I should use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic\`) to load the relevant schema before declaring.`,
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

  // 2a. v0.3.1: free empty-Write creates. Empty file creation has no
  // logic to gate, so it does NOT need a typed_edit declaration. The
  // bypass concern that motivated splitting create-vs-content is
  // structurally resolved here: empty creates land freely, and the
  // actual content fill goes through a typed declaration of the
  // appropriate kind (the now-empty file is just modify-mode input).
  //
  // Auto-mkdir parent dirs at the same time (issue K dogfood report:
  // "src does not exist; create it before declaring" was friction
  // without protective value — no agent ever wanted to land an empty
  // file in a missing parent dir).
  //
  // Edit / MultiEdit aren't covered: their semantics require an
  // existing file to match against, so an "empty create" via Edit is
  // ill-formed. NotebookEdit similarly assumes an existing notebook.
  if (lcName === "write" && toolInput.content === "") {
    const absPath = path.isAbsolute(pathRaw)
      ? pathRaw
      : path.join(repoRoot, pathRaw);
    let exists = true;
    try {
      await fs.stat(absPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        exists = false;
      }
      // Other stat errors (EACCES, ELOOP) leave `exists = true` so
      // the call falls through to the normal grant-lookup gate
      // (fail-closed for ambiguous filesystem state).
    }
    if (!exists) {
      try {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
      } catch {
        // mkdir failure is non-fatal; let native Write surface the
        // underlying error. Hook still authorizes; the alternative
        // (deny on parent-mkdir failure) would deny the agent a clear
        // path forward.
      }
      return {
        decision: "warn",
        reason:
          "meta-edit reminder:\n\n" +
          "I created an empty file without a typed_edit declaration. " +
          "Empty creates are authorized, but the actual content fill is the part that should be classified.\n\n" +
          "The next move is to declare an appropriate edit_<TYPE> for the content " +
          "(e.g. edit_state_transition / edit_boundary_condition for source code, " +
          "edit_explanation / edit_progress / edit_observation / edit_proposal / edit_decision " +
          "for Markdown / docs depending on intent, or the matching impl tool with " +
          "target=\"test\" for new test files), then perform the content write through the typed surface.",
      };
    }
    // File exists — empty Write would truncate it. Fall through to
    // grant-lookup so the agent must declare what kind of "blank-out"
    // edit this is (typically edit_cosmetic, or one of the 5 workflow-axis kinds (edit_explanation / edit_progress / etc.)).
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
  // canonical form produced at issue time by the SHARED canonicalizer
  // (src/utils/repo-paths.ts) — issuer and consumer now reach a
  // byte-identical, existence-independent key. Failure fails closed.
  const canonical = canonicalizeForBinding(pathRaw, repoRoot);
  if (canonical === null) {
    return {
      decision: "deny",
      reason: `[meta-edit:path-mismatch] could not canonicalize "${pathRaw}" to a repository-relative path under repoRoot="${repoRoot}"; failing closed.`,
    };
  }

  // 5. Pre-condition read FIRST so the disk sha can steer grant
  // selection (anti-hijack) and categorize the deny. ENOENT → ""
  // (declaration against a not-yet-created file binds sha256("")).
  // Any other read failure is fail-closed.
  const diskRead = await readFileForBinding(repoRoot, canonical);
  if (!diskRead.ok) {
    return {
      decision: "deny",
      reason:
        `[meta-edit:unreadable] could not read "${canonical}" to verify the typed_edit precondition (${diskRead.error}); ` +
        `failing closed — re-read the file and re-issue a typed_edit declaration.`,
    };
  }
  const diskSha = sha256Hex(diskRead.content);

  // 6. Resolve the active grant. preferBeforeSha steers selection to a
  // declaration whose recorded starting state matches the current disk,
  // so an interleaved later declaration cannot hijack this file's
  // pending write.
  const match = await grants.findActiveBindingForFile(canonical, {
    preferBeforeSha: diskSha,
  });
  if (match === null) {
    return {
      decision: "deny",
      reason:
        `meta-edit reminder:\n\n` +
        `I was about to write "${canonical}" (repoRoot="${repoRoot}") but no active typed_edit declaration covers it.\n\n` +
        `That would skip the intended classification step. The correct next move is to call a typed edit_* MCP tool first, then perform the write.\n\n` +
        `If I DID declare it, the path or repo root differs between the declaration and this write — I should re-declare with this exact repository-relative path.\n\n` +
        `If the typed_edit tool schemas are not loaded in my tool list, I should use ToolSearch (e.g. query \`mcp meta-edit edit\` or \`select:mcp__plugin_meta-edit_meta-edit__edit_cosmetic\`) to load the relevant schema before declaring.`,
    };
  }
  const { grant, binding: bound } = match;

  if (diskSha !== bound.before_sha256) {
    return {
      decision: "deny",
      reason:
        `[meta-edit:stale] disk content of "${canonical}" has drifted from the typed_edit declaration ` +
        `(declared before_sha256=${shortHash(bound.before_sha256)}, actual ${shortHash(diskSha)}). ` +
        `Something changed the file between the declaration and this write — re-read it and issue a fresh typed_edit declaration.`,
    };
  }

  // 7. Pre-condition met. Consume the binding. grants.consume
  // serialises the grant-file read/modify/write through an in-process
  // mutex AND a cross-process O_EXCL advisory lock (state/grants.ts),
  // so N parallel single-shot hook processes consuming distinct file
  // bindings of one multi-file grant all succeed instead of racing
  // `consumed_files` down to a single survivor (v0.4.2).
  const consumeRes = await grants.consume(grant.token_id, canonical);
  if (!consumeRes.consumed) {
    const err = consumeRes.error ?? "unknown error";
    const cat =
      err.includes("expired")
        ? "expired"
        : err.includes("already consumed")
          ? "consumed"
          : "consume-failed";
    return {
      decision: "deny",
      reason:
        `[meta-edit:${cat}] could not consume the typed_edit declaration for "${canonical}": ${err}. ` +
        `Re-declare with a typed edit_* MCP tool before retrying the write.`,
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

  const additionalContext =
    grant.declaration !== undefined
      ? buildReminderContext({
          phase: "write_allowed",
          kind: grant.declaration.kind,
          ...(grant.declaration.target !== undefined
            ? { target: grant.declaration.target }
            : {}),
          provenance: grant.declaration.provenance,
          targetFile: canonical,
          declaredTestFiles: grant.declaration.test_files,
        })
      : undefined;

  return {
    decision: "allow",
    ...(additionalContext !== undefined ? { additionalContext } : {}),
  };
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
  // The ONE shared canonicalizer — byte-identical to the issuer's
  // checkPathSafety (src/utils/repo-paths.ts). Consume-side policy:
  // absolute input is accepted (Claude Code passes file_path absolute),
  // no `..`/protected re-check (the issuer already rejected those before
  // binding). Existence-independent, so a file created by the native
  // Write between declare and write still resolves to the bound key.
  const r = canonicalizeRepoRelative(inputPath, repoRoot);
  return r.ok ? r.canonical : null;
}

/**
 * Return true if `inputPath` (resolved against `repoRoot` if relative,
 * then realpath'd through the deepest existing prefix) lands inside
 * the repository tree. Issue 1102: the deny-raw-edit hook only governs
 * repo-internal writes; out-of-repo Edit/Write/MultiEdit/NotebookEdit
 * (e.g. Claude Code plan-mode targeting `~/.claude/plans/*.md`) must
 * pass through.
 *
 * Uses the same shared canonicalizer as `canonicalizeForBinding`. A
 * path that genuinely escapes the repo ⇒ false (out-of-repo write,
 * passed through). `is_root` ⇒ true (the root itself is in-repo). An
 * uncanonicalizable path ⇒ true (fail-closed: keep the deny path).
 *
 * Empty / non-string inputs are treated as in-repo so the caller's
 * "missing path key" branch (step 1 in evaluateTokenedEdit) takes
 * precedence and emits a more useful deny reason.
 */
export function isPathInsideRepo(inputPath: string, repoRoot: string): boolean {
  if (typeof inputPath !== "string" || inputPath.length === 0) return true;
  const r = canonicalizeRepoRelative(inputPath, repoRoot);
  if (r.ok) return true;
  if (r.code === "escapes") return false;
  // is_root or uncanonicalizable → in-repo / fail-closed (keep deny path)
  return true;
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

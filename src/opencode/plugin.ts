// opencode harness adapter for the meta-edit hook policy.
//
// Mirror of `src/hooks/deny-raw-edit.ts` (Claude Code) and
// `src/hooks/deny-bash-write-bypass.ts` (Claude Code) for the opencode
// runtime. opencode runs plugins in-process as JS/TS modules; there is
// no stdio JSON protocol, no external command, no exit code. We export
// a Plugin function whose returned hooks throw to abort a denied tool
// call.
//
// Wiring: a user installs via `meta-edit install-opencode` (CLI lands
// in OC-6) which writes:
//
//   {
//     "mcp": {
//       "meta-edit": { "type": "local", "command": ["meta-edit", "serve"], "enabled": true }
//     },
//     "plugin": ["@hiniachi/meta-edit/opencode"]
//   }
//
// The MCP entry brings the eighteen typed_edit tool descriptions into
// the agent's context (unchanged from Claude Code). The plugin entry is
// THIS file — its job is to deny opencode's raw `edit` / `write` /
// `apply_patch` and dangerous `bash` while the typed surface lights up.
//
// Token-flow integration (Q-D, full): when an agent declares via the
// MCP server (typed_edit_*) and then issues a native `edit` / `write`,
// the plugin instantiates `EditLog` + `Grants` for the same repoRoot
// and calls `evaluateTokenedEdit` exactly as deny-raw-edit.ts does on
// the Claude Code side. The grants store under
// `.meta-edit/state/grants/` and the audit log under
// `.meta-edit/state/edits.jsonl` are shared with any concurrent
// MCP-server-side issuer (in-process JS, same filesystem).

import {
  evaluateTokenedEdit,
  type RawToolInput,
} from "../hooks/raw-edit-policy.js";
import { evaluateBashCommand } from "../hooks/bash-write-policy.js";
import { EditLog } from "../state/edit-log.js";
import { createGrantsStore, type GrantsStore } from "../state/grants.js";
import {
  isOpencodeRawEditTool,
  toCanonicalRawEditName,
} from "./tool-name-map.js";

// ---------------------------------------------------------------------
// Minimal local types for the opencode plugin contract.
//
// Why not `import type { Plugin } from "@opencode-ai/plugin"`? — that
// package is an optional peer (per Q1 / Q5 decision). Keeping the
// types local means meta-edit typechecks without the peer installed,
// and the runtime contract is self-documented here. Names follow
// opencode's documented Plugin API; align with upstream when their
// types stabilise.
// ---------------------------------------------------------------------

/** Subset of the opencode plugin context object we read. */
export interface OpencodePluginContext {
  /** Project worktree root. */
  project: { worktree: string };
}

/** Subset of the `tool.execute.before` event payload. */
export interface OpencodeToolBeforeInput {
  /** Lowercase opencode tool name (`edit`, `write`, `apply_patch`, `bash`, ...). */
  tool: string;
}

/** Subset of the `tool.execute.before` mutable result object. */
export interface OpencodeToolBeforeOutput {
  /** Tool arguments as opencode parsed them. Shape is per-tool. */
  args: Record<string, unknown>;
  /**
   * Set to `true` by the hook when a tool call must be aborted, in
   * addition to throwing. Today's opencode runtime aborts on the
   * thrown exception alone; this field is the documented fallback
   * shape per the macro plan's R2 mitigation. Setting it preemptively
   * costs nothing and means the swap-in is grep-discoverable.
   */
  aborted?: boolean;
}

export type OpencodeToolBeforeHook = (
  input: OpencodeToolBeforeInput,
  output: OpencodeToolBeforeOutput,
) => void | Promise<void>;

export interface OpencodePluginHooks {
  "tool.execute.before"?: OpencodeToolBeforeHook;
}

export type OpencodePlugin = (
  ctx: OpencodePluginContext,
) => Promise<OpencodePluginHooks>;

// ---------------------------------------------------------------------
// Test-injectable factory deps. The default implementations spin up
// real EditLog / Grants stores against the project worktree; tests pass
// in-memory fakes.
// ---------------------------------------------------------------------

export interface CreateMetaEditPluginDeps {
  newEditLog?: (repoRoot: string) => EditLog;
  newGrantsStore?: (repoRoot: string) => GrantsStore;
}

/**
 * Build a meta-edit opencode plugin. The default factory uses
 * `EditLog` + `createGrantsStore` directly; test code can substitute
 * by passing `deps`.
 */
export function createMetaEditPlugin(
  deps: CreateMetaEditPluginDeps = {},
): OpencodePlugin {
  const newEditLog = deps.newEditLog ?? ((root: string) => new EditLog(root));
  const newGrantsStore = deps.newGrantsStore ?? createGrantsStore;

  return async (ctx) => {
    const repoRoot = ctx.project.worktree;
    const log = newEditLog(repoRoot);
    const grants = newGrantsStore(repoRoot);

    const onToolBefore: OpencodeToolBeforeHook = async (input, output) => {
      const lower = typeof input.tool === "string" ? input.tool.toLowerCase() : "";

      // Branch 1: opencode raw-edit primitive (`edit`, `write`,
      // `apply_patch`). Route through evaluateTokenedEdit with a
      // canonical PascalCase / canonical name so RAW_EDIT_TOOLS
      // membership is a literal hit.
      if (isOpencodeRawEditTool(lower)) {
        const canonical = toCanonicalRawEditName(lower);
        if (canonical === null) {
          // Defensive: isOpencodeRawEditTool true ⇒ toCanonicalRawEditName
          // non-null, but if a future map drift breaks this invariant,
          // fail closed rather than silently skip the gate.
          throwAbort(
            `meta-edit opencode plugin: tool "${input.tool}" passed isOpencodeRawEditTool but failed toCanonicalRawEditName — map/predicate drift; please report.`,
            output,
          );
          return;
        }
        const rawInput = mapOpencodeArgsToRawToolInput(canonical, output.args);
        let decision;
        try {
          decision = await evaluateTokenedEdit({
            toolName: canonical,
            toolInput: rawInput,
            repoRoot,
            grants,
            log,
          });
        } catch (e) {
          // Parity with deny-raw-edit.ts (Claude Code side, line ~121):
          // unexpected internal failure inside the policy is fail-closed
          // deny. Without this catch a transient I/O / state error in
          // the grants store would propagate as an unhandled hook
          // exception — opencode's documented behaviour for that is
          // unverified (R2), and the conservative shape is "the hook
          // explicitly denied" rather than "the hook crashed".
          throwAbort(
            `meta-edit opencode plugin errored on ${canonical}: ${(e as Error).message}`,
            output,
          );
        }
        if (decision.decision === "deny") {
          throwAbort(decision.reason ?? "denied by meta-edit", output);
        }
        if (decision.decision === "warn") {
          // The empty-Write-create authorization in evaluateTokenedEdit
          // step 2a returns warn with an actionable reason. Claude Code
          // surfaces this via replyAllowWithWarning into the agent's
          // transcript. opencode has no equivalent return channel, so
          // mirror the signal to stderr — operators tailing the plugin
          // host see the same nudge to declare a typed edit_<TYPE> for
          // the content fill.
          process.stderr.write(
            `[meta-edit] WARN (${canonical}): ${decision.reason ?? "warned by meta-edit"}\n`,
          );
        }
        return;
      }

      // Branch 2: bash. evaluateBashCommand is the same pure
      // classifier used by deny-bash-write-bypass.ts on Claude Code.
      if (lower === "bash") {
        const command =
          typeof output.args["command"] === "string"
            ? (output.args["command"] as string)
            : "";
        const decision = evaluateBashCommand(command, { cwd: repoRoot });
        if (decision.decision === "deny") {
          throwAbort(decision.reason ?? "denied by meta-edit", output);
        }
        return;
      }

      // Anything else passes through untouched.
    };

    return {
      "tool.execute.before": onToolBefore,
    };
  };
}

/**
 * Default plugin export. opencode loads the default export of the
 * module named in `opencode.json`'s `plugin` array.
 */
const MetaEditPlugin: OpencodePlugin = createMetaEditPlugin();

export default MetaEditPlugin;

// ---------------------------------------------------------------------
// Internal: opencode args → RawToolInput shape mapping.
//
// opencode's edit / write tools use camelCase (`filePath`, `oldString`,
// `newString`, `content`); meta-edit's RawToolInput is snake_case
// (`file_path`, `old_string`, `new_string`, `content`) to mirror Claude
// Code's payload. This adapter normalizes between them defensively —
// accepts either casing so a future opencode minor that switches naming
// does not silently break the gate.
// ---------------------------------------------------------------------

function mapOpencodeArgsToRawToolInput(
  canonical: string,
  args: Record<string, unknown>,
): RawToolInput {
  // opencode uses camelCase; Claude Code RawToolInput uses snake_case.
  // Accept either form for forward-compat with opencode renames.
  const filePath =
    pickString(args, "file_path") ??
    pickString(args, "filePath") ??
    undefined;
  const oldString =
    pickString(args, "old_string") ??
    pickString(args, "oldString") ??
    undefined;
  const newString =
    pickString(args, "new_string") ??
    pickString(args, "newString") ??
    undefined;
  const content = args["content"];
  // edits[] is the MultiEdit-style batch; opencode does not have a
  // MultiEdit equivalent today, but if it ever lands the field name
  // would likely be `edits`. Pass through untyped — RawToolInput's
  // edits is `unknown`.
  const edits = args["edits"];

  const out: RawToolInput = {};
  if (filePath !== undefined) out.file_path = filePath;
  if (oldString !== undefined) out.old_string = oldString;
  if (newString !== undefined) out.new_string = newString;
  if (content !== undefined) out.content = content;
  if (edits !== undefined) out.edits = edits;
  // apply_patch carries no file_path; the empty RawToolInput here will
  // hit the dedicated apply_patch deny in evaluateTokenedEdit step 0a.
  // No mapping needed — kept this branch shape symmetric.
  void canonical;
  return out;
}

function pickString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Throw an abort error in the shape opencode's plugin runtime expects.
 * As of this writing the documented contract is to throw; the function
 * also sets `output.aborted = true` defensively so a future opencode
 * release that switches to inspect-output-then-abort (R2 in the macro
 * plan) still aborts the call without touching this call site. The
 * extra property is harmless on the throw-only contract.
 */
function throwAbort(reason: string, output: OpencodeToolBeforeOutput): never {
  output.aborted = true;
  throw new Error(reason);
}

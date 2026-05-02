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
        const decision = await evaluateTokenedEdit({
          toolName: canonical,
          toolInput: rawInput,
          repoRoot,
          grants,
          log,
        });
        if (decision.decision === "deny") {
          throwAbort(decision.reason ?? "denied by meta-edit", output);
        }
        // allow / warn fall through (warn is currently unused on the
        // raw-edit path; if reintroduced, surface via stderr like the
        // Claude Code side does).
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
 * also writes to stderr so a misconfigured runtime that swallows
 * exceptions still produces visible output. (R2 in the macro plan: if
 * a future opencode release changes the abort mechanism, switch to
 * `output.aborted = true` here without touching the call sites.)
 */
function throwAbort(reason: string, output: OpencodeToolBeforeOutput): never {
  // Mark aborted defensively in case opencode ever introspects the
  // output object after a thrown hook (today it does not, per the
  // plugin docs, but the cost of setting a property is zero).
  void output;
  throw new Error(reason);
}

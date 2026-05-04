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

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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

/** Subset of the `experimental.chat.system.transform` event input. */
export interface OpencodeChatSystemTransformInput {
  sessionID?: string;
}

/** Subset of the `experimental.chat.system.transform` event output. */
export interface OpencodeChatSystemTransformOutput {
  /** Lines appended to the LLM system prompt (mutated in place). */
  system: string[];
}

export type OpencodeChatSystemTransformHook = (
  input: OpencodeChatSystemTransformInput,
  output: OpencodeChatSystemTransformOutput,
) => void | Promise<void>;

export interface OpencodePluginHooks {
  "tool.execute.before"?: OpencodeToolBeforeHook;
  "experimental.chat.system.transform"?: OpencodeChatSystemTransformHook;
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
  /**
   * Inject the SKILL.md text the plugin pushes into the system prompt.
   * Tests pass a fixture string; the default reads
   * `<package-root>/skills/typed-edit-onboarding/SKILL.md` from the
   * npm-published bundle. If the file is missing the plugin falls
   * back to a short pointer (see `FALLBACK_ONBOARDING_POINTER`).
   */
  skillContent?: string;
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
  // Read SKILL.md once, at plugin creation. If the file is missing
  // (stripped install / unusual layout), fall back to the short pointer
  // so deny messages still have a referable name.
  const skillContent = deps.skillContent ?? loadDefaultSkillContent();

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

    // -------------------------------------------------------------------
    // Skill onboarding pointer — opencode equivalent of the Claude Code
    // SessionStart hook (src/hooks/session-onboarding.ts). opencode
    // discovers ~/.claude/skills/<name>/SKILL.md but does not auto-surface
    // skill content into the agent's per-message context the way Claude
    // Code does. We push a short pointer into the system prompt array on
    // every chat call (opencode rebuilds the system prompt per message,
    // so per-message push, not per-session dedup, is the right shape).
    //
    // The pointer mirrors the SessionStart additionalContext text but is
    // condensed to a few lines — the skill description itself is the
    // authoritative content; we just remind the agent the skill exists.
    const onSystemTransform: OpencodeChatSystemTransformHook = (
      _input,
      output,
    ) => {
      output.system.push(skillContent);
    };

    return {
      "tool.execute.before": onToolBefore,
      "experimental.chat.system.transform": onSystemTransform,
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
 * Squash a long, multi-clause Claude Code-style deny reason into a
 * single short sentence opencode's TUI can render cleanly above the
 * input bar.
 *
 * Background: opencode (v1.14.x) renders thrown plugin errors near the
 * bottom of the screen and overlaps long error text with the input
 * widget. Backtick-quoted code spans (`mcp meta-edit edit`) make this
 * worse because the markdown renderer assigns them inline-code width
 * that the layout engine miscounts. Other MCP servers exhibit the
 * same overlap, so the bug is upstream — see TODO upstream link in
 * README. As a meta-edit-side mitigation we:
 *
 *   1. Take only the first sentence (split on `.` / `。` followed by
 *      whitespace). Subsequent sentences carry recovery hints
 *      (ToolSearch, edit_* etc.) — the agent already has the typed
 *      surface available; stripping the hint is acceptable cost vs the
 *      visual annoyance.
 *   2. Strip backticks → plain words. The information is preserved;
 *      the rendering hint is gone.
 *   3. Hard cap at 160 chars with ellipsis as a last resort.
 *
 * The canonical multi-clause reason in `raw-edit-policy.ts` is
 * unchanged — Claude Code's hook continues to surface the full text.
 */
export function summarizeReasonForOpencode(reason: string): string {
  const noBackticks = reason.replace(/`/g, "");
  // Split on the first sentence terminator. Two patterns:
  //   - Japanese 。 → split immediately after (no whitespace needed; CJK
  //     prose runs sentences continuously).
  //   - English . → require a following `\s+[A-Z]` so common
  //     abbreviations (`e.g. query`, `i.e. opencode`) do not falsely
  //     terminate. This is heuristic but covers the deny-reason corpus
  //     in raw-edit-policy.ts.
  const jp = noBackticks.match(/^[\s\S]*?。/);
  let firstSentence: string;
  if (jp) {
    firstSentence = jp[0];
  } else {
    const en = noBackticks.match(/^[\s\S]*?\.(?=\s+[A-Z])/);
    firstSentence = en ? en[0] : noBackticks;
  }
  if (firstSentence.length <= 160) return firstSentence;
  return firstSentence.slice(0, 157) + "...";
}

/**
 * Throw an abort error in the shape opencode's plugin runtime expects.
 * As of this writing the documented contract is to throw; the function
 * also sets `output.aborted = true` defensively so a future opencode
 * release that switches to inspect-output-then-abort (R2 in the macro
 * plan) still aborts the call without touching this call site. The
 * extra property is harmless on the throw-only contract.
 *
 * The reason is squashed via `summarizeReasonForOpencode` first to
 * mitigate an opencode TUI rendering bug that causes long deny
 * messages to overlap with the input bar.
 */
function throwAbort(reason: string, output: OpencodeToolBeforeOutput): never {
  output.aborted = true;
  throw new Error(summarizeReasonForOpencode(reason));
}

/**
 * Fallback onboarding pointer used when the bundled SKILL.md cannot be
 * read (stripped install / file removed / fs error). The full skill
 * content is loaded at plugin creation; this string is the safety net
 * so the agent still sees something explaining the deny gate.
 *
 * Exported for tests.
 */
export const FALLBACK_ONBOARDING_POINTER = [
  "meta-edit MCP server is registered for this project.",
  "Use the typed_edit_* MCP tools — raw edit / write / apply_patch " +
    "calls are denied by the meta-edit pre-tool hook unless preceded " +
    "by a typed_edit declaration. Empty-content writes for new files " +
    "are authorized as a free path.",
  "(typed-edit-onboarding SKILL.md was not found in the installed " +
    "package; agent guidance is operating in fallback mode.)",
].join(" ");

/**
 * Read the bundled `skills/typed-edit-onboarding/SKILL.md`, strip its
 * YAML frontmatter, and return the prose body. The frontmatter is
 * skill-loader metadata — `name` / `description` — which is not useful
 * inside an opencode system-prompt push, so we drop it.
 *
 * On any error (missing file, fs problem, malformed frontmatter) the
 * fallback pointer is returned so the chat.system.transform hook keeps
 * working in a degraded mode.
 *
 * Exported for tests; the runtime path uses defaultSkillSourcePath.
 */
export function loadDefaultSkillContent(): string {
  try {
    const raw = fs.readFileSync(defaultSkillSourcePath(), "utf8");
    return stripFrontmatter(raw).trimStart();
  } catch {
    return FALLBACK_ONBOARDING_POINTER;
  }
}

/**
 * Locate <package-root>/skills/typed-edit-onboarding/SKILL.md. Walks
 * up from this module's location at most 4 levels — works in both dev
 * (<root>/src/opencode/plugin.ts, walks 2 up) and the published
 * bundle (<root>/dist/opencode/plugin.js, walks 1 up). Falls back to
 * a sensible relative path on miss; the caller's try/catch then
 * promotes to the fallback pointer.
 */
function defaultSkillSourcePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(
      cur,
      "skills",
      "typed-edit-onboarding",
      "SKILL.md",
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(here, "..", "..", "skills", "typed-edit-onboarding", "SKILL.md");
}

/**
 * Drop a leading YAML frontmatter block (--- ... ---) and return the
 * rest of the document. If the input does not start with --- we pass
 * through unchanged — defensive against future SKILL.md formats that
 * don't carry frontmatter.
 *
 * Exported for tests.
 */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  // Match the second --- on its own line. Use a non-greedy body so we
  // don't eat past the actual close marker if the body happens to
  // contain --- later (Markdown horizontal rules).
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!m) return text;
  return text.slice(m[0].length);
}

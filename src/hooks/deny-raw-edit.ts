#!/usr/bin/env node
// Claude Code PreToolUse hook entry point: token-aware deny-raw-edit
// (Case C / v0.2). Wires the pure policy in raw-edit-policy.ts to the
// stdin/stdout JSON protocol Claude Code uses for hooks.
//
// Configure via .claude/settings.json:
//   {
//     "hooks": {
//       "PreToolUse": [
//         {
//           "matcher": "Edit|Write|MultiEdit|NotebookEdit|apply_patch",
//           "hooks": [
//             { "type": "command", "command": "node dist/hooks/deny-raw-edit.js" }
//           ]
//         }
//       ]
//     }
//   }
//
// The matcher above MUST list every tool name in RAW_EDIT_TOOLS
// (raw-edit-policy.ts). `meta-edit install-hooks` emits this exact
// matcher via META_EDIT_RAW_EDIT_MATCHER in cli/hooks-cmd.ts.
// `apply_patch` is opencode-only — Claude Code never emits it, so the
// matcher entry is a dead route there. Including it keeps the canonical
// set un-forked across harnesses (SPEC Article 8).
//
// Decision flow (SPEC §5.1):
//   1. If toolName is not one of the five raw edit primitives, allow.
//      (Defensive — the matcher above already filters; this is a no-op
//      for any other tool that somehow lands here.)
//   2. Otherwise run the token-aware policy. The hook denies on
//      missing/expired token, file-not-bound, before_sha256 staleness,
//      or NotebookEdit (out of v0.2 scope). On allow we ALSO consume
//      the binding and append a `consumed` record to the edit log —
//      this is the PreToolUse choice (Option A in the Task C brief).
//      Audit consumers reconcile by edit_id.
//
// v0.2.1: the v0.2.0 `simulate()` post-condition check (after_sha256
// replay) was removed. Per Article 3 the friction outweighed the
// value; staleness on before_sha256 is the single load-bearing
// pre-condition.
//
// The Option A choice means a `consumed` record is written BEFORE the
// native write completes. If the actual write fails (disk full,
// permissions), the audit log shows "consumed-but-not-applied". This is
// acceptable per the friendly-AI threat model (Article 3): git is the
// ground truth for whether bytes landed; the edit log records
// "the hook authorized this write at <ts>", not "the write succeeded".

import {
  readStdin,
  replyAllow,
  replyAllowWithWarning,
  replyDeny,
  replyWithAdditionalContext,
} from "./hook-runtime.js";
import {
  evaluateRawEdit,
  evaluateTokenedEdit,
  type RawToolInput,
} from "./raw-edit-policy.js";
import { EditLog } from "../state/edit-log.js";
import { createGrantsStore } from "../state/grants.js";
import { resolveRepoRoot } from "../utils/repo-paths.js";

async function main(): Promise<number> {
  const event = await readStdin();
  const toolName = typeof event["tool_name"] === "string" ? event["tool_name"] : "";

  // Gate 1: classification. Non-raw tools fall through with allow — the
  // matcher should already filter, but this is the fail-open guarantee
  // for anything that isn't structurally an Edit/Write/MultiEdit/NotebookEdit.
  const classification = evaluateRawEdit(toolName);
  if (classification.decision !== "deny") {
    // For raw-edit-policy v0.2 evaluateRawEdit returns either deny (raw)
    // or allow (everything else). `warn` is reserved for future use.
    if (classification.decision === "warn") {
      return replyAllowWithWarning(
        classification.reason ?? "warned by deny-raw-edit",
      );
    }
    return replyAllow();
  }

  // Gate 2: token-aware flow. Anything denied by classification gets
  // a chance to validate via the token mechanism (SPEC §5.1).
  const repoRoot = resolveRepoRoot(
    typeof event["cwd"] === "string" ? event["cwd"] : undefined,
  );
  const toolInput = (event["tool_input"] as RawToolInput | undefined) ?? {};
  const grants = createGrantsStore(repoRoot);
  const log = new EditLog(repoRoot);

  let decision;
  try {
    decision = await evaluateTokenedEdit({
      toolName,
      toolInput,
      repoRoot,
      grants,
      log,
    });
  } catch (e) {
    // Unexpected failure inside the policy is fail-closed: deny with a
    // diagnostic so the user can act, rather than silently allowing.
    const msg = (e as Error).message;
    return replyDeny(`deny-raw-edit policy errored on ${toolName}: ${msg}`);
  }

  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-raw-edit");
  }
  if (decision.decision === "warn") {
    return replyAllowWithWarning(
      decision.reason ?? "warned by deny-raw-edit",
    );
  }
  if (decision.additionalContext !== undefined) {
    return replyWithAdditionalContext(decision.additionalContext);
  }
  return replyAllow();
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`deny-raw-edit hook crashed: ${(err as Error).message}`);
    process.exit(2);
  },
);

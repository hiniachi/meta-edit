#!/usr/bin/env node
// Claude Code PreToolUse hook entry point: deny raw Edit / Write /
// MultiEdit / NotebookEdit. Wires the pure policy from
// raw-edit-policy.ts to the stdin/stdout JSON protocol Claude Code uses
// for hooks.
//
// Configure via .claude/settings.json:
//   {
//     "hooks": {
//       "PreToolUse": [
//         {
//           "matcher": "Edit|Write|MultiEdit|NotebookEdit",
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

import {
  readStdin,
  replyAllow,
  replyAllowWithWarning,
  replyDeny,
} from "./hook-runtime.js";
import { evaluateRawEdit } from "./raw-edit-policy.js";

async function main(): Promise<number> {
  const event = await readStdin();
  const toolName = typeof event["tool_name"] === "string" ? event["tool_name"] : "";
  const decision = evaluateRawEdit(toolName);
  // Exhaustive dispatch over the shared HookDecision union. The
  // current raw-edit policy only emits `deny` / `allow`, but covering
  // `warn` here means a future policy change that introduces a warn
  // surface (e.g. soft-policy on a future tool name) does not silently
  // fall through to `allow`.
  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-raw-edit");
  }
  if (decision.decision === "warn") {
    return replyAllowWithWarning(
      decision.reason ?? "warned by deny-raw-edit",
    );
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

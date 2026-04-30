#!/usr/bin/env node
// Claude Code PreToolUse hook entry point: deny raw Edit / Write /
// MultiEdit. Wires the pure policy from raw-edit-policy.ts to the
// stdin/stdout JSON protocol Claude Code uses for hooks.
//
// Configure via .claude/settings.json:
//   {
//     "hooks": {
//       "PreToolUse": [
//         {
//           "matcher": "Edit|Write|MultiEdit",
//           "hooks": [
//             { "type": "command", "command": "node dist/hooks/deny-raw-edit.js" }
//           ]
//         }
//       ]
//     }
//   }

import { readStdin, replyDeny, replyAllow } from "./hook-runtime.js";
import { evaluateRawEdit } from "./raw-edit-policy.js";

async function main(): Promise<number> {
  const event = await readStdin();
  const toolName = typeof event["tool_name"] === "string" ? event["tool_name"] : "";
  const decision = evaluateRawEdit(toolName);
  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-raw-edit");
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

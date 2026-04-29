#!/usr/bin/env node
// Claude Code PreToolUse hook entry point: deny common bash patterns
// that write to repo files outside the edit_* tool surface (SPEC §5.2).
//
// Configure via .claude/settings.json:
//   {
//     "hooks": {
//       "PreToolUse": [
//         {
//           "matcher": "Bash",
//           "hooks": [
//             { "type": "command", "command": "node dist/hooks/deny-bash-write-bypass.js" }
//           ]
//         }
//       ]
//     }
//   }

import { readStdin, replyAllow, replyDeny } from "./hook-runtime.js";
import { evaluateBashCommand } from "./bash-write-policy.js";

async function main(): Promise<number> {
  const event = await readStdin();
  const toolName = typeof event["tool_name"] === "string" ? event["tool_name"] : "";
  if (toolName !== "Bash") {
    return replyAllow();
  }
  const input = (event["tool_input"] as { command?: unknown } | undefined) ?? {};
  const command = typeof input.command === "string" ? input.command : "";
  const decision = evaluateBashCommand(command);
  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-bash-write-bypass");
  }
  return replyAllow();
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(
      `deny-bash-write-bypass hook crashed: ${(err as Error).message}`,
    );
    process.exit(2);
  },
);

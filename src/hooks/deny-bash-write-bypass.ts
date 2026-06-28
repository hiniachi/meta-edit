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

import {
  readStdin,
  replyAllow,
  replyAllowWithWarning,
  replyDeny,
} from "./hook-runtime.js";
import { evaluateBashCommand } from "./bash-write-policy.js";
import { resolveRepoRoot } from "../utils/repo-paths.js";

async function main(): Promise<number> {
  const event = await readStdin();
  const toolName = typeof event["tool_name"] === "string" ? event["tool_name"] : "";
  if (toolName !== "Bash") {
    return replyAllow();
  }
  const input = (event["tool_input"] as { command?: unknown } | undefined) ?? {};
  const command = typeof input.command === "string" ? input.command : "";
  // Thread both the agent's cwd and discovered repo root into the policy so
  // subdirectory launches still resolve symlinked protected paths correctly.
  const cwd = typeof event["cwd"] === "string" ? event["cwd"] : undefined;
  const decision = evaluateBashCommand(
    command,
    cwd === undefined ? {} : { cwd, repoRoot: resolveRepoRoot(cwd) },
  );
  if (decision.decision === "deny") {
    return replyDeny(decision.reason ?? "denied by deny-bash-write-bypass");
  }
  if (decision.decision === "warn") {
    return replyAllowWithWarning(
      decision.reason ?? "redirect target outside safe-sink allowlist",
    );
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

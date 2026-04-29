// Shared runtime for Claude Code hook scripts.
//
// Hooks read a JSON event object from stdin (containing fields such as
// `tool_name`, `tool_input`, etc.) and respond with a JSON object that
// Claude Code uses to decide whether to allow, deny, or modify the call.
//
// We use Claude Code's documented `hookSpecificOutput.permissionDecision`
// shape so that the deny reason is surfaced to the agent verbatim. Exit
// code 0 with valid JSON is the intended path; on parse errors or
// unexpected exceptions we exit with code 2 so the call is blocked
// fail-closed and the error is visible to the user.

export type HookEvent = Record<string, unknown>;

export async function readStdin(): Promise<HookEvent> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as HookEvent);
      } catch (e) {
        reject(e);
      }
    });
    process.stdin.on("error", reject);
  });
}

export function replyAllow(): number {
  // Empty JSON output is interpreted as "no opinion / allow". We could
  // also explicitly emit `{ permissionDecision: "allow" }`, but that
  // would override any other hook in the chain. Staying silent lets
  // downstream hooks contribute their own decisions.
  process.stdout.write("");
  return 0;
}

export function replyDeny(reason: string): number {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}

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

// Canonical decision shape shared by every hook policy in this package.
//
// `warn` is "allow with a structured nudge to the agent": the call
// proceeds, the AI receives the reason via `additionalContext`, and the
// human reviewer sees the same text in stderr / the transcript. Used
// today only by the bash-write-policy structural redirect-target
// surface (SPEC §5.2). When Claude Code merges multiple hook decisions
// the precedence is `deny > defer > ask > allow`, so a `warn` (allow)
// from one hook never overrides a `deny` from another.
//
// Promoted out of per-policy declarations so that any future shared
// helper sees one canonical union and TypeScript catches drift if a new
// decision member is introduced.
export type HookDecision = {
  decision: "allow" | "deny" | "warn";
  reason?: string;
  /**
   * Model-visible context to inject after policy permits the call. Used for
   * successful meta-edit grant consumption: unlike `reason`, this is not a
   * warning or denial, so it should not be mirrored to stderr.
   */
  additionalContext?: string;
};

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
  // Empty JSON output is interpreted as "no opinion / allow". Claude
  // Code's hook chain merges decisions by precedence
  // (`deny > defer > ask > allow`), so an explicit
  // `{ permissionDecision: "allow" }` would not actually override a
  // `deny` from another hook — but staying silent is still preferable
  // because it lets the host treat us as "no opinion" rather than as a
  // positive vote, which avoids a class of debugging confusion when
  // multiple hooks are configured.
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

// "Allow with a structured warning". Emits three things in one reply:
//
//   1. `permissionDecision: "allow"` — Claude Code does not block the
//      call. Hook-chain precedence (`deny > defer > ask > allow`)
//      ensures this never overrides a `deny` from another hook.
//
//   2. `permissionDecisionReason` — per Claude Code's documented hook
//      contract, this field is shown to the USER on `allow` / `ask`
//      decisions but is NOT fed back to Claude. Carried for transcript
//      / UI display so a human reviewer sees a structured rationale
//      next to the call.
//
//   3. `additionalContext` — this is the field the docs describe as
//      "added to Claude's context alongside the tool result". It IS
//      delivered to the model. The warn reason goes here so the agent
//      receives the nudge toward an `edit_*` tool on the very next
//      turn. This is the load-bearing surface for the v0.1.5 deny→warn
//      loosening; without it the AI would proceed with no signal that
//      the redirect-target check fired.
//
// Stderr also mirrors the reason for redundancy (some hosts may surface
// stderr in the transcript independently of `additionalContext`).
//
// Used by deny-bash-write-bypass for the structural redirect-to-outside-
// safe-sink case (SPEC §5.2, v0.1.5+). See bash-write-policy.ts for the
// rationale for warn instead of deny on that surface.
export function replyAllowWithWarning(reason: string): number {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason,
      additionalContext: reason,
    },
  };
  process.stdout.write(JSON.stringify(payload));
  process.stderr.write(`[meta-edit] ${reason}\n`);
  return 0;
}

export function replyWithAdditionalContext(additionalContext: string): number {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}

export type CodexHookEventName = "PreToolUse" | "SessionStart";

export type CodexHookPayload =
  | {
      ok: true;
      value: {
        hookEventName: CodexHookEventName;
        cwd?: string;
        toolName?: string;
        toolInput: Record<string, unknown>;
      };
    }
  | { ok: false; error: string };

export type CodexHookDecision = {
  decision: "allow" | "deny" | "warn";
  reason?: string;
  additionalContext?: string;
};

export async function readCodexHookStdin(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch (e) {
        reject(e);
      }
    });
    process.stdin.on("error", reject);
  });
}

export function parseCodexHookPayload(payload: unknown): CodexHookPayload {
  if (!isRecord(payload)) {
    return { ok: false, error: "Codex hook payload must be a JSON object" };
  }

  const hookEventName = stringField(payload, "hook_event_name") ??
    stringField(payload, "hookEventName");
  if (hookEventName !== "PreToolUse" && hookEventName !== "SessionStart") {
    return {
      ok: false,
      error: "Codex hook payload missing supported hook_event_name",
    };
  }

  const cwd = stringField(payload, "cwd");
  if (hookEventName === "SessionStart") {
    return {
      ok: true,
      value: {
        hookEventName,
        ...(cwd !== undefined ? { cwd } : {}),
        toolInput: {},
      },
    };
  }

  const toolName = stringField(payload, "tool_name") ??
    stringField(payload, "toolName");
  if (toolName === undefined || toolName.length === 0) {
    return { ok: false, error: "Codex PreToolUse payload missing tool_name" };
  }

  const rawToolInput = payload["tool_input"] ?? payload["toolInput"];
  if (!isRecord(rawToolInput)) {
    return {
      ok: false,
      error: "Codex PreToolUse payload tool_input must be a JSON object",
    };
  }

  return {
    ok: true,
    value: {
      hookEventName,
      ...(cwd !== undefined ? { cwd } : {}),
      toolName,
      toolInput: rawToolInput,
    },
  };
}

export function renderCodexHookResponse(
  decision: CodexHookDecision,
): Record<string, unknown> {
  if (decision.decision === "allow") {
    return decision.additionalContext !== undefined
      ? { additional_context: decision.additionalContext }
      : {};
  }

  if (decision.decision === "warn") {
    const parts = [decision.reason, decision.additionalContext].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return parts.length > 0 ? { additional_context: parts.join("\n\n") } : {};
  }

  const out: Record<string, unknown> = { decision: decision.decision };
  if (decision.decision === "deny") out.decision = "block";
  out.reason =
    typeof decision.reason === "string" && decision.reason.length > 0
      ? decision.reason
      : "denied by meta-edit";
  if (decision.additionalContext !== undefined) {
    out.additional_context = decision.additionalContext;
  }
  return out;
}

export function writeCodexHookResponse(decision: CodexHookDecision): number {
  const payload = renderCodexHookResponse(decision);
  if (Object.keys(payload).length > 0) {
    process.stdout.write(JSON.stringify(payload));
  }
  return 0;
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

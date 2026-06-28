import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";

import { evaluateBashCommand } from "../hooks/bash-write-policy.js";
import { buildOnboardingMessage } from "../hooks/onboarding-message.js";
import { EditLog } from "../state/edit-log.js";
import { createGrantsStore } from "../state/grants.js";
import { resolveRepoRoot } from "../utils/repo-paths.js";
import { evaluateCodexApplyPatch } from "./apply-patch-policy.js";
import {
  parseCodexHookPayload,
  renderCodexHookResponse,
  type CodexHookDecision,
} from "./hook-runtime.js";

const UNSUPPORTED_CODEX_RAW_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

export async function handleCodexHookPayload(
  payload: unknown,
  options: { now?: () => Date } = {},
): Promise<Record<string, unknown>> {
  const parsed = parseCodexHookPayload(payload);
  if (!parsed.ok) {
    return renderCodexHookResponse({
      decision: "deny",
      reason: parsed.error,
    });
  }

  const event = parsed.value;
  const repoRoot = resolveRepoRoot(event.cwd);

  if (event.hookEventName === "SessionStart") {
    return renderCodexHookResponse(handleSessionStart(payload, repoRoot));
  }

  const toolName = event.toolName ?? "";

  if (toolName === "Bash") {
    const command = typeof event.toolInput.command === "string"
      ? event.toolInput.command
      : "";
    return renderCodexHookResponse(
      evaluateBashCommand(command, {
        ...(event.cwd !== undefined ? { cwd: event.cwd } : {}),
        repoRoot,
      }),
    );
  }

  if (UNSUPPORTED_CODEX_RAW_WRITE_TOOLS.has(toolName)) {
    return renderCodexHookResponse({
      decision: "deny",
      reason:
        `Codex ${toolName} raw write payloads are unsupported by meta-edit; use apply_patch after a typed edit declaration`,
    });
  }

  if (
    toolName === "apply_patch"
  ) {
    const patch = extractPatchText(event.toolInput);
    if (!patch.ok) {
      return renderCodexHookResponse({
        decision: "deny",
        reason: patch.error,
      });
    }
    const grants = createGrantsStore(repoRoot);
    const log = new EditLog(repoRoot);
    return renderCodexHookResponse(
      await evaluateCodexApplyPatch({
        patch: patch.patch,
        repoRoot,
        grants,
        log,
        ...(options.now !== undefined ? { now: options.now } : {}),
      }),
    );
  }

  return renderCodexHookResponse({ decision: "allow" });
}

function handleSessionStart(
  payload: unknown,
  repoRoot: string,
): CodexHookDecision {
  const sessionId = sessionIdFromPayload(payload);
  if (sessionId === null) return { decision: "allow" };
  const source = sessionSourceFromPayload(payload);

  const markerPath = path.join(
    repoRoot,
    ".meta-edit",
    "state",
    "sessions",
    `${sessionMarkerKey(sessionId, source)}.json`,
  );
  if (!claimOnboardingMarker(markerPath, sessionId)) {
    return { decision: "allow" };
  }
  return {
    decision: "allow",
    additionalContext: buildOnboardingMessage(),
  };
}

function extractPatchText(
  input: Record<string, unknown>,
): { ok: true; patch: string } | { ok: false; error: string } {
  for (const key of ["patch", "input", "content", "text", "command", "cmd"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return { ok: true, patch: value };
    }
  }
  const fromFileChanges = patchFromFileChanges(input["fileChanges"]);
  if (fromFileChanges !== null) return fromFileChanges;
  return {
    ok: false,
    error:
      "Codex apply_patch payload did not include a patch string or fileChanges map",
  };
}

function patchFromFileChanges(
  value: unknown,
): { ok: true; patch: string } | { ok: false; error: string } | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Codex apply_patch fileChanges must be an object" };
  }

  const lines = ["*** Begin Patch"];
  for (const [file, change] of Object.entries(value as Record<string, unknown>)) {
    if (file.length === 0) {
      return {
        ok: false,
        error: "Codex apply_patch fileChanges contains an empty file path",
      };
    }
    if (/[\r\n]/u.test(file)) {
      return {
        ok: false,
        error:
          "Codex apply_patch fileChanges path contains CR/LF or newline header injection",
      };
    }
    if (typeof change !== "object" || change === null || Array.isArray(change)) {
      return {
        ok: false,
        error:
          `Codex apply_patch fileChanges entry for "${file}" must be an object`,
      };
    }
    const record = change as Record<string, unknown>;
    if (record["move_path"] !== undefined && record["move_path"] !== null) {
      return {
        ok: false,
        error:
          "apply_patch move/rename patches are not supported by meta-edit yet; declare and edit the final file explicitly",
      };
    }

    switch (record["type"]) {
      case "add":
        lines.push(`*** Add File: ${file}`);
        break;
      case "update":
        lines.push(`*** Update File: ${file}`);
        break;
      case "delete":
        lines.push(`*** Delete File: ${file}`);
        break;
      default:
        return {
          ok: false,
          error:
            `Codex apply_patch fileChanges entry for "${file}" has unsupported type`,
        };
    }
  }

  lines.push("*** End Patch", "");
  return { ok: true, patch: lines.join("\n") };
}

function sessionIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)["session_id"] ??
    (payload as Record<string, unknown>)["sessionId"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sessionSourceFromPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "startup";
  }
  const value = (payload as Record<string, unknown>)["source"];
  return typeof value === "string" && value.length > 0 ? value : "startup";
}

function sessionMarkerKey(sessionId: string, source: string): string {
  const sourceKey = source === "clear" || source === "compact" ? source : "session";
  return `${sourceKey}-${crypto.createHash("sha256").update(sessionId).digest("hex")}`;
}

function claimOnboardingMarker(markerPath: string, sessionId: string): boolean {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  } catch {
    return false;
  }
  try {
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          session_id: sessionId,
          ts: new Date().toISOString(),
        },
        null,
        2,
      ),
      { encoding: "utf8", flag: "wx" },
    );
    return true;
  } catch {
    return false;
  }
}

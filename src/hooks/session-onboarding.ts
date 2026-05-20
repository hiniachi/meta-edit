#!/usr/bin/env node
// SessionStart hook: first-touch onboarding for the typed_edit MCP
// surface. v0.3.1 (issue F).
//
// Mechanism: read session_id + cwd from the SessionStart event JSON.
// Check `.meta-edit/state/sessions/<session_id>.json` — if it exists,
// this session has already been onboarded, so we no-op. Otherwise
// write the marker and emit additionalContext pointing the agent at
// the `typed-edit-onboarding` Skill.
//
// Why a marker file: SessionStart fires every session, and we don't
// want to spam the agent's context with an onboarding pointer on
// every single start. Marker-file dedup is per-session (Claude Code
// session_ids are stable for the duration of a session) and survives
// process restarts within the same session.
//
// The marker file lives in `.meta-edit/state/sessions/`, a protected
// directory. Hook-internal writes are not subject to the typed-edit
// gate (the gate scopes to AGENT writes via tool_input); we write
// directly via fs.

import * as fs from "node:fs";
import * as path from "node:path";
import { readStdin, replyAllow } from "./hook-runtime.js";
import { resolveRepoRoot } from "../utils/repo-paths.js";

type SessionStartEvent = {
  session_id?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;
};

/**
 * Atomically claim the marker for this session_id. Returns true when
 * the caller successfully created the marker (this is the first
 * onboarding) and false when the marker already exists (another
 * process onboarded first).
 *
 * Uses `flag: "wx"` (O_EXCL | O_CREAT) so concurrent SessionStart
 * events for the same session_id can't both succeed. The losing call
 * sees EEXIST and returns false, suppressing the duplicate
 * additionalContext emission. Codex HIGH #5b: this is the
 * race-prevention move.
 */
function claimOnboardingMarker(markerPath: string, sessionId: string): boolean {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  } catch {
    // mkdir failure: degrade to "every session emits" — annoying but
    // correct. We still try the write below in case the dir does exist.
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
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EEXIST") {
      // Another process won the race (or this session already
      // onboarded in a prior run). Suppress the pointer emission.
      return false;
    }
    // Other errors (EACCES, EROFS, etc.): fail-quiet (don't onboard
    // repeatedly on permission errors). Returning false suppresses
    // the pointer; the session will just miss the recovery path this
    // run, which is a correctness-preserving degradation.
    return false;
  }
}

function buildOnboardingMessage(): string {
  return [
    "meta-edit MCP server is registered for this project. New session detected.",
    "",
    "Before your first edit, invoke the `typed-edit-onboarding` skill via the",
    "Skill tool to load the seventeen-tool catalog and selection heuristic.",
    "Empty file creation is free (no MCP declaration); content fills go through",
    "the appropriate edit_<TYPE> tool against the now-empty file. Use ToolSearch",
    "with `select:mcp__plugin_meta-edit_meta-edit__edit_<name>` to load any",
    "tool's schema on demand.",
  ].join("\n");
}

async function main(): Promise<number> {
  const event = (await readStdin()) as SessionStartEvent;

  const sessionId =
    typeof event.session_id === "string" && event.session_id.length > 0
      ? event.session_id
      : null;
  if (sessionId === null) {
    // No session_id — nothing to dedup against. Pass through silently.
    return replyAllow();
  }

  const repoRoot = resolveRepoRoot(
    typeof event.cwd === "string" ? event.cwd : undefined,
  );
  const markerPath = path.join(
    repoRoot,
    ".meta-edit",
    "state",
    "sessions",
    `${sessionId}.json`,
  );

  if (!claimOnboardingMarker(markerPath, sessionId)) {
    // Marker already existed (or could not be written) — another
    // process has onboarded this session, or the FS is read-only.
    // Either way, suppress the pointer emission to avoid duplicates.
    return replyAllow();
  }

  // Emit the pointer via SessionStart hookSpecificOutput.
  // additionalContext is the standard injection field for SessionStart
  // hooks per the Claude Code hook protocol.
  const payload = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: buildOnboardingMessage(),
    },
  };
  process.stdout.write(JSON.stringify(payload));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `session-onboarding hook crashed: ${(err as Error).message}\n`,
    );
    // Fail-open: SessionStart hooks must not block session boot. Exit 0.
    process.exit(0);
  },
);

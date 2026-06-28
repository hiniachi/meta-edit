import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { EditLog } from "../state/edit-log.js";
import { createGrantsStore } from "../state/grants.js";
import {
  cleanTmpRoot,
  makeTmpRoot,
  sha256Hex,
  writeFileIn,
} from "../test-helpers.js";

type CodexHookEntrypointModule = {
  handleCodexHookPayload(
    payload: unknown,
    options?: { now?: () => Date },
  ): Promise<Record<string, unknown>>;
};

const CODEX_HOOK_ENTRYPOINT_MODULE = "./hook-entrypoint.js";
const CODEX_DENY_RAW_EDIT_SOURCE = path.join(
  import.meta.dir,
  "deny-raw-edit.ts",
);
const CODEX_SESSION_ONBOARDING_SOURCE = path.join(
  import.meta.dir,
  "session-onboarding.ts",
);

async function loadCodexHookEntrypoint(): Promise<CodexHookEntrypointModule> {
  return (await import(CODEX_HOOK_ENTRYPOINT_MODULE)) as CodexHookEntrypointModule;
}

function updatePatch(file: string, oldLine = "before", newLine = "after"): string {
  return [
    "*** Begin Patch",
    `*** Update File: ${file}`,
    "@@",
    `-${oldLine}`,
    `+${newLine}`,
    "*** End Patch",
    "",
  ].join("\n");
}

async function runCodexDenyRawEdit(input: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const result = Bun.spawnSync({
    cmd: ["bun", CODEX_DENY_RAW_EDIT_SOURCE],
    cwd: import.meta.dir,
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function runCodexSessionOnboarding(input: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const result = Bun.spawnSync({
    cmd: ["bun", CODEX_SESSION_ONBOARDING_SOURCE],
    cwd: import.meta.dir,
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = makeTmpRoot("codex-hook-entrypoint");
  fs.mkdirSync(path.join(tmpRoot, ".git"));
});

afterEach(() => {
  cleanTmpRoot(tmpRoot);
});

describe("handleCodexHookPayload - PreToolUse apply_patch", () => {
  it("blocks unclassified apply_patch through the Codex response shape", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    writeFileIn(tmpRoot, "src/foo.ts", "before\n");

    const response = await handleCodexHookPayload({
      hook_event_name: "PreToolUse",
      cwd: tmpRoot,
      tool_name: "apply_patch",
      tool_input: {
        patch: updatePatch("src/foo.ts"),
      },
    });

    expect(response).toEqual({
      decision: "block",
      reason: expect.stringMatching(/typed_edit declaration|grant/i),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
  });

  it("allows a classified apply_patch with additional_context and consumes the grant", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    writeFileIn(tmpRoot, "src/foo.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0001",
      binding: [
        { file: "src/foo.ts", before_sha256: sha256Hex("before\n") },
      ],
      declaration: {
        kind: "edit_boundary_condition",
        target: "prod",
        provenance: "direct_observation",
        execution_state: "normal",
        target_file: "src/foo.ts",
        test_files: ["src/foo.test.ts"],
      },
    });

    const response = await handleCodexHookPayload(
      {
        hook_event_name: "PreToolUse",
        cwd: tmpRoot,
        tool_name: "apply_patch",
        tool_input: {
          patch: updatePatch("src/foo.ts"),
        },
      },
      { now: () => new Date("2026-06-17T01:02:03.000Z") },
    );

    expect(response).toEqual({
      additional_context: expect.stringContaining("meta-edit reminder:"),
    });
    expect(response).not.toHaveProperty("decision");
    expect(response).not.toHaveProperty("hookSpecificOutput");
    expect(await grants.lookup(grant.token_id)).toBeNull();
    expect(log.readAll().filter((entry) => entry.phase === "consumed")).toHaveLength(1);
  });

  it("allows classified apply_patch payloads carried in Codex command fields", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const cases = [
      {
        key: "command",
        file: "src/freeform-command.ts",
        editId: "edit_20260617_0007",
      },
      {
        key: "cmd",
        file: "src/freeform-cmd.ts",
        editId: "edit_20260617_0008",
      },
    ] as const;

    for (const { key, file, editId } of cases) {
      writeFileIn(tmpRoot, file, "before\n");
      const grant = await grants.issue({
        edit_id: editId,
        binding: [
          {
            file,
            before_sha256: sha256Hex("before\n"),
          },
        ],
        declaration: {
          kind: "edit_permission_logic",
          target: "prod",
          provenance: "direct_observation",
          execution_state: "normal",
          target_file: file,
          test_files: ["src/codex/hook-entrypoint.test.ts"],
        },
      });

      const toolInput: Record<string, unknown> = { [key]: updatePatch(file) };
      const response = await handleCodexHookPayload(
        {
          hook_event_name: "PreToolUse",
          cwd: tmpRoot,
          tool_name: "apply_patch",
          tool_input: toolInput,
        },
        { now: () => new Date("2026-06-17T01:02:03.000Z") },
      );

      expect(response).toEqual({
        additional_context: expect.stringContaining("meta-edit reminder:"),
      });
      expect(response).not.toHaveProperty("decision");
      expect(response).not.toHaveProperty("hookSpecificOutput");
      expect(await grants.lookup(grant.token_id)).toBeNull();
    }
    expect(log.readAll().filter((entry) => entry.phase === "consumed")).toHaveLength(
      cases.length,
    );
  });

  it("allows classified apply_patch fileChanges targets and consumes their grants", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    writeFileIn(tmpRoot, "tests/file-changes-existing.test.ts", "before\n");
    writeFileIn(tmpRoot, "tests/file-changes-delete.test.ts", "delete me\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0002",
      binding: [
        {
          file: "tests/file-changes-new.test.ts",
          before_sha256: sha256Hex(""),
        },
        {
          file: "tests/file-changes-existing.test.ts",
          before_sha256: sha256Hex("before\n"),
        },
        {
          file: "tests/file-changes-delete.test.ts",
          before_sha256: sha256Hex("delete me\n"),
        },
      ],
      declaration: {
        kind: "edit_api_contract",
        target: "test",
        provenance: "direct_observation",
        execution_state: "normal",
        target_file: "tests/file-changes-existing.test.ts",
        test_files: [],
      },
    });

    const response = await handleCodexHookPayload(
      {
        hook_event_name: "PreToolUse",
        cwd: tmpRoot,
        tool_name: "apply_patch",
        tool_input: {
          fileChanges: {
            "tests/file-changes-new.test.ts": {
              type: "add",
              content: "created\n",
              move_path: null,
            },
            "tests/file-changes-existing.test.ts": {
              type: "update",
              unified_diff: "@@\n-before\n+after\n",
              move_path: null,
            },
            "tests/file-changes-delete.test.ts": {
              type: "delete",
              move_path: null,
            },
          },
        },
      },
      { now: () => new Date("2026-06-17T01:02:03.000Z") },
    );

    expect(response).toEqual({
      additional_context: expect.stringContaining("meta-edit reminder:"),
    });
    expect(response).not.toHaveProperty("decision");
    expect(response).not.toHaveProperty("hookSpecificOutput");
    expect(await grants.lookup(grant.token_id)).toBeNull();
    const consumed = log.readAll().filter((entry) => entry.phase === "consumed");
    expect(consumed).toHaveLength(3);
    for (const entry of consumed) {
      if (entry.phase !== "consumed") throw new Error("expected consumed entry");
      expect(entry.edit_id).toBe("edit_20260617_0002");
      expect(entry.consuming_tool).toBe("apply_patch");
    }
  });

  it("blocks apply_patch fileChanges updates with move_path and consumes no grant", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    writeFileIn(tmpRoot, "tests/file-changes-move.test.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0003",
      binding: [
        {
          file: "tests/file-changes-move.test.ts",
          before_sha256: sha256Hex("before\n"),
        },
      ],
      declaration: {
        kind: "edit_api_contract",
        target: "test",
        provenance: "direct_observation",
        execution_state: "normal",
        target_file: "tests/file-changes-move.test.ts",
        test_files: [],
      },
    });

    const response = await handleCodexHookPayload({
      hook_event_name: "PreToolUse",
      cwd: tmpRoot,
      tool_name: "apply_patch",
      tool_input: {
        fileChanges: {
          "tests/file-changes-move.test.ts": {
            type: "update",
            unified_diff: "@@\n-before\n+after\n",
            move_path: "tests/file-changes-moved.test.ts",
          },
        },
      },
    });

    expect(response).toEqual({
      decision: "block",
      reason: expect.stringMatching(/move|rename|unsupported/i),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
    const after = await grants.lookup(grant.token_id);
    expect(after).not.toBeNull();
    expect(after?.consumed_files).toEqual([]);
    expect(log.readAll().filter((entry) => entry.phase === "consumed")).toHaveLength(0);
  });

  it("blocks fileChanges keys containing CR before consuming a matching grant", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    writeFileIn(tmpRoot, "tests/file-changes-cr.test.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0004",
      binding: [
        {
          file: "tests/file-changes-cr.test.ts",
          before_sha256: sha256Hex("before\n"),
        },
      ],
      declaration: {
        kind: "edit_api_contract",
        target: "test",
        provenance: "direct_observation",
        execution_state: "normal",
        target_file: "tests/file-changes-cr.test.ts",
        test_files: [],
      },
    });

    const response = await handleCodexHookPayload({
      hook_event_name: "PreToolUse",
      cwd: tmpRoot,
      tool_name: "apply_patch",
      tool_input: {
        fileChanges: {
          ["tests/file-changes-cr.test.ts\r"]: {
            type: "update",
            unified_diff: "@@\n-before\n+after\n",
            move_path: null,
          },
        },
      },
    });

    const after = await grants.lookup(grant.token_id);
    expect(after).not.toBeNull();
    expect(after?.consumed_files).toEqual([]);
    expect(log.readAll().filter((entry) => entry.phase === "consumed")).toHaveLength(0);
    expect(response).toEqual({
      decision: "block",
      reason: expect.stringMatching(/fileChanges|path|CR|LF|newline|header/i),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
  });

  it("blocks fileChanges patch-header injection before consuming any grant", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    writeFileIn(tmpRoot, "tests/file-changes-safe.test.ts", "safe\n");
    writeFileIn(tmpRoot, "tests/file-changes-victim.test.ts", "victim\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0005",
      binding: [
        {
          file: "tests/file-changes-safe.test.ts",
          before_sha256: sha256Hex("safe\n"),
        },
        {
          file: "tests/file-changes-victim.test.ts",
          before_sha256: sha256Hex("victim\n"),
        },
      ],
      declaration: {
        kind: "edit_api_contract",
        target: "test",
        provenance: "direct_observation",
        execution_state: "normal",
        target_file: "tests/file-changes-safe.test.ts",
        test_files: [],
      },
    });

    const response = await handleCodexHookPayload({
      hook_event_name: "PreToolUse",
      cwd: tmpRoot,
      tool_name: "apply_patch",
      tool_input: {
        fileChanges: {
          ["tests/file-changes-safe.test.ts\n*** Update File: tests/file-changes-victim.test.ts"]: {
            type: "update",
            unified_diff: "@@\n-safe\n+SAFE\n",
            move_path: null,
          },
        },
      },
    });

    const after = await grants.lookup(grant.token_id);
    expect(after).not.toBeNull();
    expect(after?.consumed_files).toEqual([]);
    expect(log.readAll().filter((entry) => entry.phase === "consumed")).toHaveLength(0);
    expect(response).toEqual({
      decision: "block",
      reason: expect.stringMatching(/fileChanges|path|CR|LF|newline|header/i),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
  });
});

describe("handleCodexHookPayload - PreToolUse raw writes", () => {
  it("blocks unsupported raw write tools and leaves apply_patch grants untouched", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    writeFileIn(tmpRoot, "src/write-target.ts", "before\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0006",
      binding: [
        {
          file: "src/write-target.ts",
          before_sha256: sha256Hex("before\n"),
        },
      ],
      declaration: {
        kind: "edit_boundary_condition",
        target: "test",
        provenance: "direct_observation",
        execution_state: "normal",
        target_file: "src/write-target.ts",
        test_files: [],
      },
    });

    const rawWriteCases: Array<{ toolName: string; toolInput: Record<string, unknown> }> = [
      {
        toolName: "Edit",
        toolInput: {
          file_path: "src/write-target.ts",
          old_string: "before",
          new_string: "after",
        },
      },
      {
        toolName: "Write",
        toolInput: {
          file_path: "src/write-target.ts",
          content: "after\n",
        },
      },
      {
        toolName: "MultiEdit",
        toolInput: {
          file_path: "src/write-target.ts",
          edits: [{ old_string: "before", new_string: "after" }],
        },
      },
      {
        toolName: "NotebookEdit",
        toolInput: {
          notebook_path: "src/write-target.ts",
          new_source: "after",
        },
      },
    ];

    for (const { toolName, toolInput } of rawWriteCases) {
      const response = await handleCodexHookPayload({
        hook_event_name: "PreToolUse",
        cwd: tmpRoot,
        tool_name: toolName,
        tool_input: toolInput,
      });

      expect(response["decision"]).toBe("block");
      expect(response["reason"]).toEqual(expect.stringContaining(toolName));
      expect(response["reason"]).toEqual(expect.stringMatching(/raw write|unsupported/i));
      if (typeof response["reason"] === "string") {
        expect(response["reason"]).not.toMatch(/apply_patch payload|Begin Patch|End Patch|file targets/i);
      }
      expect(response).not.toHaveProperty("hookSpecificOutput");
    }
    const after = await grants.lookup(grant.token_id);
    expect(after).not.toBeNull();
    expect(after?.consumed_files).toEqual([]);
    expect(log.readAll().filter((entry) => entry.phase === "consumed")).toHaveLength(0);
  });
});

describe("deny-raw-edit CLI fallback", () => {
  it("blocks malformed JSON stdin using the Codex hook response shape", async () => {
    const result = await runCodexDenyRawEdit("{ malformed json");

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const response = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(response).toEqual({
      decision: "block",
      reason: expect.stringMatching(/crash|invalid|json/i),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
    expect(typeof response["reason"]).toBe("string");
    expect((response["reason"] as string).length).toBeGreaterThan(0);
  });
});

describe("session-onboarding CLI fallback", () => {
  it("blocks malformed JSON stdin using the Codex hook response shape", async () => {
    const result = await runCodexSessionOnboarding("{ malformed json");

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const response = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(response).toEqual({
      decision: "block",
      reason: expect.stringMatching(/crash|invalid|json/i),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
    expect(typeof response["reason"]).toBe("string");
    expect((response["reason"] as string).length).toBeGreaterThan(0);
  });
});

describe("handleCodexHookPayload - PreToolUse Bash", () => {
  it("routes Bash commands through the existing bash write policy", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();

    const response = await handleCodexHookPayload({
      hook_event_name: "PreToolUse",
      cwd: tmpRoot,
      tool_name: "Bash",
      tool_input: {
        command: "sed -i 's/before/after/' src/foo.ts",
      },
    });

    expect(response).toEqual({
      decision: "block",
      reason: expect.stringMatching(/sed -i|typed edit|edit_/i),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
  });

  it("uses the raw event cwd for symlink-aware protected-path redirects", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    const subdir = path.join(tmpRoot, "pkg");
    fs.mkdirSync(subdir, { recursive: true });
    fs.symlinkSync("../.meta-edit", path.join(subdir, "meta"));

    const response = await handleCodexHookPayload({
      hook_event_name: "PreToolUse",
      cwd: subdir,
      tool_name: "Bash",
      tool_input: {
        command: "printf '%s' hi > meta/state/edits.jsonl",
      },
    });

    expect(response).toEqual({
      decision: "block",
      reason: expect.stringMatching(/protected|meta-edit|symlink/i),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
  });
});

describe("handleCodexHookPayload - SessionStart onboarding", () => {
  it("emits onboarding context once per session using Codex additional_context", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();
    const payload = {
      hook_event_name: "SessionStart",
      cwd: tmpRoot,
      session_id: "codex-session-1",
    };

    const first = await handleCodexHookPayload(payload);
    expect(first).toEqual({
      additional_context: expect.stringContaining("typed-edit-onboarding"),
    });
    expect(first).not.toHaveProperty("hookSpecificOutput");

    const second = await handleCodexHookPayload(payload);
    expect(second).toEqual({});
  });

  it("does not write a traversal session marker outside the sessions directory", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();

    const response = await handleCodexHookPayload({
      hook_event_name: "SessionStart",
      cwd: tmpRoot,
      session_id: "../outside-session-marker",
    });

    expect(response).toEqual({
      additional_context: expect.stringContaining("typed-edit-onboarding"),
    });
    expect(response).not.toHaveProperty("hookSpecificOutput");
    expect(
      fs.existsSync(
        path.join(tmpRoot, ".meta-edit", "state", "outside-session-marker.json"),
      ),
    ).toBe(false);
    const sessionsDir = path.join(tmpRoot, ".meta-edit", "state", "sessions");
    expect(fs.existsSync(sessionsDir)).toBe(true);
    expect(fs.readdirSync(sessionsDir)).toHaveLength(1);
  });

  it("emits onboarding again for clear and compact starts with a repeated session id", async () => {
    const { handleCodexHookPayload } = await loadCodexHookEntrypoint();

    for (const source of ["clear", "compact"]) {
      const sessionId = `codex-session-repeat-${source}`;
      const startup = await handleCodexHookPayload({
        hook_event_name: "SessionStart",
        cwd: tmpRoot,
        session_id: sessionId,
        source: "startup",
      });
      expect(startup).toEqual({
        additional_context: expect.stringContaining("typed-edit-onboarding"),
      });

      const repeated = await handleCodexHookPayload({
        hook_event_name: "SessionStart",
        cwd: tmpRoot,
        session_id: sessionId,
        source,
      });
      expect(repeated).toEqual({
        additional_context: expect.stringContaining("typed-edit-onboarding"),
      });
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { EditLog, type ConsumedEntry } from "../state/edit-log.js";
import { renderCodexHookResponse } from "./hook-runtime.js";
import {
  createGrantsStore,
  type Grant,
  type GrantsStore,
} from "../state/grants.js";
import { makeIssuingHandler } from "../tools/apply.js";
import {
  type EditToolRequest,
  type ValidationContext,
} from "../tools/common.js";
import {
  cleanTmpRoot,
  makeTmpRoot,
  sha256Hex,
  writeFileIn,
} from "../test-helpers.js";

type ApplyPatchTarget = {
  operation: "add" | "update" | "delete";
  path: string;
};

type ApplyPatchExtractResult =
  | { ok: true; targets: ApplyPatchTarget[] }
  | { ok: false; error: string };

type ApplyPatchDecision = {
  decision: "allow" | "deny" | "warn";
  reason?: string;
  additionalContext?: string;
};

type CodexApplyPatchPolicyModule = {
  extractApplyPatchTargets(patch: string): ApplyPatchExtractResult;
  evaluateCodexApplyPatch(args: {
    patch: string;
    repoRoot: string;
    grants: GrantsStore;
    log: EditLog;
    now?: () => Date;
  }): Promise<ApplyPatchDecision>;
};

async function loadApplyPatchPolicy(): Promise<CodexApplyPatchPolicyModule> {
  return (await import("./apply-patch-policy.js")) as CodexApplyPatchPolicyModule;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = makeTmpRoot("codex-apply-patch");
  fs.mkdirSync(path.join(tmpRoot, ".git"));
});

afterEach(() => {
  cleanTmpRoot(tmpRoot);
});

function writeFile(rel: string, content: string): string {
  return writeFileIn(tmpRoot, rel, content);
}

function updatePatch(file: string, oldLine = "old", newLine = "new"): string {
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

function grantFixture(args: {
  token_id: string;
  edit_id: string;
  file: string;
  before_sha256: string;
}): Grant {
  return {
    token_id: args.token_id,
    edit_id: args.edit_id,
    issued_at: "2026-06-17T00:00:00.000Z",
    expires_at: "2026-06-17T00:10:00.000Z",
    binding: [
      { file: args.file, before_sha256: args.before_sha256 },
    ],
    consumed_files: [],
  };
}

describe("extractApplyPatchTargets", () => {
  it("extracts add/update/delete targets in patch order", async () => {
    const { extractApplyPatchTargets } = await loadApplyPatchPolicy();

    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const created = true;",
      "*** Update File: src/existing.ts",
      "@@",
      "-old",
      "+new",
      "*** Delete File: docs/old.md",
      "*** End Patch",
      "",
    ].join("\n");

    expect(extractApplyPatchTargets(patch)).toEqual({
      ok: true,
      targets: [
        { operation: "add", path: "src/new.ts" },
        { operation: "update", path: "src/existing.ts" },
        { operation: "delete", path: "docs/old.md" },
      ],
    });
  });

  it("rejects move/rename patches in the first Codex migration", async () => {
    const { extractApplyPatchTargets } = await loadApplyPatchPolicy();

    const patch = [
      "*** Begin Patch",
      "*** Update File: src/old.ts",
      "*** Move to: src/new.ts",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
      "",
    ].join("\n");

    const result = extractApplyPatchTargets(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/move|rename/i);
  });

  it("rejects a patch with no file targets", async () => {
    const { extractApplyPatchTargets } = await loadApplyPatchPolicy();

    const result = extractApplyPatchTargets([
      "*** Begin Patch",
      "*** End Patch",
      "",
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/target/i);
  });

  it("ignores apply_patch-looking headers after the End Patch footer", async () => {
    const { extractApplyPatchTargets } = await loadApplyPatchPolicy();

    const result = extractApplyPatchTargets([
      "*** Begin Patch",
      "*** Update File: src/real.ts",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
      "*** Update File: src/trailing.ts",
      "*** Move to: src/renamed.ts",
      "",
    ].join("\n"));

    expect(result).toEqual({
      ok: true,
      targets: [
        { operation: "update", path: "src/real.ts" },
      ],
    });
  });

  it("rejects a payload whose only target-like header appears after End Patch", async () => {
    const { extractApplyPatchTargets } = await loadApplyPatchPolicy();

    const result = extractApplyPatchTargets([
      "*** Begin Patch",
      "*** End Patch",
      "*** Update File: src/outside-body.ts",
      "",
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/target/i);
  });
});

describe("evaluateCodexApplyPatch", () => {
  it("preflights every file in a multi-file grant before consuming any binding", async () => {
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    writeFile("docs/a.md", "alpha\n");
    writeFile("docs/b.md", "beta\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0001",
      binding: [
        { file: "docs/a.md", before_sha256: sha256Hex("alpha\n") },
        { file: "docs/b.md", before_sha256: sha256Hex("beta\n") },
      ],
    });

    writeFile("docs/b.md", "drifted\n");
    const patch = [
      "*** Begin Patch",
      "*** Update File: docs/a.md",
      "@@",
      "-alpha",
      "+ALPHA",
      "*** Update File: docs/b.md",
      "@@",
      "-beta",
      "+BETA",
      "*** End Patch",
      "",
    ].join("\n");

    const decision = await evaluateCodexApplyPatch({
      patch,
      repoRoot: tmpRoot,
      grants,
      log,
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toMatch(/drift|before_sha256|preflight/i);
    const after = await grants.lookup(grant.token_id);
    expect(after).not.toBeNull();
    expect(after?.consumed_files).toEqual([]);
    expect(log.readAll()).toEqual([]);
  });

  it("allows a multi-file apply_patch only when every target has an active matching grant", async () => {
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    writeFile("docs/a.md", "alpha\n");
    writeFile("docs/b.md", "beta\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0002",
      binding: [
        { file: "docs/a.md", before_sha256: sha256Hex("alpha\n") },
        { file: "docs/b.md", before_sha256: sha256Hex("beta\n") },
      ],
    });

    const patch = [
      "*** Begin Patch",
      "*** Update File: docs/a.md",
      "@@",
      "-alpha",
      "+ALPHA",
      "*** Update File: docs/b.md",
      "@@",
      "-beta",
      "+BETA",
      "*** End Patch",
      "",
    ].join("\n");

    const decision = await evaluateCodexApplyPatch({
      patch,
      repoRoot: tmpRoot,
      grants,
      log,
      now: () => new Date("2026-06-17T01:02:03.000Z"),
    });

    expect(decision.decision).toBe("allow");
    expect(await grants.lookup(grant.token_id)).toBeNull();
    const consumed = log.readAll().filter((entry) => entry.phase === "consumed");
    expect(consumed.length).toBe(2);
    for (const entry of consumed) {
      if (entry.phase !== "consumed") throw new Error("expected consumed");
      expect(entry.edit_id).toBe("edit_20260617_0002");
      expect(entry.consuming_tool).toBe("apply_patch");
    }
  });

  it("denies protected .meta-edit targets before looking for grants", async () => {
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);

    const decision = await evaluateCodexApplyPatch({
      patch: updatePatch(".meta-edit/state/grants/forged.json", "{}", "{}"),
      repoRoot: tmpRoot,
      grants,
      log,
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toMatch(/protected|\.meta-edit/i);
    expect(log.readAll()).toEqual([]);
  });

  it("denies an existing leaf symlink into .meta-edit/state before consuming a matching grant", async () => {
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    writeFile(".meta-edit/state/edits.jsonl", "old\n");
    fs.symlinkSync(
      path.join(tmpRoot, ".meta-edit", "state", "edits.jsonl"),
      path.join(tmpRoot, "notes.md"),
    );
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0004",
      binding: [
        {
          file: ".meta-edit/state/edits.jsonl",
          before_sha256: sha256Hex("old\n"),
        },
      ],
    });

    const decision = await evaluateCodexApplyPatch({
      patch: updatePatch("notes.md", "old", "new"),
      repoRoot: tmpRoot,
      grants,
      log,
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toMatch(/protected|\.meta-edit/i);
    const after = await grants.lookup(grant.token_id);
    expect(after).not.toBeNull();
    expect(after?.consumed_files).toEqual([]);
    expect(log.readAll()).toEqual([]);
  });

  it("denies a dangling leaf symlink into .meta-edit/state before consuming a grant", async () => {
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    fs.symlinkSync(
      path.join(tmpRoot, ".meta-edit", "state", "future.jsonl"),
      path.join(tmpRoot, "dangling-notes.md"),
    );
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0005",
      binding: [
        {
          file: "dangling-notes.md",
          before_sha256: sha256Hex(""),
        },
      ],
    });

    const decision = await evaluateCodexApplyPatch({
      patch: updatePatch("dangling-notes.md", "", "new"),
      repoRoot: tmpRoot,
      grants,
      log,
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toMatch(/protected|\.meta-edit/i);
    const after = await grants.lookup(grant.token_id);
    expect(after).not.toBeNull();
    expect(after?.consumed_files).toEqual([]);
    expect(log.readAll()).toEqual([]);
  });

  it("denies when one apply_patch target lacks a grant and consumes none of the covered targets", async () => {
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    writeFile("src/covered.ts", "covered\n");
    writeFile("src/uncovered.ts", "uncovered\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const grant = await grants.issue({
      edit_id: "edit_20260617_0003",
      binding: [
        { file: "src/covered.ts", before_sha256: sha256Hex("covered\n") },
      ],
    });

    const patch = [
      "*** Begin Patch",
      "*** Update File: src/covered.ts",
      "@@",
      "-covered",
      "+COVERED",
      "*** Update File: src/uncovered.ts",
      "@@",
      "-uncovered",
      "+UNCOVERED",
      "*** End Patch",
      "",
    ].join("\n");

    const decision = await evaluateCodexApplyPatch({
      patch,
      repoRoot: tmpRoot,
      grants,
      log,
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toMatch(/no active typed_edit declaration|grant/i);
    const after = await grants.lookup(grant.token_id);
    expect(after).not.toBeNull();
    expect(after?.consumed_files).toEqual([]);
    expect(log.readAll()).toEqual([]);
  });

  it("does not return deny after a consume-stage failure once an earlier target was consumed and logged", async () => {
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    writeFile("src/a.ts", "alpha\n");
    writeFile("src/b.ts", "beta\n");
    const appended: ConsumedEntry[] = [];
    const aGrant = grantFixture({
      token_id: "met_20260617_aaaaaaaaaa",
      edit_id: "edit_20260617_0006",
      file: "src/a.ts",
      before_sha256: sha256Hex("alpha\n"),
    });
    const bGrant = grantFixture({
      token_id: "met_20260617_bbbbbbbbbb",
      edit_id: "edit_20260617_0007",
      file: "src/b.ts",
      before_sha256: sha256Hex("beta\n"),
    });
    const matches = new Map([
      ["src/a.ts", { grant: aGrant, binding: aGrant.binding[0]! }],
      ["src/b.ts", { grant: bGrant, binding: bGrant.binding[0]! }],
    ]);
    const grants: GrantsStore = {
      issue: async () => {
        throw new Error("not used");
      },
      lookup: async () => null,
      consume: async (_token_id, file_path) => {
        if (file_path === "src/a.ts") {
          return { consumed: true, fully_consumed: true };
        }
        return {
          consumed: false,
          fully_consumed: false,
          error: "simulated consume race",
        };
      },
      findActiveBindingForFile: async (canonicalFile) =>
        matches.get(canonicalFile) ?? null,
      reapExpired: async () => 0,
    };
    const log = {
      appendConsumed(entry: ConsumedEntry) {
        appended.push(entry);
      },
    } as unknown as EditLog;

    const decision = await evaluateCodexApplyPatch({
      patch: [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        "-alpha",
        "+ALPHA",
        "*** Update File: src/b.ts",
        "@@",
        "-beta",
        "+BETA",
        "*** End Patch",
        "",
      ].join("\n"),
      repoRoot: tmpRoot,
      grants,
      log,
      now: () => new Date("2026-06-17T02:03:04.000Z"),
    });

    expect(appended.map((entry) => entry.edit_id)).toEqual([
      "edit_20260617_0006",
    ]);
    expect(decision.decision).toBe("warn");
    expect(decision.reason).toMatch(/partial|consume/i);
  });

  it("renders a partial-consume warn without duplicating the marker or claiming the write was blocked", async () => {
    // Observed by reading apply-patch-policy.ts (partial-consume warn branch)
    // together with hook-runtime.ts renderCodexHookResponse: the warn branch
    // embeds `reason` inside `additionalContext`, then the renderer joins
    // [reason, additionalContext], so the [meta-edit:partial-consume] marker
    // leaks into the rendered additional_context twice; the reason also says
    // "blocking the write" even though a warn allows the patch to proceed.
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    writeFile("src/a.ts", "alpha\n");
    writeFile("src/b.ts", "beta\n");
    const appended: ConsumedEntry[] = [];
    const aGrant = grantFixture({
      token_id: "met_20260617_aaaaaaaaaa",
      edit_id: "edit_20260617_0006",
      file: "src/a.ts",
      before_sha256: sha256Hex("alpha\n"),
    });
    const bGrant = grantFixture({
      token_id: "met_20260617_bbbbbbbbbb",
      edit_id: "edit_20260617_0007",
      file: "src/b.ts",
      before_sha256: sha256Hex("beta\n"),
    });
    const matches = new Map([
      ["src/a.ts", { grant: aGrant, binding: aGrant.binding[0]! }],
      ["src/b.ts", { grant: bGrant, binding: bGrant.binding[0]! }],
    ]);
    const grants: GrantsStore = {
      issue: async () => {
        throw new Error("not used");
      },
      lookup: async () => null,
      consume: async (_token_id, file_path) => {
        if (file_path === "src/a.ts") {
          return { consumed: true, fully_consumed: true };
        }
        return {
          consumed: false,
          fully_consumed: false,
          error: "simulated consume race",
        };
      },
      findActiveBindingForFile: async (canonicalFile) =>
        matches.get(canonicalFile) ?? null,
      reapExpired: async () => 0,
    };
    const log = {
      appendConsumed(entry: ConsumedEntry) {
        appended.push(entry);
      },
    } as unknown as EditLog;

    const decision = await evaluateCodexApplyPatch({
      patch: [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        "-alpha",
        "+ALPHA",
        "*** Update File: src/b.ts",
        "@@",
        "-beta",
        "+BETA",
        "*** End Patch",
        "",
      ].join("\n"),
      repoRoot: tmpRoot,
      grants,
      log,
      now: () => new Date("2026-06-17T02:03:04.000Z"),
    });

    expect(decision.decision).toBe("warn");

    const rendered = renderCodexHookResponse(decision);
    const additionalContext = rendered.additional_context as string;
    expect(additionalContext.split("[meta-edit:partial-consume]").length - 1).toBe(
      1,
    );
    expect(additionalContext).not.toContain("blocking the write");
  });

  it("allows a typed declaration followed by Codex apply_patch and records issued plus consumed", async () => {
    const { evaluateCodexApplyPatch } = await loadApplyPatchPolicy();
    writeFile("tests/foo.test.ts", "old assertion\n");
    const ctx: ValidationContext = { repoRoot: tmpRoot };
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const handler = makeIssuingHandler({ ctx, grants, log });

    const declaration: EditToolRequest = {
      target_file: "tests/foo.test.ts",
      rationale: "tighten the regression assertion observed in the test",
      risk_level: "medium",
      target: "test",
      provenance: "direct_observation",
      execution_state: "normal",
      test_files: [],
    };
    const issued = await handler("edit_boundary_condition", declaration);
    expect(issued.token).toMatch(/^met_/);

    const decision = await evaluateCodexApplyPatch({
      patch: updatePatch("tests/foo.test.ts", "old assertion", "new assertion"),
      repoRoot: tmpRoot,
      grants,
      log,
    });

    expect(decision.decision).toBe("allow");
    expect(await grants.lookup(issued.token)).toBeNull();
    const entries = log.readAll();
    expect(entries.map((entry) => entry.phase)).toEqual(["issued", "consumed"]);
    const consumed = entries[1];
    expect(consumed?.phase).toBe("consumed");
    if (consumed?.phase === "consumed") {
      expect(consumed.edit_id).toBe(issued.edit_id);
      expect(consumed.consuming_tool).toBe("apply_patch");
    }
  });
});

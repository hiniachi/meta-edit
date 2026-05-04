// Case C / v0.2 issuing-handler integration tests.
//
// Exercises the thin grant-issuer pipeline assembled in apply.ts:
//   typed_edit MCP call
//     -> validateRequest (common.ts)
//     -> grants.issue                    (state/grants.ts)
//     -> appendIssued / appendRejected   (state/edit-log.ts)
//     -> EditToolResult { token, expires_at, edit_id, warnings, audit_error? }
//
// The deny-raw-edit hook consumes the token; that flow is exercised
// elsewhere. Here we only check that a successful declaration leaves the
// system in the shape the hook expects.
//
// v0.2.1: client-supplied sha256 fields removed. The server reads disk and
// computes before_sha256 itself; tests below verify that the binding's
// before_sha256 matches the on-disk content at declaration time.

import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeIssuingHandler } from "./apply.js";
import {
  SHA256_EMPTY,
  sha256Hex,
  type EditToolRequest,
  type ValidationContext,
} from "./common.js";
import { EditLog } from "../state/edit-log.js";
import { createGrantsStore } from "../state/grants.js";
import type { ToolName } from "./descriptions.js";
import { makeTmpRoot, cleanTmpRoot, writeFileIn } from "../test-helpers.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = makeTmpRoot("handler");
  fs.mkdirSync(path.join(tmpRoot, ".git"));
});

afterEach(() => {
  cleanTmpRoot(tmpRoot);
});

function writeFile(rel: string, content: string): void {
  writeFileIn(tmpRoot, rel, content);
}

function makeHandler(): {
  handler: ReturnType<typeof makeIssuingHandler>;
  log: EditLog;
  grants: ReturnType<typeof createGrantsStore>;
} {
  const ctx: ValidationContext = { repoRoot: tmpRoot };
  const log = new EditLog(tmpRoot);
  const grants = createGrantsStore(tmpRoot);
  const handler = makeIssuingHandler({ ctx, log, grants });
  return { handler, log, grants };
}

function modifyRequest(overrides: Partial<EditToolRequest> = {}): EditToolRequest {
  return {
    target_file: "src/foo.ts",
    rationale: "fix off-by-one in the boundary check",
    risk_level: "medium",
    test_files: ["tests/foo.test.ts"],
    ...overrides,
  };
}

describe("makeIssuingHandler — successful declaration", () => {
  it("issues a token, writes an `issued` log record, and persists the grant", async () => {
    writeFile("src/foo.ts", "hello\n");
    const { handler, log, grants } = makeHandler();

    const result = await handler(
      "edit_boundary_condition",
      modifyRequest(),
    );

    expect(result.warnings).toEqual([]);
    expect(result.audit_error).toBeUndefined();
    expect(result.token).toMatch(/^met_\d{8}_[0-9a-f]{10}$/);
    expect(result.edit_id).toMatch(/^edit_\d{8}_\d{4}$/);
    expect(typeof result.expires_at).toBe("string");
    expect(result.expires_at.length).toBeGreaterThan(0);

    // v0.2.2: next_action is populated whenever a token is issued so the
    // agent gets a friendly reminder that the next native Edit / Write /
    // MultiEdit call will be authorized automatically (SPEC §3 / Article
    // 4 — server-handled bookkeeping). The message no longer references
    // `_meta_edit_token` because Claude Code's strict input schema rejects
    // extra fields; the hook resolves the declaration server-side.
    expect(typeof result.next_action).toBe("string");
    expect(result.next_action!.length).toBeGreaterThan(0);
    expect(result.next_action).not.toContain("_meta_edit_token");
    expect(result.next_action).toContain(result.expires_at);

    // Grant is queryable.
    const grant = await grants.lookup(result.token);
    expect(grant).not.toBeNull();
    expect(grant?.binding.length).toBe(1);
    expect(grant?.binding[0]?.file).toBe("src/foo.ts");
    // Server computed before_sha256 from disk.
    expect(grant?.binding[0]?.before_sha256).toBe(sha256Hex("hello\n"));

    // Edit log carries the matching `issued` entry.
    const entries = log.readAll();
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.phase).toBe("issued");
    if (entry.phase === "issued") {
      expect(entry.edit_id).toBe(result.edit_id);
      expect(entry.kind).toBe("edit_boundary_condition");
      expect(entry.token).toBe(result.token);
      expect(entry.binding[0]?.file).toBe("src/foo.ts");
      expect(entry.binding[0]?.before_sha256).toBe(sha256Hex("hello\n"));
    }
  });

  it("writes binding[].before_sha256 reflecting the disk state at declaration time", async () => {
    writeFile("src/foo.ts", "INITIAL CONTENT\n");
    const { handler, grants } = makeHandler();
    const result = await handler("edit_boundary_condition", modifyRequest());
    const grant = await grants.lookup(result.token);
    expect(grant?.binding[0]?.before_sha256).toBe(sha256Hex("INITIAL CONTENT\n"));

    // Mutate disk after issuance — the grant's recorded before_sha256 must
    // remain the issue-time value (the hook re-reads disk to detect drift).
    writeFile("src/foo.ts", "DRIFTED\n");
    const grant2 = await grants.lookup(result.token);
    expect(grant2?.binding[0]?.before_sha256).toBe(
      sha256Hex("INITIAL CONTENT\n"),
    );
  });
});

describe("makeIssuingHandler — validation rejection", () => {
  async function expectRejection(
    tool: ToolName,
    request: EditToolRequest,
    matcher: (warnings: string[]) => boolean,
  ): Promise<void> {
    const { handler, log } = makeHandler();
    const result = await handler(tool, request);
    expect(result.token).toBe("");
    expect(result.expires_at).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(matcher(result.warnings)).toBe(true);
    // v0.2.1: rejection MUST omit next_action — there is no token to bind.
    expect(result.next_action).toBeUndefined();

    // No grant persisted.
    const grantsDir = path.join(tmpRoot, ".meta-edit", "state", "grants");
    if (fs.existsSync(grantsDir)) {
      const files = fs.readdirSync(grantsDir);
      expect(files.length).toBe(0);
    }

    // edit_log carries a `rejected` entry referencing the same edit_id.
    const entries = log.readAll();
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.phase).toBe("rejected");
    if (entry.phase === "rejected") {
      expect(entry.edit_id).toBe(result.edit_id);
      expect(entry.audit_error.length).toBeGreaterThan(0);
    }
  }

  it("rejects empty rationale", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({ rationale: "   " }),
      (w) => w.some((s) => s.includes("rationale")),
    );
  });

  it("rejects empty test_files for an SQLite-derived tool", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({ test_files: [] }),
      (w) => w.some((s) => s.includes("test_files")),
    );
  });

  it("rejects non-empty test_files for edit_test_only_change", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_test_only_change",
      modifyRequest({ test_files: ["tests/foo.test.ts"] }),
      (w) => w.some((s) => s.includes("test_files")),
    );
  });

  it("rejects modify-only call when target file does not exist on disk", async () => {
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({ target_file: "src/missing.ts" }),
      (w) => w.some((s) => s.includes("does not exist")),
    );
  });

  // v0.3.1 removal: edit_create_file is gone. Empty file creation is
  // hook-free (deny-raw-edit allows content === "" Write to a non-
  // existent in-repo path). Content fills run against the now-empty
  // file via the appropriate type-specific tool. The 2 handler tests
  // that asserted edit_create_file's already-exists rejection and
  // sha256("") binding accept were dropped along with the tool.

  it("rejects target_file outside the repo", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({ target_file: "../escape.ts" }),
      (w) => w.some((s) => /traversal|escapes|invalid/i.test(s)),
    );
  });

  it("rejects target_file in a protected path", async () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    writeFile(".meta-edit/state/garbage.txt", "x");
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({ target_file: ".meta-edit/state/garbage.txt" }),
      (w) => w.some((s) => /protected/.test(s)),
    );
  });
});

describe("makeIssuingHandler — additional_files gate (17 vs 2)", () => {
  it("rejects additional_files on the 17 SQLite-derived tools", async () => {
    writeFile("src/foo.ts", "hello\n");
    writeFile("src/bar.ts", "world\n");
    const { handler, log } = makeHandler();
    const result = await handler(
      "edit_boundary_condition",
      modifyRequest({
        additional_files: [{ file: "src/bar.ts" }],
      }),
    );
    expect(result.token).toBe("");
    expect(result.warnings.some((w) => w.includes("additional_files"))).toBe(true);
    const entries = log.readAll();
    expect(entries[0]?.phase).toBe("rejected");
  });

  it("accepts additional_files on edit_docs_only and binds every entry", async () => {
    writeFile("docs/a.md", "alpha\n");
    writeFile("docs/b.md", "beta\n");
    writeFile("docs/c.md", "gamma\n");
    const { handler, grants } = makeHandler();
    const result = await handler(
      "edit_docs_only",
      {
        target_file: "docs/a.md",
        rationale: "rename product across the docs",
        risk_level: "low",
        test_files: [],
        additional_files: [{ file: "docs/b.md" }, { file: "docs/c.md" }],
      },
    );
    expect(result.warnings).toEqual([]);
    expect(result.token.length).toBeGreaterThan(0);
    const grant = await grants.lookup(result.token);
    expect(grant?.binding.map((b) => b.file).sort()).toEqual(
      ["docs/a.md", "docs/b.md", "docs/c.md"],
    );
    // Each binding's before_sha256 reflects per-file disk content.
    const byFile = new Map(grant!.binding.map((b) => [b.file, b.before_sha256]));
    expect(byFile.get("docs/a.md")).toBe(sha256Hex("alpha\n"));
    expect(byFile.get("docs/b.md")).toBe(sha256Hex("beta\n"));
    expect(byFile.get("docs/c.md")).toBe(sha256Hex("gamma\n"));
  });

  it("rejects edit_docs_only when an additional_files entry does not exist", async () => {
    writeFile("docs/a.md", "alpha\n");
    const { handler } = makeHandler();
    const additional = [];
    for (let i = 0; i < 32; i++) {
      additional.push({ file: `docs/extra${i}.md` });
    }
    const result = await handler("edit_docs_only", {
      target_file: "docs/a.md",
      rationale: "...",
      risk_level: "low",
      test_files: [],
      additional_files: additional,
    });
    // 32 entries do not exist on disk; for edit_docs_only that's a modify-
    // only target so each missing file produces a warning.
    expect(result.token).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("makeIssuingHandler — grants.issue failure", () => {
  it("returns empty token and audit_error when grants.issue throws", async () => {
    writeFile("src/foo.ts", "hello\n");
    const ctx: ValidationContext = { repoRoot: tmpRoot };
    const log = new EditLog(tmpRoot);
    const failingGrants = {
      async issue() {
        throw new Error("simulated disk full");
      },
      async lookup() { return null; },
      async consume() { return { consumed: false, fully_consumed: false }; },
      async findActiveBindingForFile() { return null; },
      async reapExpired() { return 0; },
    };
    const handler = makeIssuingHandler({ ctx, log, grants: failingGrants as ReturnType<typeof createGrantsStore> });
    const result = await handler("edit_boundary_condition", modifyRequest());
    expect(result.token).toBe("");
    expect(result.warnings.some((w) => w.includes("grants.issue failed"))).toBe(true);
    expect(result.audit_error).toContain("grants.issue failed");
    expect(result.audit_error).toContain("simulated disk full");
  });
});

describe("makeIssuingHandler — edit log append failures", () => {
  it("returns audit_error when appendIssued throws (persistence failure)", async () => {
    writeFile("src/foo.ts", "hello\n");
    const ctx: ValidationContext = { repoRoot: tmpRoot };
    const log = new EditLog(tmpRoot);
    const grants = createGrantsStore(tmpRoot);
    const originalAppend = log.appendIssued.bind(log);
    let callCount = 0;
    log.appendIssued = (entry: Parameters<typeof log.appendIssued>[0]) => {
      callCount++;
      throw new Error("simulated ENOSPC");
    };
    const handler = makeIssuingHandler({ ctx, log, grants });
    const result = await handler("edit_boundary_condition", modifyRequest());
    expect(callCount).toBe(1);
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.audit_error).toContain("failed to append edit log entry");
    expect(result.audit_error).toContain("simulated ENOSPC");
  });

  it("returns audit_error when appendRejected throws (double failure)", async () => {
    const ctx: ValidationContext = { repoRoot: tmpRoot };
    const log = new EditLog(tmpRoot);
    const grants = createGrantsStore(tmpRoot);
    log.appendRejected = () => {
      throw new Error("simulated write error");
    };
    const handler = makeIssuingHandler({ ctx, log, grants });
    const result = await handler(
      "edit_boundary_condition",
      modifyRequest({ rationale: "   " }),
    );
    expect(result.token).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.audit_error).toContain("failed to append edit log entry");
  });
});

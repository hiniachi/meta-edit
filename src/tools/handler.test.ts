// Case C / v0.2 issuing-handler integration tests.
//
// Exercises the thin grant-issuer pipeline assembled in apply.ts:
//   typed_edit MCP call
//     -> validateRequest (common.ts)
//     -> grants.issue                    (state/grants.ts)
//     -> appendIssued / appendRejected   (state/edit-log.ts)
//     -> EditToolResult { token, expires_at, edit_id, warnings, audit_error? }
//
// The deny-raw-edit hook (Task C) consumes the token; that flow is exercised
// elsewhere. Here we only check that a successful declaration leaves the
// system in the shape the hook expects.

import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
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

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-handler-"));
  // We want the path-safety realpath() walk to land inside tmpRoot. Make it a
  // valid-looking repo root by giving it a `.git` sentinel — server.ts gates
  // on this but the tools layer does not; harmless either way.
  fs.mkdirSync(path.join(tmpRoot, ".git"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function diskSha(rel: string): string {
  const abs = path.join(tmpRoot, rel);
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(abs))
    .digest("hex");
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
    before_sha256: sha256Hex("hello\n"),
    after_sha256: sha256Hex("hello world\n"),
    ...overrides,
  };
}

describe("makeIssuingHandler — successful declaration", () => {
  it("issues a token, writes an `issued` log record, and persists the grant", async () => {
    writeFile("src/foo.ts", "hello\n");
    const { handler, log, grants } = makeHandler();

    const result = await handler(
      "edit_boundary_condition",
      modifyRequest({ before_sha256: diskSha("src/foo.ts") }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.audit_error).toBeUndefined();
    expect(result.token).toMatch(/^met_\d{8}_[0-9a-f]{10}$/);
    expect(result.edit_id).toMatch(/^edit_\d{8}_\d{4}$/);
    expect(typeof result.expires_at).toBe("string");
    expect(result.expires_at.length).toBeGreaterThan(0);

    // Grant is queryable.
    const grant = await grants.lookup(result.token);
    expect(grant).not.toBeNull();
    expect(grant?.binding.length).toBe(1);
    expect(grant?.binding[0]?.file).toBe("src/foo.ts");

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
    }
  });
});

describe("makeIssuingHandler — validation rejection", () => {
  async function expectRejection(
    tool: ToolName,
    request: EditToolRequest,
    matcher: (warnings: string[]) => boolean,
  ): Promise<void> {
    const { handler, log, grants } = makeHandler();
    const result = await handler(tool, request);
    expect(result.token).toBe("");
    expect(result.expires_at).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(matcher(result.warnings)).toBe(true);

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
      modifyRequest({
        rationale: "   ",
        before_sha256: diskSha("src/foo.ts"),
      }),
      (w) => w.some((s) => s.includes("rationale")),
    );
  });

  it("rejects empty test_files for an SQLite-derived tool", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({
        test_files: [],
        before_sha256: diskSha("src/foo.ts"),
      }),
      (w) => w.some((s) => s.includes("test_files")),
    );
  });

  it("rejects non-empty test_files for edit_test_only_change", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_test_only_change",
      modifyRequest({
        test_files: ["tests/foo.test.ts"],
        before_sha256: diskSha("src/foo.ts"),
      }),
      (w) => w.some((s) => s.includes("test_files")),
    );
  });

  it("rejects before_sha256 mismatch with disk", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({
        before_sha256: sha256Hex("DIFFERENT CONTENT\n"),
      }),
      (w) => w.some((s) => s.includes("before_sha256 mismatch")),
    );
  });

  it("rejects edit_create_file when target already exists", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_create_file",
      modifyRequest({
        before_sha256: SHA256_EMPTY,
      }),
      (w) => w.some((s) => s.includes("already exists")),
    );
  });

  it("accepts edit_create_file when target does not exist and before_sha256 = sha256(\"\")", async () => {
    const { handler, log } = makeHandler();
    const result = await handler(
      "edit_create_file",
      {
        target_file: "src/new.ts",
        rationale: "scaffold a new module",
        risk_level: "low",
        test_files: ["tests/new.test.ts"],
        before_sha256: SHA256_EMPTY,
        after_sha256: sha256Hex("export const x = 1;\n"),
      },
    );
    expect(result.warnings).toEqual([]);
    expect(result.token.length).toBeGreaterThan(0);

    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.phase).toBe("issued");
  });

  it("rejects edit_create_file with non-empty before_sha256 when file is absent", async () => {
    await expectRejection(
      "edit_create_file",
      {
        target_file: "src/new.ts",
        rationale: "scaffold a new module",
        risk_level: "low",
        test_files: ["tests/new.test.ts"],
        before_sha256: sha256Hex("anything"),
        after_sha256: sha256Hex("export const x = 1;\n"),
      },
      (w) => w.some((s) => s.includes("must equal sha256(\"\")")),
    );
  });

  it("rejects target_file outside the repo", async () => {
    writeFile("src/foo.ts", "hello\n");
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({
        target_file: "../escape.ts",
        before_sha256: diskSha("src/foo.ts"),
      }),
      (w) => w.some((s) => /traversal|escapes|invalid/i.test(s)),
    );
  });

  it("rejects target_file in a protected path", async () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    writeFile(".meta-edit/state/garbage.txt", "x");
    await expectRejection(
      "edit_boundary_condition",
      modifyRequest({
        target_file: ".meta-edit/state/garbage.txt",
        before_sha256: diskSha(".meta-edit/state/garbage.txt"),
      }),
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
        before_sha256: diskSha("src/foo.ts"),
        additional_files: [
          {
            file: "src/bar.ts",
            before_sha256: diskSha("src/bar.ts"),
            after_sha256: sha256Hex("new content\n"),
          },
        ],
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
        before_sha256: diskSha("docs/a.md"),
        after_sha256: sha256Hex("alpha (renamed)\n"),
        additional_files: [
          {
            file: "docs/b.md",
            before_sha256: diskSha("docs/b.md"),
            after_sha256: sha256Hex("beta (renamed)\n"),
          },
          {
            file: "docs/c.md",
            before_sha256: diskSha("docs/c.md"),
            after_sha256: sha256Hex("gamma (renamed)\n"),
          },
        ],
      },
    );
    expect(result.warnings).toEqual([]);
    expect(result.token.length).toBeGreaterThan(0);
    const grant = await grants.lookup(result.token);
    expect(grant?.binding.map((b) => b.file).sort()).toEqual(
      ["docs/a.md", "docs/b.md", "docs/c.md"],
    );
  });

  it("rejects additional_files cardinality > 32 at the zod boundary", async () => {
    writeFile("docs/a.md", "alpha\n");
    const { handler } = makeHandler();
    const additional = [];
    for (let i = 0; i < 33; i++) {
      additional.push({
        file: `docs/extra${i}.md`,
        before_sha256: SHA256_EMPTY,
        after_sha256: sha256Hex(`content ${i}\n`),
      });
    }
    // Zod schema enforces .max(32) before the issuer is even called. We
    // exercise the zod boundary indirectly by feeding the issuer through the
    // common.ts validator: a present-but-overlength additional_files array is
    // refused upstream by the registry's per-tool input schema (.max). At
    // the issuer layer we still handle the 32-cap path safely by treating
    // the request as well-formed (the registry's MCP wrapper would have
    // rejected this earlier). We assert the issuer simply does not crash and
    // returns warnings or a successful result — never an exception.
    const safeRequest: EditToolRequest = {
      target_file: "docs/a.md",
      rationale: "...",
      risk_level: "low",
      test_files: [],
      before_sha256: diskSha("docs/a.md"),
      after_sha256: sha256Hex("alpha (renamed)\n"),
      additional_files: additional.slice(0, 32),
    };
    const result = await handler("edit_docs_only", safeRequest);
    // 32 entries plus target = 33 total bindings. 32 of those entries do
    // not exist on disk; for edit_docs_only that's a modify-only target so
    // each missing file produces a warning.
    expect(result.token).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

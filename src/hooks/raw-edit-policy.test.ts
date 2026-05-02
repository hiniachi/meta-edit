// Tests for the token-aware deny-raw-edit policy (Case C / v0.2).
//
// Two layers covered here:
//
//   1. evaluateRawEdit — the v0.1.x classification helper. Still in use
//      for the cli/hooks-cmd matcher tests AND as the first gate in the
//      entry script. Case-insensitive, NotebookEdit included.
//
//   2. evaluateTokenedEdit — the SPEC §5.1 flow. Untyped → deny;
//      expired/unknown token → deny; binding mismatch → deny;
//      before_sha256 staleness → deny; happy path → allow + consume +
//      consumed-record append.
//
//   3. canonicalizeForBinding — parity with the issuer's path canonical form.
//
// v0.2.1 thinning: simulate() and the after_sha256 post-condition check
// were removed from the hook. Per Article 3, the post-condition check
// added cost (client-supplied after_sha256, per-tool replay engine,
// NotebookEdit UNSUPPORTED branch) without proportional protective
// value. NotebookEdit is now denied at the policy level (out of v0.2
// scope) before token lookup. Tests below reflect the simplified flow.

import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  canonicalizeForBinding,
  evaluateRawEdit,
  evaluateTokenedEdit,
  RAW_EDIT_TOOLS,
} from "./raw-edit-policy.js";
import { EditLog } from "../state/edit-log.js";
import {
  createGrantsStore,
  type GrantBinding,
  type GrantsStore,
} from "../state/grants.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-rawhook-"));
  // Make tmpRoot look repo-shaped so any path-safety checks see a sensible root.
  fs.mkdirSync(path.join(tmpRoot, ".git"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function writeFile(rel: string, content: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

async function issueGrant(
  grants: GrantsStore,
  editId: string,
  binding: GrantBinding[],
) {
  return grants.issue({ edit_id: editId, binding });
}

// =====================================================================
// Layer 1: evaluateRawEdit (classification)
// =====================================================================

describe("evaluateRawEdit", () => {
  it("denies Edit / Write / MultiEdit / NotebookEdit (canonical)", () => {
    for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      const r = evaluateRawEdit(t);
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain(t);
      expect(r.reason).toContain("edit_*");
    }
  });

  it("allows non-raw tools", () => {
    expect(evaluateRawEdit("Bash").decision).toBe("allow");
    expect(evaluateRawEdit("Read").decision).toBe("allow");
    expect(evaluateRawEdit("edit_boundary_condition").decision).toBe("allow");
    expect(evaluateRawEdit("").decision).toBe("allow");
  });

  it("is case-insensitive on the deny set", () => {
    expect(evaluateRawEdit("edit").decision).toBe("deny");
    expect(evaluateRawEdit("WRITE").decision).toBe("deny");
    expect(evaluateRawEdit("multiedit").decision).toBe("deny");
    expect(evaluateRawEdit("notebookedit").decision).toBe("deny");
  });

  it("exposes the exact denied set", () => {
    expect([...RAW_EDIT_TOOLS].sort()).toEqual([
      "Edit",
      "MultiEdit",
      "NotebookEdit",
      "Write",
    ]);
  });
});

// =====================================================================
// Layer 2: evaluateTokenedEdit (SPEC §5.1 flow)
// =====================================================================

describe("evaluateTokenedEdit — gate failures", () => {
  it("denies an Edit call with no _meta_edit_token", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "x",
        new_string: "y",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("_meta_edit_token");
  });

  it("denies an unknown token", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "x",
        new_string: "y",
        _meta_edit_token: "met_20260502_0000000000",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/expired or unknown/);
  });

  it("denies an expired token (TTL elapsed)", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "before\n");

    const grant = await issueGrant(grants, "edit_20260502_0001", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("before\n"),
      },
    ]);

    // Force-expire by rewriting the grant file with an expires_at in the past.
    const grantPath = path.join(
      tmpRoot,
      ".meta-edit/state/grants",
      `${grant.token_id}.json`,
    );
    const stored = JSON.parse(fs.readFileSync(grantPath, "utf8"));
    stored.expires_at = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(grantPath, JSON.stringify(stored));

    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "before",
        new_string: "after",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/expired or unknown/);
  });

  it("denies file_path that is not in the binding", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "before\n");
    writeFile("src/bar.ts", "stuff\n");

    const grant = await issueGrant(grants, "edit_20260502_0002", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("before\n"),
      },
    ]);

    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/bar.ts"),
        old_string: "stuff",
        new_string: "thing",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/does not bind/);
  });

  it("denies before_sha256 staleness (disk drift)", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "before\n");

    const grant = await issueGrant(grants, "edit_20260502_0003", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("before\n"),
      },
    ]);

    // Mutate disk after token issuance — the hook should detect drift.
    writeFile("src/foo.ts", "DRIFTED\n");

    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "DRIFTED",
        new_string: "after",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/drifted/);
  });

  it("denies NotebookEdit explicitly (out of v0.2 scope) before token lookup", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    // No grant required — the deny fires before lookup.
    const r = await evaluateTokenedEdit({
      toolName: "NotebookEdit",
      toolInput: {
        file_path: path.join(tmpRoot, "notebooks/x.ipynb"),
        _meta_edit_token: "met_20260502_0000000000",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/NotebookEdit/);
    expect(r.reason).toMatch(/out of v0.2 scope/);
  });

  it("denies when file_path is missing", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "x\n");
    const grant = await issueGrant(grants, "edit_20260502_0008", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("x\n"),
      },
    ]);
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: { _meta_edit_token: grant.token_id },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/file_path/);
  });

  it("denies when canonicalization escapes the repo", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "x\n");
    const grant = await issueGrant(grants, "edit_20260502_0009", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("x\n"),
      },
    ]);

    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: "/etc/passwd",
        old_string: "x",
        new_string: "y",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
  });

  it("denies (fail-closed) when target path is a directory (EISDIR)", async () => {
    // A binding whose `file` resolves to a directory cannot be checked.
    // The fail-closed path returns a specific deny reason. (Codex review
    // medium #1, retained from v0.2.0.)
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, "src/dir-not-file"), { recursive: true });
    const grant = await issueGrant(grants, "edit_20260502_0110", [
      {
        file: "src/dir-not-file",
        before_sha256: sha256(""),
      },
    ]);
    const r = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "src/dir-not-file"),
        content: "x\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    // The error mentions the read failure (EISDIR on Linux).
    expect(r.reason).toMatch(/could not read|EISDIR/);
  });

  it("denies if non-raw tool name reaches evaluateTokenedEdit (defensive)", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const r = await evaluateTokenedEdit({
      toolName: "Bash",
      toolInput: { _meta_edit_token: "met_20260502_0000000000" },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/non-raw tool/);
  });
});

describe("evaluateTokenedEdit — happy path", () => {
  it("allows + consumes + appends consumed record on a valid Edit", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "hello\n");

    const grant = await issueGrant(grants, "edit_20260502_0100", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("hello\n"),
      },
    ]);

    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "hello\n",
        new_string: "hello world\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");

    // Single-binding grant fully consumed → file unlinked.
    const after = await grants.lookup(grant.token_id);
    expect(after).toBeNull();

    // Edit log carries the consumed record.
    const entries = log.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0]?.phase).toBe("consumed");
    if (entries[0]?.phase === "consumed") {
      expect(entries[0].edit_id).toBe("edit_20260502_0100");
      expect(entries[0].consuming_tool).toBe("Edit");
    }
  });

  it("allows + consumes a Write call when before_sha256 matches disk", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "old\n");

    const grant = await issueGrant(grants, "edit_20260502_0101", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("old\n"),
      },
    ]);

    const r = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        // v0.2.1: the hook does NOT replay this content — only staleness
        // is checked. The agent's actual write goes through native Write
        // after the hook allows.
        content: "anything the agent wants to write\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
    const entries = log.readAll();
    expect(entries[0]?.phase).toBe("consumed");
    if (entries[0]?.phase === "consumed") {
      expect(entries[0].consuming_tool).toBe("Write");
    }
  });

  it("allows MultiEdit when before_sha256 matches disk (no replay)", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const initial = "alpha\nbeta\ngamma\n";
    writeFile("src/foo.ts", initial);

    const grant = await issueGrant(grants, "edit_20260502_0102", [
      {
        file: "src/foo.ts",
        before_sha256: sha256(initial),
      },
    ]);

    const r = await evaluateTokenedEdit({
      toolName: "MultiEdit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        edits: [
          { old_string: "alpha", new_string: "ALPHA" },
          { old_string: "gamma", new_string: "GAMMA" },
        ],
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });

  it("partially consumes a multi-binding grant (workflow tool semantics)", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("docs/a.md", "alpha\n");
    writeFile("docs/b.md", "beta\n");

    const grant = await issueGrant(grants, "edit_20260502_0104", [
      {
        file: "docs/a.md",
        before_sha256: sha256("alpha\n"),
      },
      {
        file: "docs/b.md",
        before_sha256: sha256("beta\n"),
      },
    ]);

    // First write: a.md.
    const r1 = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "docs/a.md"),
        content: "ALPHA\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r1.decision).toBe("allow");

    // Grant should still exist (1/2 consumed).
    const mid = await grants.lookup(grant.token_id);
    expect(mid).not.toBeNull();
    expect(mid?.consumed_files).toEqual(["docs/a.md"]);

    // Second write: b.md.
    const r2 = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "docs/b.md"),
        content: "BETA\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r2.decision).toBe("allow");

    // Now fully consumed.
    const after = await grants.lookup(grant.token_id);
    expect(after).toBeNull();

    // Two consumed records, both for the same edit_id.
    const entries = log.readAll();
    expect(entries.filter((e) => e.phase === "consumed").length).toBe(2);
    for (const e of entries) {
      if (e.phase === "consumed") {
        expect(e.edit_id).toBe("edit_20260502_0104");
      }
    }
  });

  it("denies a re-consume attempt against a fully-consumed binding", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "x\n");
    const grant = await issueGrant(grants, "edit_20260502_0105", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("x\n"),
      },
    ]);
    const ok = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        content: "y\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(ok.decision).toBe("allow");

    // Single-binding grant unlinks on full consume → second attempt
    // surfaces as "expired or unknown" because the grant is gone.
    const dup = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        content: "y\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(dup.decision).toBe("deny");
    expect(dup.reason).toMatch(/expired or unknown/);
  });

  it("matches via realpath: file_path through a symlink resolves to the binding's canonical form", async () => {
    if (process.platform === "win32") return;
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("real/foo.ts", "before\n");
    fs.symlinkSync(
      path.join(tmpRoot, "real"),
      path.join(tmpRoot, "via-link"),
    );

    // Issuance stores binding under the resolved canonical form.
    const grant = await issueGrant(grants, "edit_20260502_0106", [
      {
        file: "real/foo.ts",
        before_sha256: sha256("before\n"),
      },
    ]);

    // Native call lands via the symlink path. canonicalizeForBinding
    // must resolve it back to "real/foo.ts" or the consume mismatches.
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "via-link/foo.ts"),
        old_string: "before",
        new_string: "after",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });

  it("accepts a relative file_path against repoRoot", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "x\n");
    const grant = await issueGrant(grants, "edit_20260502_0107", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("x\n"),
      },
    ]);
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: "src/foo.ts",
        old_string: "x",
        new_string: "y",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });

  // Codex review v0.2.1, MEDIUM (documented as accepted ambiguity in
  // src/hooks/raw-edit-policy.ts): a binding with before_sha256 ==
  // sha256("") could match either an edit_create_file against an absent
  // target OR a modify-only declaration whose file was deleted between
  // issuance and consumption. The hook does not distinguish — Article 3's
  // non-adversarial threat model means deletion-then-write is not the
  // hook's responsibility to catch. This test pins the behavior so a
  // future reviewer does not "fix" it without reopening the constitution.
  it("accepts a sha256(\"\") binding even if the target was deleted post-issuance (accepted ambiguity)", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    // The binding looks identical to an edit_create_file binding because
    // the file was empty at issue time (server computes sha256("")).
    writeFile("src/foo.ts", "");
    const grant = await issueGrant(grants, "edit_20260502_0109", [
      {
        file: "src/foo.ts",
        before_sha256: sha256(""),
      },
    ]);

    // Agent deletes the file before issuing the native write — the hook
    // cannot tell this from the legitimate create-file path.
    fs.unlinkSync(path.join(tmpRoot, "src/foo.ts"));

    const r = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        content: "anything\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    // Allowed — see comment above. If this assertion ever changes to
    // "deny", revisit Article 3 + the binding-shape decision in v0.2.1.
    expect(r.decision).toBe("allow");
  });

  it("supports edit_create_file: file does not exist, before is sha256(\"\")", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);

    const grant = await issueGrant(grants, "edit_20260502_0108", [
      {
        file: "src/new.ts",
        before_sha256: sha256(""),
      },
    ]);

    const r = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "src/new.ts"),
        content: "export const x = 1;\n",
        _meta_edit_token: grant.token_id,
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });
});

// =====================================================================
// Layer 3: canonicalizeForBinding (parity with the issuer)
// =====================================================================

describe("canonicalizeForBinding", () => {
  it("collapses an absolute path to repo-relative", () => {
    fs.mkdirSync(path.join(tmpRoot, "src"));
    fs.writeFileSync(path.join(tmpRoot, "src/foo.ts"), "");
    const c = canonicalizeForBinding(
      path.join(tmpRoot, "src/foo.ts"),
      tmpRoot,
    );
    expect(c).toBe("src/foo.ts");
  });

  it("accepts repo-relative input", () => {
    fs.mkdirSync(path.join(tmpRoot, "src"));
    fs.writeFileSync(path.join(tmpRoot, "src/foo.ts"), "");
    const c = canonicalizeForBinding("src/foo.ts", tmpRoot);
    expect(c).toBe("src/foo.ts");
  });

  it("returns null on absolute path outside the repo", () => {
    expect(canonicalizeForBinding("/etc/passwd", tmpRoot)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(canonicalizeForBinding("", tmpRoot)).toBeNull();
  });

  it("resolves through a symlinked directory", () => {
    if (process.platform === "win32") return;
    fs.mkdirSync(path.join(tmpRoot, "real"));
    fs.writeFileSync(path.join(tmpRoot, "real/foo.ts"), "");
    fs.symlinkSync(
      path.join(tmpRoot, "real"),
      path.join(tmpRoot, "via-link"),
    );
    const c = canonicalizeForBinding(
      path.join(tmpRoot, "via-link/foo.ts"),
      tmpRoot,
    );
    expect(c).toBe("real/foo.ts");
  });
});

// Tests for the file-based deny-raw-edit policy (Case C / v0.2.2).
//
// Three layers covered here:
//
//   1. evaluateRawEdit — the v0.1.x classification helper. Still in use
//      for the cli/hooks-cmd matcher tests AND as the first gate in the
//      entry script. Case-insensitive, NotebookEdit included.
//
//   2. evaluateTokenedEdit — the SPEC §5.1 flow. v0.2.2: no token is
//      read from tool_input. The hook canonicalizes file_path,
//      looks up the most-recently-issued active grant covering that
//      file, verifies before_sha256 matches disk, and consumes the
//      binding. Multi-grant cases resolve LIFO.
//
//   3. canonicalizeForBinding — parity with the issuer's path canonical form.
//
// v0.2.2 fix: Claude Code's native Edit / Write / MultiEdit input schemas
// reject extra fields, so the agent can no longer surface a token to the
// hook. The hook resolves the active declaration server-side by
// file_path. All `_meta_edit_token`-passing tests below have been
// dropped or rewritten.
//
// v0.2.1 thinning: simulate() and the after_sha256 post-condition check
// were removed from the hook. Per Article 3, the post-condition check
// added cost (client-supplied after_sha256, per-tool replay engine,
// NotebookEdit UNSUPPORTED branch) without proportional protective
// value. NotebookEdit is now denied at the policy level (out of v0.2
// scope) before lookup. Tests below reflect the simplified flow.

import { afterEach, beforeEach, describe, it, expect } from "bun:test";
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
import { makeTmpRoot, cleanTmpRoot, writeFileIn, sha256Hex } from "../test-helpers.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = makeTmpRoot("rawhook");
  fs.mkdirSync(path.join(tmpRoot, ".git"));
});

afterEach(() => {
  cleanTmpRoot(tmpRoot);
});

const sha256 = sha256Hex;

function writeFile(rel: string, content: string): string {
  return writeFileIn(tmpRoot, rel, content);
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

  it("denies opencode's apply_patch raw-edit primitive", () => {
    // OC-2: apply_patch is opencode's third raw-edit primitive
    // (alongside `edit` and `write`). It carries no top-level file_path
    // (its input is a unified-diff blob with embedded path headers),
    // so the agent cannot route it through the typed-edit grant flow
    // — the classifier denies it outright. Lowercase + underscore is
    // the canonical form here because Claude Code has no PascalCase
    // equivalent to fold to.
    const r = evaluateRawEdit("apply_patch");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("apply_patch");
    expect(r.reason).toContain("edit_*");
    // Case-insensitivity sanity (opencode emits lowercase, but a
    // future harness could capitalise — both must hit).
    expect(evaluateRawEdit("Apply_Patch").decision).toBe("deny");
    expect(evaluateRawEdit("APPLY_PATCH").decision).toBe("deny");
  });

  it("exposes the exact denied set", () => {
    expect([...RAW_EDIT_TOOLS].sort()).toEqual([
      "Edit",
      "MultiEdit",
      "NotebookEdit",
      "Write",
      "apply_patch",
    ]);
  });
});

// =====================================================================
// Layer 2: evaluateTokenedEdit (SPEC §5.1 flow, v0.2.2)
// =====================================================================

describe("evaluateTokenedEdit — apply_patch early deny (OC-2)", () => {
  it("denies apply_patch outright with an actionable reason — does NOT fall through to missing-file_path", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    // Realistic opencode apply_patch input: a unified-diff blob with no
    // top-level file_path. The pre-OC-2 code would route this to step 1
    // and emit "apply_patch call missing file_path", misleading the
    // agent to think they should pass file_path. The early-exit branch
    // returns a dedicated reason that names the structural mismatch.
    const r = await evaluateTokenedEdit({
      toolName: "apply_patch",
      toolInput: {
        // opencode passes the diff under various keys (e.g. `input`,
        // `patch`); none correspond to file_path semantically. Emulate
        // by leaving the standard fields off entirely.
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("apply_patch");
    expect(r.reason).toContain("unified-diff");
    expect(r.reason).toContain("typed_edit");
    // Anti-regression: must NOT use the misleading missing-file_path
    // wording from step 1 (the post-OC-2 check is structural, not
    // payload-shape-dependent).
    expect(r.reason).not.toMatch(/missing "file_path"/);
  });

  it("case-insensitive: APPLY_PATCH / Apply_Patch also short-circuit", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    for (const name of ["APPLY_PATCH", "Apply_Patch"]) {
      const r = await evaluateTokenedEdit({
        toolName: name,
        toolInput: {},
        repoRoot: tmpRoot,
        grants,
        log,
      });
      expect(r.decision).toBe("deny");
      expect(r.reason).toContain("unified-diff");
    }
  });
});

describe("evaluateTokenedEdit — gate failures", () => {
  it("denies an Edit call when no active grant covers the file", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "x\n");
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
    expect(r.reason).toMatch(/no active typed_edit declaration/);
    expect(r.reason).toMatch(/typed edit_\* MCP tool/);
  });

  it("denies an Edit call against a file that no grant binds (other grants exist)", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "before\n");
    writeFile("src/bar.ts", "stuff\n");

    await issueGrant(grants, "edit_20260502_0002", [
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
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/no active typed_edit declaration/);
  });

  it("ignores expired grants and denies", async () => {
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
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/no active typed_edit declaration/);
  });

  it("denies before_sha256 staleness (disk drift)", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "before\n");

    await issueGrant(grants, "edit_20260502_0003", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("before\n"),
      },
    ]);

    // Mutate disk after grant issuance — the hook should detect drift.
    writeFile("src/foo.ts", "DRIFTED\n");

    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "DRIFTED",
        new_string: "after",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/drifted/);
  });

  it("denies NotebookEdit (in-repo) when no active grant covers the path (0105 — same as Edit/Write/MultiEdit)", async () => {
    // 0105-notebookedit: NotebookEdit is no longer policy-denied at
    // step 3. With no active typed_edit declaration, it denies for the
    // same reason as Edit/Write/MultiEdit: "no active typed_edit
    // declaration covers this file". Locks the post-unblock contract
    // (the OLD test asserted "out of v0.2 scope" deny; that policy
    // ended in v0.2.4 once simulate() removal made the original
    // objection obsolete).
    fs.mkdirSync(path.join(tmpRoot, "notebooks"), { recursive: true });
    writeFile("notebooks/x.ipynb", "{}\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const r = await evaluateTokenedEdit({
      toolName: "NotebookEdit",
      toolInput: {
        notebook_path: path.join(tmpRoot, "notebooks/x.ipynb"),
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/no active typed_edit declaration/);
  });

  it("allows NotebookEdit (in-repo) when an active grant covers the notebook (0105 unblock)", async () => {
    // Positive case for the v0.2.4 unblock: a typed_edit declaration
    // against a `.ipynb` should let the deny-raw-edit hook authorize
    // the subsequent native NotebookEdit call. The before_sha256
    // staleness check operates on byte content (the .ipynb JSON),
    // independent of cell semantics.
    fs.mkdirSync(path.join(tmpRoot, "notebooks"), { recursive: true });
    writeFile("notebooks/y.ipynb", "{}\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    await issueGrant(grants, "edit_20260503_9000", [
      {
        file: "notebooks/y.ipynb",
        before_sha256: sha256("{}\n"),
      },
    ]);
    const r = await evaluateTokenedEdit({
      toolName: "NotebookEdit",
      toolInput: {
        notebook_path: path.join(tmpRoot, "notebooks/y.ipynb"),
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });

  it("denies when file_path is missing", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "x\n");
    await issueGrant(grants, "edit_20260502_0008", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("x\n"),
      },
    ]);
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {},
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/file_path/);
  });

  it("denies NotebookEdit when notebook_path is missing (fail-closed)", async () => {
    // 1102: missing key → deny, regardless of toolName. The path-field
    // check runs before the in-repo check.
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const r = await evaluateTokenedEdit({
      toolName: "NotebookEdit",
      toolInput: {},
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/notebook_path/);
  });

  it("allows out-of-repo Edit (issue 1102: typed_edit only governs repo-internal writes)", async () => {
    // 1102: Claude Code plan-mode writes to ~/.claude/plans/*.md, other
    // plugins write outside the repo, /tmp scratch files etc. — none of
    // these are governed by typed_edit. Supply an absolute path that
    // realpath-resolves outside `tmpRoot` and assert allow.
    const outsideRepo = path.join(os.tmpdir(), `outside-${process.pid}.txt`);
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: outsideRepo,
        old_string: "x",
        new_string: "y",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });

  it("allows out-of-repo NotebookEdit (1102 covers notebook_path too)", async () => {
    const outsideRepo = path.join(os.tmpdir(), `outside-${process.pid}.ipynb`);
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const r = await evaluateTokenedEdit({
      toolName: "NotebookEdit",
      toolInput: { notebook_path: outsideRepo },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });

  it("denies in-repo Edit without an active grant (1102 negative side-effect: no consume on deny)", async () => {
    // The deny matrix counterpart to the out-of-repo allow above.
    // Verifies that scoping the policy to the repo did not weaken the
    // in-repo deny path.
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "x\n");
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
    expect(r.reason).toMatch(/no active typed_edit declaration/);
  });

  it("denies (fail-closed) when target path is a directory (EISDIR)", async () => {
    // A binding whose `file` resolves to a directory cannot be checked.
    // The fail-closed path returns a specific deny reason. (Codex review
    // medium #1, retained from v0.2.0.)
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, "src/dir-not-file"), { recursive: true });
    await issueGrant(grants, "edit_20260502_0110", [
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
      toolInput: {},
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

    await issueGrant(grants, "edit_20260502_0101", [
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

    await issueGrant(grants, "edit_20260502_0102", [
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
    await issueGrant(grants, "edit_20260502_0105", [
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
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(ok.decision).toBe("allow");

    // Single-binding grant unlinks on full consume → second attempt
    // surfaces as "no active typed_edit declaration" because the grant is gone.
    const dup = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        content: "y\n",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(dup.decision).toBe("deny");
    expect(dup.reason).toMatch(/no active typed_edit declaration/);
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
    await issueGrant(grants, "edit_20260502_0106", [
      {
        file: "real/foo.ts",
        before_sha256: sha256("before\n"),
      },
    ]);

    // Native call lands via the symlink path. canonicalizeForBinding
    // must resolve it back to "real/foo.ts" or the lookup misses.
    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "via-link/foo.ts"),
        old_string: "before",
        new_string: "after",
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
    await issueGrant(grants, "edit_20260502_0107", [
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
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });

  it("authorizes content fill via sha256(\"\") binding against an empty file (post-v0.3.1 flow)", async () => {
    // v0.3.1 flow: agent did a free empty Write to create the file
    // (no MCP), then declared a typed_edit which bound to sha256("")
    // against the now-empty file. Native Write of the actual content
    // hits this hook with that grant active.
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);

    // Agent's free empty Write step (simulated): file exists, empty.
    writeFile("src/new.ts", "");

    await issueGrant(grants, "edit_20260502_0108", [
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
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
  });

  // v0.3.1 (issue G): empty Write to a non-existent in-repo path is
  // free at the hook level (no MCP declaration). Auto-mkdirs parent
  // dirs (issue K). Decision is "warn" with an educational pointer
  // toward the type-specific tool the agent should call next for the
  // real content. This is the structural fix for the create-bypass
  // concern: empty creates have no logic to gate; the typed
  // intervention runs on the modify of the now-empty file.
  it("v0.3.1: free empty Write to a non-existent in-repo path → warn-allow + auto-mkdir", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    // Note: NO grant issued — the empty-Write branch fires before
    // grant lookup.
    const r = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "newdir/nested/file.ts"),
        content: "",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("warn");
    expect(r.reason).toMatch(/empty file create/);
    // Auto-mkdir created the parent dirs.
    expect(fs.statSync(path.join(tmpRoot, "newdir/nested")).isDirectory()).toBe(true);
  });

  it("v0.3.1: empty Write to an EXISTING file falls through to grant-lookup (truncate-to-empty needs typed declaration)", async () => {
    // Negative case for the empty-Write branch: if the file already
    // exists, we don't authorize a truncate without a typed_edit.
    // The agent must declare what kind of "blank-out" edit this is.
    writeFile("src/foo.ts", "x\n");
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    const r = await evaluateTokenedEdit({
      toolName: "Write",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        content: "",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/no active typed_edit declaration/);
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
    await issueGrant(grants, "edit_20260502_0109", [
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
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    // Allowed — see comment above. If this assertion ever changes to
    // "deny", revisit Article 3 + the binding-shape decision in v0.2.1.
    expect(r.decision).toBe("allow");
  });
});

// =====================================================================
// v0.2.2: multi-grant LIFO consumption tests
// =====================================================================

describe("evaluateTokenedEdit — multi-grant LIFO selection (v0.2.2)", () => {
  it("when two grants cover the same file, the most-recently-issued binding is consumed first", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/foo.ts", "snapshot\n");

    // Issue two grants for the same file. The second one is LIFO-newer.
    const older = await issueGrant(grants, "edit_20260502_0200", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("snapshot\n"),
      },
    ]);
    // Force a strict ordering of issued_at so the LIFO assertion is
    // deterministic even on fast hardware where two issue() calls land in
    // the same millisecond. We post-edit the older grant's timestamp to
    // be 100ms in the past.
    const olderPath = path.join(
      tmpRoot,
      ".meta-edit/state/grants",
      `${older.token_id}.json`,
    );
    {
      const stored = JSON.parse(fs.readFileSync(olderPath, "utf8"));
      stored.issued_at = new Date(Date.now() - 100).toISOString();
      fs.writeFileSync(olderPath, JSON.stringify(stored));
    }

    const newer = await issueGrant(grants, "edit_20260502_0201", [
      {
        file: "src/foo.ts",
        before_sha256: sha256("snapshot\n"),
      },
    ]);

    // First native Edit consumes the LIFO-newest binding.
    const r1 = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "snapshot",
        new_string: "modified",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r1.decision).toBe("allow");
    const consumed1 = log.readAll().filter((e) => e.phase === "consumed");
    expect(consumed1.length).toBe(1);
    if (consumed1[0]?.phase === "consumed") {
      expect(consumed1[0].edit_id).toBe("edit_20260502_0201");
    }
    // The newer grant is single-binding → fully consumed → unlinked.
    expect(await grants.lookup(newer.token_id)).toBeNull();
    // The older grant survives.
    expect(await grants.lookup(older.token_id)).not.toBeNull();

    // Second native Edit falls back to the older grant's binding.
    // (Note: disk drifted to "modified\n" but the OLDER grant was issued
    // against "snapshot\n", so we have to restore disk to satisfy the
    // before_sha256 check. This test pins LIFO ordering, not staleness
    // semantics — staleness has its own coverage above.)
    writeFile("src/foo.ts", "snapshot\n");
    const r2 = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/foo.ts"),
        old_string: "snapshot",
        new_string: "modified-again",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r2.decision).toBe("allow");
    const consumed2 = log.readAll().filter((e) => e.phase === "consumed");
    expect(consumed2.length).toBe(2);
    if (consumed2[1]?.phase === "consumed") {
      expect(consumed2[1].edit_id).toBe("edit_20260502_0200");
    }
    expect(await grants.lookup(older.token_id)).toBeNull();
  });

  it("LIFO skips grants whose binding for the file is already consumed", async () => {
    const grants = createGrantsStore(tmpRoot);
    const log = new EditLog(tmpRoot);
    writeFile("src/a.md", "alpha\n");
    writeFile("src/b.md", "beta\n");

    // Multi-binding workflow grant that already has src/a.md consumed.
    const wf = await issueGrant(grants, "edit_20260502_0210", [
      {
        file: "src/a.md",
        before_sha256: sha256("alpha\n"),
      },
      {
        file: "src/b.md",
        before_sha256: sha256("beta\n"),
      },
    ]);
    // Pre-consume src/a.md so the workflow grant only has src/b.md left.
    await grants.consume(wf.token_id, "src/a.md");

    // Issue a newer single-file grant for src/a.md so the LIFO scan has
    // two candidates: the (newer) single grant and the (older) partially-
    // consumed workflow grant. LIFO should pick the newer single-file.
    const fresh = await issueGrant(grants, "edit_20260502_0211", [
      {
        file: "src/a.md",
        before_sha256: sha256("alpha\n"),
      },
    ]);

    const r = await evaluateTokenedEdit({
      toolName: "Edit",
      toolInput: {
        file_path: path.join(tmpRoot, "src/a.md"),
        old_string: "alpha",
        new_string: "ALPHA",
      },
      repoRoot: tmpRoot,
      grants,
      log,
    });
    expect(r.decision).toBe("allow");
    const consumed = log.readAll().filter((e) => e.phase === "consumed");
    // Should reference the freshly-issued single-file grant, not the
    // partially-consumed workflow grant.
    expect(consumed.length).toBe(1);
    if (consumed[0]?.phase === "consumed") {
      expect(consumed[0].edit_id).toBe("edit_20260502_0211");
    }
    expect(await grants.lookup(fresh.token_id)).toBeNull();
    // Workflow grant survives.
    expect(await grants.lookup(wf.token_id)).not.toBeNull();
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

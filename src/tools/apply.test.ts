import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyChanges } from "./apply.js";
import type { ContentChange } from "./common.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-edit-apply-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

function change(
  canonical: string,
  oldContent: string,
  newContent: string,
): ContentChange {
  return { canonical, oldContent, newContent };
}

describe("applyChanges", () => {
  it("writes the new content for a single modify-only change", () => {
    writeFile("src/foo.ts", "alpha\n");
    const result = applyChanges(tmpRoot, [
      change("src/foo.ts", "alpha\n", "beta\n"),
    ]);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe(
      "beta\n",
    );
  });

  it("applies multi-file changes when every precondition holds", () => {
    writeFile("src/a.ts", "one\n");
    writeFile("src/b.ts", "uno\n");
    const result = applyChanges(tmpRoot, [
      change("src/a.ts", "one\n", "two\n"),
      change("src/b.ts", "uno\n", "dos\n"),
    ]);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, "src/a.ts"), "utf8")).toBe("two\n");
    expect(fs.readFileSync(path.join(tmpRoot, "src/b.ts"), "utf8")).toBe("dos\n");
  });

  it("rejects on stale old_content (mismatch with disk) without writing", () => {
    writeFile("src/a.ts", "one\n");
    const result = applyChanges(tmpRoot, [
      change("src/a.ts", "OLD-CONTENT-DOES-NOT-MATCH\n", "two\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) => w.includes("stale old_content") && w.includes("src/a.ts"),
        ),
      ).toBe(true);
    }
    expect(fs.readFileSync(path.join(tmpRoot, "src/a.ts"), "utf8")).toBe("one\n");
  });

  it("all-or-nothing on precondition mismatch in second of two changes", () => {
    writeFile("src/a.ts", "one\n");
    writeFile("src/b.ts", "DRIFTED-FROM-REQUEST\n");
    const result = applyChanges(tmpRoot, [
      change("src/a.ts", "one\n", "two\n"),
      change("src/b.ts", "uno\n", "dos\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) => w.includes("stale old_content") && w.includes("src/b.ts"),
        ),
      ).toBe(true);
    }
    // Critical: src/a.ts MUST NOT have been written. Phase 1
    // (preflight) catches the mismatch before any temp/rename runs.
    expect(fs.readFileSync(path.join(tmpRoot, "src/a.ts"), "utf8")).toBe("one\n");
  });

  it("refuses on ENOENT (modify-only — no creation)", () => {
    const result = applyChanges(tmpRoot, [
      change("src/missing.ts", "", "new content\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      // ENOENT trips the realpath canonicalization branch on the missing
      // path; the resulting warning explicitly cites src/missing.ts.
      // Either the canonicalization warning OR the does-not-exist warning
      // is acceptable depending on which check fires first.
      expect(
        result.warnings.some(
          (w) =>
            w.includes("src/missing.ts") &&
            (w.includes("canonicalization failed") ||
              w.includes("does not exist")),
        ),
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(tmpRoot, "src/missing.ts"))).toBe(false);
  });

  it("refuses on EACCES at apply time without modifying the file", () => {
    if (process.platform === "win32") return; // chmod 0 is meaningless on Windows
    const abs = writeFile("src/locked.ts", "secret\n");
    fs.chmodSync(abs, 0o000);
    try {
      const result = applyChanges(tmpRoot, [
        change("src/locked.ts", "secret\n", "tampered\n"),
      ]);
      expect(result.applied).toBe(false);
      // The file is untouched; the warnings detail the read failure.
      // chmod 0 still allows root to read; in CI environments where
      // tests run as root we accept that result.applied may be true.
      // Verify only that, on failure, the file is not corrupted.
      const after = (() => {
        try {
          return fs.readFileSync(abs, "utf8");
        } catch {
          fs.chmodSync(abs, 0o600);
          return fs.readFileSync(abs, "utf8");
        }
      })();
      if (!result.applied) {
        expect(after).toBe("secret\n");
      }
    } finally {
      try {
        fs.chmodSync(abs, 0o600);
      } catch {
        /* ignore */
      }
    }
  });

  it("rejects when target was swapped to a symlink pointing outside the repo", () => {
    writeFile("src/foo.ts", "alpha\n");
    const outsideTarget = path.join(
      os.tmpdir(),
      `meta-edit-outside-${Date.now()}.txt`,
    );
    fs.writeFileSync(outsideTarget, "outside\n", "utf8");
    try {
      fs.unlinkSync(path.join(tmpRoot, "src/foo.ts"));
      fs.symlinkSync(outsideTarget, path.join(tmpRoot, "src/foo.ts"));

      const result = applyChanges(tmpRoot, [
        change("src/foo.ts", "alpha\n", "beta\n"),
      ]);
      expect(result.applied).toBe(false);
      if (!result.applied) {
        expect(
          result.warnings.some((w) =>
            w.includes("escapes the repository root"),
          ),
        ).toBe(true);
      }
      expect(fs.readFileSync(outsideTarget, "utf8")).toBe("outside\n");
    } finally {
      try {
        fs.unlinkSync(outsideTarget);
      } catch {
        /* ignore */
      }
    }
  });

  it("rejects when apply-time canonical drifts to a different in-repo path", () => {
    writeFile("src/foo.ts", "alpha\n");
    writeFile("src/other.ts", "alpha\n");
    fs.unlinkSync(path.join(tmpRoot, "src/foo.ts"));
    fs.symlinkSync(
      path.join(tmpRoot, "src/other.ts"),
      path.join(tmpRoot, "src/foo.ts"),
    );

    const result = applyChanges(tmpRoot, [
      change("src/foo.ts", "alpha\n", "beta\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some((w) =>
          w.includes("differs from validated canonical"),
        ),
      ).toBe(true);
    }
    expect(fs.readFileSync(path.join(tmpRoot, "src/other.ts"), "utf8")).toBe(
      "alpha\n",
    );
  });

  it("rejects when the validated canonical resolves into a protected directory at apply time", () => {
    fs.mkdirSync(path.join(tmpRoot, ".meta-edit", "state"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, ".meta-edit/state/edits.jsonl"),
      "alpha\n",
      "utf8",
    );
    const result = applyChanges(tmpRoot, [
      change(".meta-edit/state/edits.jsonl", "alpha\n", "beta\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some((w) => w.includes("protected directory")),
      ).toBe(true);
    }
    expect(
      fs.readFileSync(
        path.join(tmpRoot, ".meta-edit/state/edits.jsonl"),
        "utf8",
      ),
    ).toBe("alpha\n");
  });

  it("preserves the original file mode after atomic rename", () => {
    const abs = writeFile("src/foo.ts", "alpha\n");
    fs.chmodSync(abs, 0o640);
    const result = applyChanges(tmpRoot, [
      change("src/foo.ts", "alpha\n", "beta\n"),
    ]);
    expect(result.applied).toBe(true);
    const mode = fs.statSync(abs).mode & 0o7777;
    expect(mode).toBe(0o640);
  });

  it("does not leave .metaedit-tmp files behind on success", () => {
    writeFile("src/foo.ts", "alpha\n");
    const result = applyChanges(tmpRoot, [
      change("src/foo.ts", "alpha\n", "beta\n"),
    ]);
    expect(result.applied).toBe(true);
    const remaining = fs
      .readdirSync(path.join(tmpRoot, "src"))
      .filter((n) => n.includes("metaedit-tmp"));
    expect(remaining).toEqual([]);
  });

  it("does not write any file when only the second change is missing", () => {
    writeFile("src/first.ts", "alpha\n");
    const result = applyChanges(tmpRoot, [
      change("src/first.ts", "alpha\n", "beta\n"),
      change("src/missing.ts", "", "irrelevant\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some((w) => w.includes("src/missing.ts")),
      ).toBe(true);
      expect(result.warnings.some((w) => w.includes("partial write"))).toBe(
        false,
      );
    }
    expect(fs.readFileSync(path.join(tmpRoot, "src/first.ts"), "utf8")).toBe(
      "alpha\n",
    );
  });

  it("hard-fails when O_NOFOLLOW is unavailable on the platform", () => {
    writeFile("src/foo.ts", "alpha\n");
    const result = applyChanges(
      tmpRoot,
      [change("src/foo.ts", "alpha\n", "beta\n")],
      { oNofollow: 0 },
    );
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) =>
            w.includes("does not expose O_NOFOLLOW") &&
            w.includes("refuses to write"),
        ),
      ).toBe(true);
    }
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe(
      "alpha\n",
    );
  });

  it("rejects (defense in depth) when applyChanges is given duplicate canonicals", () => {
    writeFile("src/foo.ts", "alpha\n");
    const result = applyChanges(tmpRoot, [
      change("src/foo.ts", "alpha\n", "beta\n"),
      change("src/foo.ts", "beta\n", "gamma\n"),
    ]);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(
        result.warnings.some(
          (w) =>
            w.includes("duplicate canonical") && w.includes("internal error"),
        ),
      ).toBe(true);
    }
    expect(fs.readFileSync(path.join(tmpRoot, "src/foo.ts"), "utf8")).toBe(
      "alpha\n",
    );
  });

  it("does not crash when O_NOFOLLOW is undefined (falls through to platform default)", () => {
    writeFile("src/foo.ts", "alpha\n");
    const result = applyChanges(
      tmpRoot,
      [change("src/foo.ts", "alpha\n", "beta\n")],
      { oNofollow: undefined as unknown as number },
    );
    expect(typeof result.applied).toBe("boolean");
  });
});

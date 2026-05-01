import { describe, it, expect } from "bun:test";
import {
  isProtectedPath,
  normalizeRepoRelative,
  PROTECTED_PREFIXES,
} from "./protected-paths.js";

describe("normalizeRepoRelative", () => {
  it("strips leading ./", () => {
    expect(normalizeRepoRelative("./src/foo.ts")).toBe("src/foo.ts");
  });

  it("strips leading slashes", () => {
    expect(normalizeRepoRelative("/src/foo.ts")).toBe("src/foo.ts");
  });

  it("collapses double slashes", () => {
    expect(normalizeRepoRelative("src//foo.ts")).toBe("src/foo.ts");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(normalizeRepoRelative("src\\foo.ts")).toBe("src/foo.ts");
  });

  it("preserves nested ./ inside the path (rejected later by traversal check)", () => {
    expect(normalizeRepoRelative("src/./foo.ts")).toBe("src/./foo.ts");
  });
});

describe("isProtectedPath", () => {
  it("matches files under .meta-edit/state/", () => {
    expect(isProtectedPath(".meta-edit/state/edits.jsonl")).toBe(true);
    expect(isProtectedPath("./.meta-edit/state/edits.jsonl")).toBe(true);
  });

  it("matches files under .meta-edit/tmp/", () => {
    expect(isProtectedPath(".meta-edit/tmp/scratch.txt")).toBe(true);
  });

  it("does not match other .meta-edit subdirectories", () => {
    expect(isProtectedPath(".meta-edit/config.yml")).toBe(false);
  });

  it("does not match unrelated paths", () => {
    expect(isProtectedPath("src/foo.ts")).toBe(false);
    expect(isProtectedPath("docs/SPEC.md")).toBe(false);
  });

  it("exposes the exact documented protected prefix set", () => {
    expect([...PROTECTED_PREFIXES]).toEqual([
      ".meta-edit/state/",
      ".meta-edit/tmp/",
    ]);
  });

  it("rejects case-insensitive aliases of protected paths", () => {
    expect(isProtectedPath(".META-EDIT/state/edits.jsonl")).toBe(true);
    expect(isProtectedPath(".meta-edit/STATE/edits.jsonl")).toBe(true);
    expect(isProtectedPath(".Meta-Edit/Tmp/scratch.txt")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C3 — Exact directory name without trailing slash
// ---------------------------------------------------------------------------
describe("isProtectedPath — exact directory name without trailing slash (C3)", () => {
  it("returns true for '.meta-edit/state' (no trailing slash)", () => {
    // The protected prefix is ".meta-edit/state/". The bare directory name
    // ".meta-edit/state" is semantically within the protected set but the
    // startsWith check fails because the input has no trailing slash.
    expect(isProtectedPath(".meta-edit/state")).toBe(true);
  });

  it("returns true for '.meta-edit/tmp' (no trailing slash)", () => {
    expect(isProtectedPath(".meta-edit/tmp")).toBe(true);
  });

  it("returns true for './.meta-edit/state' (leading ./ stripped, no trailing slash)", () => {
    expect(isProtectedPath("./.meta-edit/state")).toBe(true);
  });

  it("returns true for './.meta-edit/tmp' (leading ./ stripped, no trailing slash)", () => {
    expect(isProtectedPath("./.meta-edit/tmp")).toBe(true);
  });
});

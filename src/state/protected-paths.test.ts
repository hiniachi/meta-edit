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

  it("exposes the prefixes for documentation purposes", () => {
    expect(PROTECTED_PREFIXES.length).toBeGreaterThan(0);
  });
});

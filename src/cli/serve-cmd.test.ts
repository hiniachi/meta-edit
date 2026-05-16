import { describe, it, expect } from "bun:test";
import { parseServeArgs } from "./serve-cmd.js";

describe("parseServeArgs", () => {
  it("returns ok with no repoRoot when given no args", () => {
    const r = parseServeArgs([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repoRoot).toBeUndefined();
  });

  it("parses --repo-root <path> (space form)", () => {
    const r = parseServeArgs(["--repo-root", "/work/repo"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repoRoot).toBe("/work/repo");
  });

  it("parses --repo-root=<path> (equals form)", () => {
    const r = parseServeArgs(["--repo-root=/work/repo"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repoRoot).toBe("/work/repo");
  });

  it("errors when --repo-root has no value", () => {
    const r = parseServeArgs(["--repo-root"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("requires a path argument");
  });

  it("errors when --repo-root= is empty", () => {
    const r = parseServeArgs(["--repo-root="]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("requires a path argument");
  });

  it("errors on an unknown flag", () => {
    const r = parseServeArgs(["--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unknown flag: --nope");
  });
});

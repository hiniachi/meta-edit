import { describe, it, expect } from "bun:test";
import { evaluateRawEdit, RAW_EDIT_TOOLS } from "./raw-edit-policy.js";

describe("evaluateRawEdit", () => {
  it("denies Edit", () => {
    const r = evaluateRawEdit("Edit");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("Edit");
    expect(r.reason).toContain("edit_*");
  });

  it("denies Write", () => {
    const r = evaluateRawEdit("Write");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("Write");
  });

  it("denies MultiEdit", () => {
    const r = evaluateRawEdit("MultiEdit");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("MultiEdit");
  });

  it("allows other tools", () => {
    expect(evaluateRawEdit("Bash").decision).toBe("allow");
    expect(evaluateRawEdit("Read").decision).toBe("allow");
    expect(evaluateRawEdit("edit_boundary_condition").decision).toBe("allow");
    expect(evaluateRawEdit("").decision).toBe("allow");
  });

  it("exposes the exact denied set", () => {
    expect([...RAW_EDIT_TOOLS].sort()).toEqual(["Edit", "MultiEdit", "Write"]);
  });
});

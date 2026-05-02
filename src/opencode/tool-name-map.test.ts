import { describe, it, expect } from "bun:test";
import {
  OPENCODE_TO_CANONICAL,
  isOpencodeRawEditTool,
  toCanonicalRawEditName,
} from "./tool-name-map.js";
import { RAW_EDIT_TOOLS } from "../hooks/raw-edit-policy.js";

// =====================================================================
// OPENCODE_TO_CANONICAL — exact mapping integrity
// =====================================================================

describe("OPENCODE_TO_CANONICAL", () => {
  it("maps the three opencode raw-edit primitives only", () => {
    expect(Object.keys(OPENCODE_TO_CANONICAL).sort()).toEqual([
      "apply_patch",
      "edit",
      "write",
    ]);
  });

  it("maps each entry to a name that lives in RAW_EDIT_TOOLS (canonical-set integrity)", () => {
    // Drift guard: if RAW_EDIT_TOOLS is renamed or split per-harness,
    // this test catches a stale opencode map at compile / test time
    // rather than at first agent invocation against a missing canonical
    // name (which would silently bypass the deny gate).
    for (const canonical of Object.values(OPENCODE_TO_CANONICAL)) {
      expect(RAW_EDIT_TOOLS.has(canonical)).toBe(true);
    }
  });

  it("self-maps apply_patch (no PascalCase canonical exists)", () => {
    // Underscore-bearing names cannot be folded by toLowerCase() across
    // the PascalCase ↔ lowercase boundary; the canonical entry stays
    // as the opencode-emitted form. Anti-regression for someone
    // "fixing" the map to ApplyPatch and breaking lookups.
    expect(OPENCODE_TO_CANONICAL["apply_patch"]).toBe("apply_patch");
  });
});

// =====================================================================
// isOpencodeRawEditTool — predicate
// =====================================================================

describe("isOpencodeRawEditTool", () => {
  it("matches all three opencode raw-edit primitives", () => {
    expect(isOpencodeRawEditTool("edit")).toBe(true);
    expect(isOpencodeRawEditTool("write")).toBe(true);
    expect(isOpencodeRawEditTool("apply_patch")).toBe(true);
  });

  it("is case-insensitive (defensive against future opencode casing)", () => {
    expect(isOpencodeRawEditTool("EDIT")).toBe(true);
    expect(isOpencodeRawEditTool("Write")).toBe(true);
    expect(isOpencodeRawEditTool("APPLY_PATCH")).toBe(true);
    expect(isOpencodeRawEditTool("Apply_Patch")).toBe(true);
  });

  it("rejects names that are not opencode raw-edit primitives", () => {
    // multiedit / notebookedit are Claude Code raw-edit names that
    // opencode does not emit — the predicate is an opencode-side
    // gate, so they must NOT match here. The downstream policy module
    // catches them (via the case-insensitive RAW_EDIT_TOOLS check) if
    // a future opencode release ever does emit them.
    expect(isOpencodeRawEditTool("multiedit")).toBe(false);
    expect(isOpencodeRawEditTool("notebookedit")).toBe(false);
    expect(isOpencodeRawEditTool("bash")).toBe(false);
    expect(isOpencodeRawEditTool("read")).toBe(false);
    expect(isOpencodeRawEditTool("")).toBe(false);
  });

  it("returns false for non-string input", () => {
    // Defensive: opencode tool name comes from in-process JS, so the
    // type *should* be string, but guard against accidental nullish or
    // numeric values from a misconfigured plugin context.
    expect(isOpencodeRawEditTool(undefined as unknown as string)).toBe(false);
    expect(isOpencodeRawEditTool(null as unknown as string)).toBe(false);
    expect(isOpencodeRawEditTool(42 as unknown as string)).toBe(false);
  });
});

// =====================================================================
// toCanonicalRawEditName — name normalization
// =====================================================================

describe("toCanonicalRawEditName", () => {
  it("canonicalizes opencode lowercase names to RAW_EDIT_TOOLS entries", () => {
    expect(toCanonicalRawEditName("edit")).toBe("Edit");
    expect(toCanonicalRawEditName("write")).toBe("Write");
    expect(toCanonicalRawEditName("apply_patch")).toBe("apply_patch");
  });

  it("is case-insensitive on input", () => {
    expect(toCanonicalRawEditName("EDIT")).toBe("Edit");
    expect(toCanonicalRawEditName("Write")).toBe("Write");
    expect(toCanonicalRawEditName("Apply_Patch")).toBe("apply_patch");
  });

  it("returns null for unknown / non-opencode-raw-edit names", () => {
    expect(toCanonicalRawEditName("multiedit")).toBeNull();
    expect(toCanonicalRawEditName("notebookedit")).toBeNull();
    expect(toCanonicalRawEditName("bash")).toBeNull();
    expect(toCanonicalRawEditName("")).toBeNull();
    expect(toCanonicalRawEditName(undefined as unknown as string)).toBeNull();
  });
});

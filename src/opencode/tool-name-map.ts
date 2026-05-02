// opencode → canonical raw-edit tool-name normalization.
//
// opencode emits lowercase tool names with underscores (`edit`, `write`,
// `apply_patch`); the meta-edit policy module's `RAW_EDIT_TOOLS` carries
// the canonical PascalCase set inherited from Claude Code (`Edit`,
// `Write`, `MultiEdit`, `NotebookEdit`) plus the lowercase opencode-only
// `apply_patch`. The case-insensitive lookup in `evaluateRawEdit`
// already folds `edit` → `Edit` and `write` → `Write` correctly via
// `toLowerCase()`. Underscore-bearing names (`apply_patch`) cannot be
// folded the same way, which is why the canonical entry for that tool
// stays lowercase.
//
// This file's job is therefore narrow:
//   - Provide an explicit map for the readable cases (`edit`, `write`,
//     `apply_patch`) so the opencode plugin can attach a canonical name
//     to its trace logs without re-deriving the casing rules.
//   - Provide an `isOpencodeRawEditTool` predicate so the plugin can
//     decide whether to enter the raw-edit branch without iterating
//     `RAW_EDIT_TOOLS` itself (keeps the harness adapter and the policy
//     module loosely coupled).
//
// MultiEdit and NotebookEdit are intentionally absent: opencode has no
// equivalent tool today. If a future opencode release adds one, extend
// the map here and add a regression test in `tool-name-map.test.ts`.

/**
 * Canonical raw-edit tool name as it appears in `RAW_EDIT_TOOLS`. The
 * opencode plugin uses this for audit-log `consuming_tool` values so a
 * shared `.meta-edit/state/edits.jsonl` reads consistently across
 * harnesses.
 */
export type CanonicalRawEditName = "Edit" | "Write" | "apply_patch";

/**
 * Lowercase opencode tool name → canonical name in `RAW_EDIT_TOOLS`.
 * `apply_patch` self-maps because there is no PascalCase canonical
 * form (see file header for why).
 */
export const OPENCODE_TO_CANONICAL: Readonly<Record<string, CanonicalRawEditName>> = Object.freeze({
  edit: "Edit",
  write: "Write",
  apply_patch: "apply_patch",
});

/**
 * Predicate: does `name` (any case, opencode-emitted form) refer to one
 * of opencode's raw-edit primitives that the meta-edit hook must
 * intercept?
 *
 * Returns true for `edit`, `write`, `apply_patch` and their case
 * variants. Returns false for anything else (including `multiedit` /
 * `notebookedit`, which opencode does not emit — encountering one is a
 * harness-version mismatch and the plugin should treat it as
 * pass-through rather than deny, so the canonical-set check happens
 * via `evaluateRawEdit` downstream).
 */
export function isOpencodeRawEditTool(name: string): boolean {
  if (typeof name !== "string") return false;
  return Object.prototype.hasOwnProperty.call(OPENCODE_TO_CANONICAL, name.toLowerCase());
}

/**
 * Return the canonical name for an opencode-emitted raw-edit tool name,
 * or `null` if the input is not a known opencode raw-edit name. The
 * plugin uses this to feed `evaluateTokenedEdit({ toolName: ... })` a
 * canonical name that matches `RAW_EDIT_TOOLS`'s entries directly.
 */
export function toCanonicalRawEditName(name: string): CanonicalRawEditName | null {
  if (typeof name !== "string") return null;
  const key = name.toLowerCase() as keyof typeof OPENCODE_TO_CANONICAL;
  // The key check via `in` lets TS narrow the index access result;
  // hasOwnProperty would not, because the typed Record returns
  // `CanonicalRawEditName | undefined` under noUncheckedIndexedAccess.
  return key in OPENCODE_TO_CANONICAL ? OPENCODE_TO_CANONICAL[key] ?? null : null;
}

// SessionStart onboarding message builder.
//
// Split out of session-onboarding.ts in the v0.6.0 follow-up so that
// unit tests can import `buildOnboardingMessage` without pulling in the
// hook script's module-load side effect (`main()` consumes stdin).
//
// PR #85 Codex review: the earlier `if (import.meta.main)` guard in
// session-onboarding.ts did not survive bundling — Bun compiles
// `import.meta.main` to `__require.main == __require.module`, and under
// Node ESM both sides are `undefined`, so the comparison is always
// true. A deep import of the bundled hook would then still run
// `main()`. Moving the pure function to its own side-effect-free module
// removes the need for an entry-point guard entirely: the hook script
// can call `main()` unconditionally (it genuinely is a script), and the
// test imports this module, which has no `main()` to run.

export function buildOnboardingMessage(): string {
  // Merged template per docs/plan/reminder-style-hooks/rfc.md §7.1 +
  // §11 Phase 2: prepend the reminder block, retain the existing
  // typed-edit-onboarding skill pointer below. Removing the skill
  // pointer would regress onboarding guidance.
  return [
    "meta-edit reminder:",
    "",
    "I should not edit first and classify later.",
    "",
    "Before changing repository files, I should choose the typed edit tool",
    "that matches the intent of the change. The tool choice is part of the",
    "reasoning step, not just ceremony.",
    "",
    "If a direct edit or shell write would skip that declaration, I should",
    "stop and make the declaration first.",
    "",
    "---",
    "",
    "meta-edit MCP server is registered for this project. New session detected.",
    "",
    "Before your first edit, invoke the `typed-edit-onboarding` skill via the",
    "Skill tool to load the twenty-one-tool catalog and selection heuristic.",
    "Empty file creation is free (no MCP declaration); content fills go through",
    "the appropriate edit_<TYPE> tool against the now-empty file. Use ToolSearch",
    "with `select:mcp__plugin_meta-edit_meta-edit__edit_<name>` to load any",
    "tool's schema on demand.",
  ].join("\n");
}

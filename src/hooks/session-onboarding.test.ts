// SessionStart message snapshot test (docs/plan/reminder-style-hooks/
// rfc.md §11 Phase 3 — merged template). buildOnboardingMessage()
// prepends the reminder block to the existing typed-edit-onboarding
// skill pointer; this file asserts both halves are present so a future
// edit cannot silently drop either one.

import { describe, expect, it } from "bun:test";
import { buildOnboardingMessage } from "./session-onboarding.js";

describe("buildOnboardingMessage — merged reminder + skill pointer template", () => {
  it("returns a non-empty additionalContext payload", () => {
    const msg = buildOnboardingMessage();
    expect(msg.length).toBeGreaterThan(0);
  });

  it("contains the reminder prefix and core self-reminder semantic phrases (RFC §7.1)", () => {
    const msg = buildOnboardingMessage();
    expect(msg).toContain("meta-edit reminder:");
    // First-person framing — the agent should read this as their own thought.
    expect(msg).toContain("I should not edit first and classify later");
    // Classification-step language is the load-bearing reminder.
    expect(msg).toMatch(/part of the\s+reasoning step/);
    expect(msg).toContain("stop and make the declaration first");
  });

  it("retains the existing typed-edit-onboarding skill pointer (merged template, not replaced)", () => {
    const msg = buildOnboardingMessage();
    // Codex review on PR #84 flagged that replacing buildOnboardingMessage()
    // with the §7.1 reminder text alone would regress onboarding guidance.
    // The merged template keeps both — these substrings prove the skill
    // pointer survived.
    expect(msg).toContain("typed-edit-onboarding");
    expect(msg).toContain("Skill tool");
    expect(msg).toContain("twenty-one-tool catalog");
    expect(msg).toContain("ToolSearch");
  });

  it("places the reminder block above the skill pointer", () => {
    // Order matters for read flow: reminder reactivates classification
    // mode FIRST, then the skill pointer tells the agent how to bootstrap.
    const msg = buildOnboardingMessage();
    const reminderIdx = msg.indexOf("meta-edit reminder:");
    const skillIdx = msg.indexOf("typed-edit-onboarding");
    expect(reminderIdx).toBeGreaterThanOrEqual(0);
    expect(skillIdx).toBeGreaterThan(reminderIdx);
  });
});

import { describe, expect, it } from "bun:test";
import { buildReminderContext } from "./context.js";

describe("buildReminderContext", () => {
  it("builds a declaration-accepted reminder for a boundary production edit", () => {
    const text = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "prod",
      provenance: "direct_observation",
      targetFile: "src/range.ts",
      declaredTestFiles: ["tests/range.test.ts"],
    });

    expect(text).toContain("meta-edit reminder:");
    expect(text).toContain("I declared this as edit_boundary_condition");
    expect(text).toContain("production code");
    expect(text).toContain("pin just below, at, and just above");
    expect(text).toContain("run that red test");
    expect(text).toContain("makes it pass");
    expect(text).toContain('target="test"');
    expect(text).toContain("tests/range.test.ts");
    expect(text).toContain("direct observation");
    expect(text).not.toContain("Do not");
  });

  it("builds a write-allowed reminder in self-reminder wording", () => {
    const text = buildReminderContext({
      phase: "write_allowed",
      kind: "edit_api_contract",
      target: "prod",
      provenance: "accepted_artifact",
      targetFile: "src/api.ts",
      declaredTestFiles: ["tests/api.test.ts"],
    });

    expect(text).toContain("meta-edit reminder:");
    expect(text).toContain("This native write matched my edit_api_contract");
    expect(text).toContain("Before moving on, I should check whether the chosen kind and file scope still match the actual edit");
    expect(text).toContain("fresh typed declaration");
    expect(text).toContain("edit_api_contract");
    expect(text).toContain("expose the compatibility, status-code, or missing/extra-field contract");
    expect(text).toContain("accepted artifact");
    expect(text).toContain('target="test"');
    expect(text).not.toContain("Forbidden");
  });

  it("injects TDD red-step cues for target=test declarations", () => {
    const text = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_permission_logic",
      target: "test",
      provenance: "direct_observation",
      targetFile: "tests/auth.test.ts",
    });

    expect(text).toContain("target=\"test\"");
    expect(text).toContain("same kind of change");
    expect(text).toContain("TDD red step");
    expect(text).toContain("fail against the current production code for the intended reason");
    expect(text).toContain("If it already passes");
    expect(text).toContain("distinguish allowed and denied actors or states");
  });

  it("keeps workflow decision wording tied to accepted project intent", () => {
    const text = buildReminderContext({
      phase: "write_allowed",
      kind: "edit_decision",
      provenance: "user_confirmed",
      targetFile: "docs/adr.md",
    });

    expect(text).toContain("edit_decision");
    expect(text).toContain("accepted project intent");
    expect(text).toContain("user-confirmed");
  });

  it("keeps explanation wording tied to shipped behavior and observation source", () => {
    const text = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_explanation",
      provenance: "direct_observation",
      targetFile: "README.md",
    });

    expect(text).toContain("edit_explanation");
    expect(text).toContain("shipped behavior");
    expect(text).toContain("observation source");
  });

  it("surfaces audit warnings without changing them into denials", () => {
    const text = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_observation",
      provenance: "inference",
      targetFile: "docs/notes.md",
      auditWarnings: [
        {
          code: "kind_provenance_warn",
          message: "observation + inference is atypical",
        },
      ],
    });

    expect(text).toContain("audit warnings recorded");
    expect(text).toContain("[kind_provenance_warn] observation + inference is atypical");
    expect(text).toContain("I should land only if the prose carries that uncertainty");
  });

  it("uses repair wording for write-allowed uncertainty and audit warnings", () => {
    const text = buildReminderContext({
      phase: "write_allowed",
      kind: "edit_explanation",
      provenance: "inference",
      targetFile: "docs/notes.md",
      auditWarnings: [
        {
          code: "kind_provenance_warn",
          message: "explanation + inference needs careful wording",
        },
      ],
    });

    expect(text).toContain("if the landed prose sounds confirmed");
    expect(text).toContain("revise it with a fresh typed declaration");
    expect(text).toContain("audit warnings were recorded");
    expect(text).toContain("If the landed edit did not account for them");
    expect(text).not.toContain("I should land only if");
  });

  it("uses repair wording for write-allowed speculation", () => {
    const text = buildReminderContext({
      phase: "write_allowed",
      kind: "edit_proposal",
      provenance: "speculation",
      targetFile: "docs/notes.md",
    });

    expect(text).toContain("if the landed prose reads as established fact");
    expect(text).toContain("fresh typed declaration");
    expect(text).toContain("unverified hypothesis");
    expect(text).not.toContain("I should land only if");
  });

  it("repeating_failure on an impl tool gives the corrective ordered procedure", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "repeating_failure",
    });
    expect(out).toContain("escape procedure");
    expect(out).toContain("(1)");
    expect(out).toContain("(4)");
    expect(out).toContain("primary sources");
  });
  it("repeating_failure on edit_observation gives supportive escape text", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_observation",
      executionState: "repeating_failure",
    });
    expect(out).toContain("this is the right move");
    expect(out).not.toContain("(1)");
  });
  it("repeating_failure on edit_progress adds no execution_state text", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_progress",
      executionState: "repeating_failure",
    });
    expect(out).not.toContain("escape procedure");
    expect(out).not.toContain("this is the right move");
  });
  it("repeating_failure on edit_policy_change adds no execution_state text (workflow-axis kind, not a fix attempt — PR #96 codex review P2)", () => {
    // After the v0.7.x reshape edit_policy_change is a workflow-axis
    // kind. A workflow declaration is not a fix attempt, so the
    // impl-flavored "before stacking another fix" escape text would
    // be misleading. Mirrors the edit_progress assertion above.
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_policy_change",
      executionState: "repeating_failure",
    });
    expect(out).not.toContain("escape procedure");
    expect(out).not.toContain("stacking another fix");
    expect(out).not.toContain("this is the right move");
  });
  it("recovery gives supportive recovery text", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "recovery",
    });
    expect(out).toContain("recovery");
  });
  it("normal adds no execution_state text", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "normal",
    });
    expect(out).not.toContain("escape procedure");
    expect(out).not.toContain("recovery");
  });
  it("returns no execution_state text for an unknown state value (catch-all)", () => {
    const out = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "uncertain", // not a real state — caller typo
    });
    expect(out).not.toContain("escape procedure");
    expect(out).not.toContain("recovery");
    expect(out).not.toContain("this is the right move");
  });

  it("write_allowed gives the post-hoc variant for repeating_failure x impl", () => {
    const out = buildReminderContext({
      phase: "write_allowed",
      kind: "edit_boundary_condition",
      target: "prod",
      executionState: "repeating_failure",
    });
    expect(out).toContain("landed while");
  });

  it("has a specific next-action cue for every live edit kind", () => {
    const cases: Array<[string, string]> = [
      ["edit_boundary_condition", "pin just below, at, and just above"],
      ["edit_boolean_condition", "make the important true/false condition combinations visible"],
      ["edit_state_transition", "show the allowed transition and the forbidden transition"],
      ["edit_db_schema", "cover the schema shape and the migration impact"],
      ["edit_data_migration", "compare existing data before and after"],
      ["edit_api_contract", "expose the compatibility, status-code, or missing/extra-field contract"],
      ["edit_serialization", "cover round-trip behavior and any legacy format still accepted"],
      ["edit_error_handling", "drive the intended failure path"],
      ["edit_retry_timeout", "cover retry count, timeout, and exhaustion behavior"],
      ["edit_concurrency", "exercise the interleaving or duplicate action"],
      ["edit_external_side_effect", "protect against duplicate or unintended external action"],
      ["edit_cache_invalidation", "distinguish stale reads from refreshed reads"],
      ["edit_permission_logic", "distinguish allowed and denied actors or states"],
      ["edit_dependency_config", "make the runtime or environment impact explicit"],
      ["edit_policy_change", "confirm the user-facing scope"],
      ["edit_cosmetic", "semantic no-op"],
      ["edit_progress", "record session progress"],
      ["edit_observation", "keep the observed fact and evidence visible"],
      ["edit_proposal", "stay proposal-shaped until accepted"],
      ["edit_decision", "read as accepted project intent"],
      ["edit_explanation", "read as shipped behavior for future readers"],
    ];

    for (const [kind, cue] of cases) {
      const text = buildReminderContext({
        phase: "write_allowed",
        kind,
        provenance: "direct_observation",
        targetFile: "x",
      });
      expect(text).toContain(cue);
    }
  });

  // SPEC §3.3.5 — per-kind × per-target obligations relocated from
  // descriptions to the reminder. Anchor phrases lifted from
  // sqlite.org/testing.html vocabulary with section markers stripped
  // (D15: runtime text carries the concept, not the citation).
  it("emits a target=test obligation paragraph for every SQLite-derived impl kind", () => {
    const cases: Array<[string, string]> = [
      ["edit_boundary_condition", "defined limits"],
      ["edit_boolean_condition", "atomic condition independently flips"],
      ["edit_state_transition", "legal transition graph"],
      ["edit_db_schema", "schema invariants"],
      ["edit_data_migration", "before/after invariants"],
      ["edit_api_contract", "published interface"],
      ["edit_serialization", "round-trip equivalence"],
      ["edit_error_handling", "injected failure"],
      ["edit_retry_timeout", "exhaustion semantics"],
      ["edit_concurrency", "across-interleaving invariant"],
      ["edit_external_side_effect", "outside world"],
      ["edit_cache_invalidation", "freshness invariant"],
      ["edit_permission_logic", "authorization matrix"],
      ["edit_dependency_config", "build matrix"],
    ];
    for (const [kind, phrase] of cases) {
      const text = buildReminderContext({
        phase: "declaration_accepted",
        kind,
        target: "test",
        provenance: "accepted_artifact",
        targetFile: "x.test.ts",
      });
      expect(text).toContain(phrase);
    }
  });

  it("emits a target=prod obligation paragraph for every SQLite-derived impl kind", () => {
    const cases: Array<[string, string]> = [
      ["edit_boundary_condition", "defined limits stable on both sides"],
      ["edit_boolean_condition", "each clause's independent effect"],
      ["edit_state_transition", "legal transitions"],
      ["edit_db_schema", "invariants enforceable by the DB itself"],
      ["edit_data_migration", "safe under interruption and re-run"],
      ["edit_api_contract", "published interface stable"],
      ["edit_serialization", "serialized form readable by older consumers"],
      ["edit_error_handling", "every error path observable from the outside"],
      ["edit_retry_timeout", "budget, backoff schedule, and giveup signal"],
      ["edit_concurrency", "lock order"],
      ["edit_external_side_effect", "at-least-once"],
      ["edit_cache_invalidation", "cached answer == authoritative answer"],
      ["edit_permission_logic", "every cell's allow/deny decision"],
      ["edit_dependency_config", "same answer across all supported build variants"],
    ];
    for (const [kind, phrase] of cases) {
      const text = buildReminderContext({
        phase: "declaration_accepted",
        kind,
        target: "prod",
        provenance: "accepted_artifact",
        targetFile: "x.ts",
        declaredTestFiles: ["x.test.ts"],
      });
      expect(text).toContain(phrase);
    }
  });

  it("emits no obligations paragraph for edit_cosmetic regardless of target (§3.3.5 carve-out)", () => {
    const hallmarks = [
      "defined limits",
      "published interface",
      "at-least-once",
      "authorization matrix",
    ];
    for (const t of ["prod", "test"] as const) {
      const text = buildReminderContext({
        phase: "declaration_accepted",
        kind: "edit_cosmetic",
        target: t,
        provenance: "accepted_artifact",
        targetFile: "x.ts",
      });
      for (const h of hallmarks) {
        expect(text).not.toContain(h);
      }
    }
  });

  it("emits no obligations paragraph for workflow kinds (no target axis)", () => {
    const workflowKinds = [
      "edit_progress",
      "edit_observation",
      "edit_proposal",
      "edit_decision",
      "edit_explanation",
      "edit_policy_change",
    ];
    const hallmarks = [
      "defined limits",
      "published interface",
      "at-least-once",
      "authorization matrix",
    ];
    for (const kind of workflowKinds) {
      const text = buildReminderContext({
        phase: "declaration_accepted",
        kind,
        provenance: "accepted_artifact",
        targetFile: "x.md",
      });
      for (const h of hallmarks) {
        expect(text).not.toContain(h);
      }
    }
  });

  it("renders target_spec_derivation_warn through auditWarningsLine", () => {
    const text = buildReminderContext({
      phase: "declaration_accepted",
      kind: "edit_boundary_condition",
      target: "test",
      provenance: "direct_observation",
      targetFile: "x.test.ts",
      auditWarnings: [
        {
          code: "target_spec_derivation_warn",
          message: "test pins implementation-observed behavior",
        },
      ],
    });
    expect(text).toContain("target_spec_derivation_warn");
    expect(text).toContain("test pins implementation-observed behavior");
  });

  it("runtime obligation text carries no SQLite section meta-citation (D15 grep gate)", () => {
    // Sample a handful of (kind, target) cells and assert the rendered
    // reminder does not leak SQLite §x.y citations that exist in the
    // design.md drafts for traceability.
    const samples: Array<[string, "prod" | "test"]> = [
      ["edit_boundary_condition", "test"],
      ["edit_boundary_condition", "prod"],
      ["edit_data_migration", "test"],
      ["edit_external_side_effect", "prod"],
      ["edit_permission_logic", "test"],
    ];
    const forbidden = /§[0-9]+(\.[0-9]+)*( retention| compound| -style)?/;
    for (const [kind, t] of samples) {
      const text = buildReminderContext({
        phase: "declaration_accepted",
        kind,
        target: t,
        provenance: "accepted_artifact",
        targetFile: t === "test" ? "x.test.ts" : "x.ts",
        ...(t === "prod" ? { declaredTestFiles: ["x.test.ts"] } : {}),
      });
      expect(text).not.toMatch(forbidden);
    }
  });
});

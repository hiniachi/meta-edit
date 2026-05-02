---
created_at: 2026-05-03T01:05:00+09:00
id: dogfood-2026-05-03-1110
category: ux/agent-burden
severity: low-medium
target_file: src/tools/common.ts
related_files:
  - src/hooks/raw-edit-policy.ts (legacy simulate, removed in v0.2.1)
discovered_in: 2026-05-03 v0.2.1 dogfood agent-burden audit
---

# [UX] Edit's `old_string` uniqueness is the agent's responsibility, with no helper from meta-edit

## Status

✅ **CLOSED — option 3 accepted** by PR #61 (merged 2026-05-02).
Per the PR body: "the no-match-or-multi-match error is reported by
native Edit AFTER the deny-raw-edit hook approves, so meta-edit has
no detection surface here without re-implementing Edit's matcher
(Article 7 out-of-scope)." Constitutional default (rely on Claude
Code's native Edit) stands.

## Concrete burden

Claude Code's native `Edit` requires `old_string` to occur **exactly
once** in the file. When the agent wants to change a pattern that
appears multiple times (e.g., one of N similar `if (x)` lines), it
must widen `old_string` with surrounding context until it is unique.
This is mechanical work the agent must redo from scratch on every
edit.

The hook (`evaluateTokenedEdit`) trusts native Edit's enforcement —
no simulate() in v0.2.1 — so the failure mode is "Edit returns
no-match-or-multi-match error after typed_edit already issued the
token", wasting one declaration cycle.

## Possible mitigations

1. **`edit_*` tool returns context-anchored old/new pairs** — the
   typed_edit could accept a "logical anchor" (e.g., line number or
   structural marker) and produce widened old_string for the agent.
   Adds detection logic; out of scope per Article 7.
2. **Agent-side helper skill** — a separate skill / command (not
   meta-edit) that takes a "logical edit" and emits the unique
   `old_string`. Stays outside the typed surface.
3. **Accept the burden** — rely on Claude Code improving native Edit
   itself.

Option 3 is the constitutional default. Filed for visibility; not
recommending action unless dogfood shows the friction is biting hard.

## Severity

Low-medium — the friction is real but only on multi-occurrence patterns,
and it's inherent to native Edit, not specific to meta-edit's typed
surface.

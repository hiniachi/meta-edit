---
created_at: 2026-05-03T01:05:00+09:00
id: dogfood-2026-05-03-1111
category: design/tool-surface
severity: medium
target_file: src/tools/common.ts
related_files:
  - docs/SPEC.md
discovered_in: 2026-05-03 v0.2.1 dogfood agent-burden audit
---

# [DESIGN] `test_files` upfront declaration burden — agent has to commit to test paths before knowing them

## Concrete burden

Every SQLite-derived production tool (15 of the 17, excluding
`edit_refactor_only` and `edit_test_only_change`) requires
`test_files: [...]` to be non-empty in the declaration. The agent has
to commit to which test files will cover the change *before* making
the production edit.

Failure modes observed:
- Agent guesses test paths that don't exist; declaration succeeds but
  the forward declaration is bogus, polluting the audit log.
- Agent stops to grep / list test files first → extra round trip.
- Agent picks an unrelated existing test file just to pass the
  validation, with no real coverage relationship.

## Why the upfront declaration

Article 6: `test_files` is a forward declaration the agent commits to
fulfilling via subsequent `edit_test_only_change` calls. The
discipline is intentional — committing in advance to "I will write
tests that cover this" is the cognitive intervention.

The friction is real, though.

## Options

1. **Allow placeholder in `test_files`** — accept entries like
   `"<TBD>"` that count as non-empty but are explicitly opt-out of
   path validity. The agent fills in the real path on the
   `edit_test_only_change` follow-up. Audit log records the
   placeholder + the resolution.
2. **Declare via a separate tool call** — split production edit and
   test-file forward-declaration into two typed_edit calls. Doubles
   the declaration count. Probably worse UX, not better.
3. **Loosen validation: accept paths that don't exist yet** — current
   behavior already does this for `edit_create_file`'s create case.
   Generalize: "`test_files` paths may or may not exist; failure to
   create them later is auditable but not validated upfront".
4. **Accept the burden** — the cognitive intervention requires the
   agent to know what tests they will write. Not knowing means
   they're not yet ready to declare the production edit.

Option 4 is the constitutional default. Option 3 is a soft
clarification that's already implicit. Option 1 introduces new
audit-log semantics. Option 2 is worse UX.

## Severity

Medium — observed friction is real but Article 6 explicitly endorses
the discipline. The right fix may be description-tone refinement
("forward declarations may name files that do not yet exist") rather
than schema change.

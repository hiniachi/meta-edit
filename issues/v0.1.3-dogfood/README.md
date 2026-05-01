# v0.1.3 dogfood observations

Filed 2026-05-01 after exercising all 18 `edit_*` tools in `test-playground/` (gitignored). All 18 tools applied successfully on valid input. Findings below are friction or security gaps surfaced during the exercise.

## Summary table

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| dogfood-001 | MEDIUM | security/bash-bypass | `printf > <in-repo>` not denied |
| dogfood-002 | MEDIUM | ux/error-message | "stale old_content" misleading on substring input |
| dogfood-003 | LOW | ux/path-handling | `..` traversal silently normalizes |
| dogfood-004 | LOW | ux/redundant-warning | Duplicate protected-path warnings |
| dogfood-005 | MEDIUM | security/bash-bypass | DENY_SUBSTRINGS + protected-path scans not quote-aware |
| dogfood-006 | LOW | ux/workflow-gap | No CREATE tool — bootstrap forces bypass |
| dogfood-007 | MEDIUM | ci/version-drift | Add package.json↔plugin.json version sync check |
| dogfood-008 | LOW | ux/install-flow | Marketplace clone does not auto-update |
| dogfood-009 | MEDIUM | ux/messaging | Error messages reference project-internal docs (docs/SPEC.md, OBSERVED-FAILURES.md, CLAUDE.md) |

## Tools verified working (18/18)

All 18 tools applied a representative valid edit successfully (edit IDs 0001-0018, 0031). Plus the rejection paths (empty rationale, stale content, protected path, no-op, scope mismatch, NUL byte, duplicate target) returned clear `applied:false` responses with descriptive warnings.

## Out-of-scope observations (not filed as issues)

- **Claude Code outer permission layer intercepts /etc/passwd and /tmp paths before meta-edit gets the call.** The user is prompted to approve scope-escalation; meta-edit-side validation never runs in this case. Working as intended at the harness level.
- **context-mode hook false-positive on `fetch(` substring in source content.** Unrelated to meta-edit; affects unrelated plugins as well.

## Decided follow-up plan

Discussion with maintainer concluded:

- **dogfood-001 + dogfood-005 + dogfood-006 are linked**: the bash hook deny-list is structurally incomplete (forever chasing new write verbs), and the lack of a CREATE tool forces agents to use the bypass surface for bootstrap. Solution is paired:
  1. **Add `edit_create_file`** as a 19th tool with `O_CREAT|O_EXCL` and required `test_files`.
  2. **Switch bash policy from deny-list to allow-list**: deny ALL redirect (`>`, `>>`, `>|`) to in-repo paths regardless of upstream verb, plus existing file-arg write verbs (mv/cp/sed -i/dd of=/tee/install). Existing `isInRepoWriteTarget` allowlist (`/dev/null`, `/tmp/`, etc.) stays.

  Phased rollout: CREATE tool first (no behavior break), then policy reversal in a second PR (with CREATE route already in place to handle bootstrap).

- **dogfood-009** can ship independently — pure docs/messaging change.
- **dogfood-002** (snippet vs full-file message) ships independently.
- **dogfood-003, 004, 007, 008** are small-cleanup follow-ups, schedulable as a batch.

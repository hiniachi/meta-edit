---
id: dogfood-009
category: ux/messaging
severity: MEDIUM
affected_files:
  - src/cli.ts
  - src/hooks/bash-write-policy.ts
  - src/hooks/raw-edit-policy.ts
  - src/tools/descriptions.ts
---

# [UX] User-facing messages reference project-internal docs and filenames

## Summary

meta-edit ships as a Claude Code plugin to OTHER projects. Hook deny messages, CLI help text, and tool descriptions all reference paths that exist only inside the meta-edit source tree (`docs/SPEC.md`, `CLAUDE.md`, `OBSERVED-FAILURES.md`). End users editing their own project never see those files — the references point nowhere actionable.

Concrete leaks I tripped during dogfood:

| File | Line | Message |
|------|------|---------|
| `src/cli.ts` | 101 | "See docs/SPEC.md for full specification." (printed in `--help`) |
| `src/hooks/bash-write-policy.ts` | 472 | "...route it through the allowlist (see docs/SPEC.md §5.2)." (bash deny reason) |
| `src/hooks/raw-edit-policy.ts` | 26 | "Choose one of the eighteen edit_* tools that match the kind of change you are making (see docs/SPEC.md §4)." (raw-edit deny reason) |
| `src/tools/descriptions.ts` | 540 | "Modifying CLAUDE.md or other AI-instruction files" (example inside `edit_policy_change` description) |
| `src/tools/descriptions.ts` | 578 | "Editing OBSERVED-FAILURES.md and similar project meta-documentation" (example inside `edit_docs_only` description) |

## Why this matters

When deny-raw-edit fires in a downstream project, the user sees: "see docs/SPEC.md §4". They have no `docs/SPEC.md` in their checkout. The reference is dead. This is the worst kind of error — tells the user there is more information without telling them where to find it.

Tool description examples (rows 4-5) are subtler: an agent reading the `edit_policy_change` description sees "modifying CLAUDE.md" as a concrete example, but the agent operating in say a Rails project has no CLAUDE.md to anchor on. The example fails to clarify the tool semantics.

## Suggested fix direction

1. **Replace doc references with public URLs.** When meta-edit ships, point at the published docs: `https://github.com/hiniachi/meta-edit/blob/main/docs/SPEC.md#section-N`. Bake the URL into a single constant so version-pinning is straightforward.

2. **Genericize tool description examples.** Replace project-specific filenames with category descriptions: "Modifying AI-instruction files (CLAUDE.md, AGENTS.md, etc.)" or just "AI-instruction files in the project root." For `edit_docs_only`: "Editing project meta-documentation (CHANGELOG, ROADMAP, post-mortems)." Agents read the description verbatim; the verbatim copy needs to be project-agnostic.

3. **Self-contained deny messages where possible.** The raw-edit deny already explains what to do ("Choose one of the eighteen edit_* tools..."); the SPEC reference is supplementary. Consider dropping the reference entirely or moving it to the `additionalContext` field on the hook response (Claude Code surfaces this less prominently).

## Out of scope notes

CLAUDE.md §4 says descriptions are "verbatim from SPEC.md §4" — so changing description examples requires the matching SPEC edit in the same PR (already a documented invariant). The propagation cost is real but small.

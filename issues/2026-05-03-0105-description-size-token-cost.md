---
created_at: 2026-05-03T01:05:00+09:00
id: dogfood-2026-05-03-1112
category: ux/token-cost
severity: low
target_file: src/tools/descriptions.ts
related_files:
  - docs/SPEC.md
discovered_in: 2026-05-03 v0.2.1 dogfood agent-burden audit
---

# [UX] 19 tool descriptions cost ~7-8K tokens loaded on every typed_edit call

## Measurement

`src/tools/descriptions.ts` is roughly 31 KB / 600 lines / ~8K tokens
of static prose. Every typed_edit call surfaces all 19 tool
descriptions in the agent's context, because that's how the bet works
(descriptions are loaded at every invocation). Median description is
~30 lines, longest is 48 (`edit_create_file`).

The 19-tool surface is constitutional (Article 4); shrinking the
**count** would weaken the cognitive-intervention bet. But the
**per-tool prose** has accreted over multiple cleanup passes and
sometimes repeats itself.

## Friction observed

For agents on tight context budgets (e.g., past 50% of context
window), the 7-8K token tax to surface the typed surface starts to
matter. In long sessions the typed_edit call costs more than the
edit it produces.

## Options

1. **Description-tone refresh** (post-v0.2.1) — rewrite the longest
   tool descriptions in the "safe, comfortable, organize your
   thinking" tone Article 4 mandates. Aim for a median of ~20 lines
   per tool. Drop redundant "MUST NOT be used when" lists where the
   positive "Use this tool when" is already specific.
2. **Compressed alt prose loaded by default, expanded on demand** —
   not feasible: MCP clients don't have a "drill down" mechanism for
   tool descriptions.
3. **Accept the tax** — 7-8K tokens is the cost of the bet. v0.3 may
   refine.

## Severity

Low — observable but not blocking. Constitutional acceptance is
reasonable. Filed for tracking.

## Notes

- `edit_refactor_only`'s "MUST NOT be used when" list is 12 bullets;
  could be condensed to 3-5 categories with examples.
- `edit_create_file` is 48 lines; its prose can be tightened
  significantly without loss.
- The fallback-obligation paragraphs added in v0.1.6 (3 tools) are
  good content; not the trim target.

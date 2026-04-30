## Summary

What changed and why. Reference any related issue.

## Scope

- [ ] In scope per [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`docs/SPEC.md`](../docs/SPEC.md) §3.
- [ ] If this adds detection / classification logic, please justify why.

## Test plan

- [ ] `bun test` passes locally.
- [ ] `bun run typecheck` clean.
- [ ] `bun run build` produces a working `dist/`.
- [ ] CI matrix (Bun + Node 20) passes.
- [ ] Manual smoke test if behavior is user-facing.

## Description verbatim rule

If this PR touches `src/tools/descriptions.ts`:

- [ ] The same change is reflected in `docs/SPEC.md` §4 in this same PR.
- [ ] The description was NOT paraphrased / reworded for prose quality.

## Observed failures

- [ ] No new entry needed.
- [ ] Closes the following `OBSERVED-FAILURES.md` entry: `<heading>`
- [ ] Adds a new `OBSERVED-FAILURES.md` entry for an accepted-as-MVP-limit gap.

## Reviewer notes

Anything reviewers should focus on (security boundary changes,
backward-compat concerns, observed bypass cases, etc.).

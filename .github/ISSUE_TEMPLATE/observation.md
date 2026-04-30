---
name: Observed failure (v0.2 candidate)
about: Report a real-world bypass / false-positive that didn't trigger a CRITICAL fix in v0.1
title: "[observed] "
labels: observation
assignees: ''
---

## What slipped through (or what was over-rejected)

Description of the actual agent behavior or command shape that
revealed the gap.

## Where it happened

Which component? Which validation rule? Reference the relevant
`OBSERVED-FAILURES.md` entry if one already exists.

## Frequency / impact

How often did you see this? Was it agent-led or a deliberate test?

## Proposed mitigation

Open question or specific fix idea. v0.2 may pick this up; per
[`docs/SPEC.md`](../../docs/SPEC.md) §11 we deliberately avoid
implementing detection in MVP unless observation justifies it.

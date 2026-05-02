---
created_at: 2026-05-03T01:05:00+09:00
id: dogfood-2026-05-03-1109
category: design/tool-surface
severity: medium
target_file: src/hooks/raw-edit-policy.ts
related_files:
  - docs/SPEC.md
discovered_in: 2026-05-03 v0.2.1 dogfood agent-burden audit
---

# [DESIGN] NotebookEdit is denied with no typed-surface recourse

## Status

✅ **RESOLVED** by PR #61 (merged 2026-05-02, commit `a66c098`).
Explicit NotebookEdit deny removed from `evaluateTokenedEdit`. The
prerequisite groundwork shipped earlier (v0.2.1 dropped `simulate()`,
v0.2.2 added `notebook_path` extraction, v0.2.3 added the
out-of-repo allow), so NotebookEdit now routes through the same
canonicalize → grant → consume → `before_sha256` staleness flow as
the other three raw edits. Option 2 of this filing was taken.

## Background

`evaluateTokenedEdit` in `src/hooks/raw-edit-policy.ts` denies any
`NotebookEdit` call unconditionally with:

```
meta-edit denies "NotebookEdit" (out of v0.2 scope).
```

The agent's only path forward is to convert the notebook edit into a
plain-file edit through one of the 19 typed tools. For projects that
include `.ipynb` notebooks (data-science, ML repos), the typed surface
provides no recourse — the agent must either bypass meta-edit or
restructure the notebook into source files.

## Why this matters

Article 4 declares the typed surface as 19 tools (17 SQLite-derived +
2 workflow). Notebooks are a real workflow surface in some projects
but are silently absent from the surface. Currently a notebook-heavy
session has no clean way to use meta-edit at all.

## Options

1. **Add a 20th tool `edit_notebook_cell`** — a workflow tool whose
   declaration says "I am modifying notebook cell N of <file>".
   Requires the hook to model NotebookEdit's `cell_id` semantics.
2. **Allow NotebookEdit through any existing edit_* tool** — relax
   the policy entry deny so the binding is checked the same way. The
   simulate() check is gone in v0.2.1 so this is mostly free.
3. **Stay denied; document loudly** — keep current behavior and
   explicitly call out notebooks as outside meta-edit's scope. v0.3
   could revisit with a `meta-edit-notebook` companion plugin.

Option 2 is the cheapest extension; option 1 fits the cognitive-
intervention bet best (notebooks are their own kind of edit). Option
3 punts the decision.

## Out-of-scope notes

- v0.2.1 already drops simulate(), so the original technical reason
  for denying NotebookEdit (couldn't simulate cell-edits) is gone.
- The dogfood audit flagged this as MED because notebook-heavy users
  are blocked entirely, not because most users hit it.

---
id: dogfood-006
category: ux/workflow-gap
severity: LOW
affected_files: [docs/SPEC.md, src/tools/]
---

# [UX] No CREATE tool — bootstrapping new files requires bypassing the typed surface

## Summary

The 18 `edit_*` tools are all modify-only by design (per SPEC.md). When seeding new test files or scaffolding fresh code, agents must fall back to one of:

1. Raw `Write` — blocked by `deny-raw-edit`
2. `cat`/`tee`/`dd` redirect — blocked by `deny-bash-write-bypass` for in-repo paths
3. `printf > file` — currently allowed (see dogfood-001)

In practice agents settle on path 3, which is exactly the bypass surface dogfood-001 targets. So either the project accepts a write-path it considers a security gap, or it provides an explicit creation tool. Right now the workflow forces the choice silently.

## Suggested fix direction

Two options:

1. **Add `edit_create_file`** as a 19th tool with strict scope: target path must not exist, must declare creation rationale, test_files required (consumers always need to test new code). Requires server-side `O_CREAT|O_EXCL` to remain consistent with the modify-only invariants of the other 18.

2. **Document the bootstrap escape hatch explicitly** in SPEC.md so users do not have to discover it: "for first-time scaffolding, use `printf` redirect; once the file exists, future edits go through `edit_*`." This is honest about the current design.

## Out of scope notes

Option 1 is more invasive but closes the bootstrap-via-bypass loop. Option 2 is a one-paragraph doc change. The current behavior is option 0 (silent gap) and that is the friction.

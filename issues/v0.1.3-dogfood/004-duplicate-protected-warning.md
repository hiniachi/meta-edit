---
id: dogfood-004
category: ux/redundant-warning
severity: LOW
affected_files: [src/tools/common.ts]
---

# [UX] Protected-path violation emits two warnings for the same path

## Summary

When `target_file === change.file` and the path resolves into a protected directory under the meta-edit state tree, the validator emits two near-identical warnings — one for `target_file` scope, one for `change.file`. Both point at the same canonical issue. Slight UX noise; agents reading the warnings may try to fix two things when there is one.

## Reproduction

Call any `edit_*` tool with target_file and change.file pointing at the same protected-tree path. Two warnings are returned, both quoting the same path with the same protected-directory reason.

## Suggested fix direction

Deduplicate by canonical-path: if `target_file` and a `change.file` share canonical, emit a single warning. Or skip the `target_file`-level warning when at least one `change.file` produces the same warning (the change.file is the operative target).

## Out of scope notes

Minor cleanup; correctness unaffected.

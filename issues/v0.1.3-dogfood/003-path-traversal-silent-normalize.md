---
id: dogfood-003
category: ux/path-handling
severity: LOW
affected_files: [src/tools/common.ts]
---

# [UX] `..` path traversal silently normalizes; warning quotes target after normalization

## Summary

Passing `target_file: "test-playground/../package.json"` is silently normalized to `package.json` (repo root). The subsequent "stale old_content" warning then references `"package.json"` rather than the path the caller declared, which is confusing — the caller might think they targeted the playground file but the apply path was rebased to the repo root.

## Reproduction

Call `edit_refactor_only` with `target_file: "test-playground/../package.json"` and matching `change.file`. The warning quotes the normalized path, not the original. No "path was normalized" notice.

## Suggested fix direction

When `path.normalize(p) !== p`, emit an explicit warning that surfaces the normalization. Preserves the apply (no behavior change) while making the normalization observable.

## Out of scope notes

Low severity because the apply itself rejected for other reasons. But if the caller passes both `target_file` and `change.file` with `..` traversal AND the right `old_content`, the unintended file gets written silently.

---
name: Bug report
about: Report a bug in an edit_* tool, hook, or CLI subcommand
title: "[bug] "
labels: bug
assignees: ''
---

## What

Which component? (`edit_<name>` / `deny-raw-edit` / `deny-bash-write-bypass` / `meta-edit log` / `meta-edit summary` / `meta-edit install-hooks` / `meta-edit uninstall-hooks` / other)

## Reproducer

Minimal input that triggers the bug.

For an `edit_*` tool:

```json
{
  "target_file": "...",
  "patch": "...",
  "rationale": "...",
  "risk_level": "low|medium|high|critical",
  "test_files": []
}
```

For a hook: the stdin event JSON.

For a CLI subcommand: the exact `meta-edit ...` invocation.

## Expected behavior

What `docs/SPEC.md` says should happen.

## Actual behavior

What you observed (warnings, applied=false, crash, ...). Include the
matching line from `.meta-edit/state/edits.jsonl` if relevant.

## Environment

- meta-edit version (`meta-edit --version`):
- Bun version (`bun --version`):
- Node version (`node --version`):
- OS:

## Notes

Anything else relevant (recent changes, related `OBSERVED-FAILURES.md`
entries, etc.).

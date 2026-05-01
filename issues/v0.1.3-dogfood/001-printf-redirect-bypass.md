---
id: dogfood-001
category: security/bash-bypass
severity: MEDIUM
affected_files: [src/hooks/bash-write-policy.ts]
---

# [SECURITY] `printf > <in-repo-file>` is not denied by the bash hook

## Summary

During v0.1.3 dogfood I needed to seed sample files in `test-playground/` for exercising the 18 `edit_*` tools. Write is blocked by `deny-raw-edit`, and several write verbs (heredoc redirect, tee, dd-of) are caught by `deny-bash-write-bypass`. However, `printf "..." > test-playground/sample.ts` was allowed and successfully wrote in-repo source files via the bash hook.

This is consistent with the existing scoping design (the policy targets specific verbs, not every redirect), but `printf` is a write-equivalent verb in this context — the only thing distinguishing it from the `cat`+redirect pattern is that no one added a `printf` rule.

## Reproduction

```bash
printf "%s" "leak" > test-playground/sample.ts   # currently: allowed
```

## Suggested fix direction

Add `printf` (and `echo` redirect chains) to the substring detection used for the existing in-repo write verbs. Alternatively: instead of per-verb substring matches, treat ANY non-read-only verb followed by `>` to an in-repo write target as a deny — closer to the spirit of `isInRepoWriteTarget`.

False-positive guard: `printf > /dev/null`, `printf > /tmp/...` should remain allowed via the existing `isInRepoWriteTarget` allowlist.

## Out of scope notes

- This is a refinement of the false-positive scoping landed in #31 R2; that PR addressed dd/tee/find but did not enumerate `printf`/`echo` redirect.
- No reproducing test in this issue per dogfood instructions.

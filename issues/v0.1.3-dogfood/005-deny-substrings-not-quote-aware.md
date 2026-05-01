---
id: dogfood-005
category: security/bash-bypass
severity: MEDIUM
affected_files: [src/hooks/bash-write-policy.ts]
---

# [SECURITY/UX] Substring scan and protected-path scan are not quote-aware

## Summary

Fix 435fb1b (PR #31 R2) added `stripQuotedContent` to neutralize quoted patterns inside string literals, but the helper is applied to ONLY two detection passes: heredoc and decode-and-execute. The DENY_SUBSTRINGS substring scan and the protected-path redirect scan still operate on raw command text, so legitimate documentation strings that contain the literal trigger phrases inside quotes get false-positive denied.

## Reproduction

During this dogfood I tried to write issue files via `printf ... > file.md` whose markdown bodies contained the literal phrase referencing the cat-redirect pattern. The bash hook denied with: command matches deny pattern. The same call denied a different time when the markdown body referenced a literal protected-tree path — the hook treated the documentation string as a redirect target.

Both denials fired even though the dangerous text was inside the outer single-quoted printf argument and never executed as shell. The same `stripQuotedContent` that protects heredoc detection should protect these scans.

## Suggested fix direction

Apply `stripQuotedContent` BEFORE: (a) DENY_SUBSTRINGS substring scan, (b) protected-path redirect detection. This is symmetrical with the existing quote-aware fix and addresses the same false-positive class.

Verify: existing in-repo deny tests for the cat-redirect pattern still deny the actual exploit (where the redirect is unquoted). Add allow tests for `printf` and `echo` writing markdown documents that mention the dangerous patterns inside string content.

## Out of scope notes

I worked around by avoiding the literal substrings in prose. This works but degrades documentation clarity, and is the kind of friction this project explicitly targets.

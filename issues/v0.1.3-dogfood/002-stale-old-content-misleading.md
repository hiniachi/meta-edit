---
id: dogfood-002
category: ux/error-message
severity: MEDIUM
affected_files: [src/tools/apply.ts, src/tools/common.ts]
---

# [UX] "stale old_content" error misleads when caller passed a substring

## Summary

The schema says `old_content` is the "Exact current content of the file" — i.e. the **whole file**. AI agents trained on Anthropic Edit (which uses an `old_string` snippet) consistently pass a fragment instead. When that fragment does not match disk byte-for-byte, the server returns:

```
applied: false
warnings: ["stale old_content for \"test-playground/sample.ts\"; disk content has changed since the request was prepared"]
```

The message implies a TOCTOU race (file changed after read). The actual cause is operator error: `old_content` was a snippet, not the full file. The agent diagnoses incorrectly ("the file changed somehow, let me re-read"), retries with the same fragment, fails again — easy to spend several round-trips before recognizing the contract.

## Reproduction

Disk file is ~200 bytes; passing 15 bytes (`MAX_RETRIES = 3`) as `old_content` returns the "stale" message. Lengths are clearly different but the diagnostic does not surface that.

## Suggested fix direction

1. Distinguish length mismatch vs content mismatch. When `disk_bytes.length !== old_content.length`, surface: "old_content (N bytes) does not match file size (M bytes); old_content must be the EXACT full file content, not a snippet. Use Read tool to obtain the current full content." When lengths match but bytes differ, the existing "stale" message is correct.

2. Add the contract reminder to the error itself rather than burying it in the schema description. AIs reading the failure message rarely re-read the schema.

## Out of scope notes

This was the single biggest source of friction during dogfood — wasted ~3 calls per session before recognizing the pattern.

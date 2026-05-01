---
id: a3-02
category: security/raw-edit-bypass
severity: HIGH
affected_files: [src/hooks/raw-edit-policy.ts]
test_file: src/hooks/raw-edit-policy.test.ts
---

# [SECURITY] `NotebookEdit` not blocked — Jupyter notebook edits bypass meta-edit gate

## Summary

`RAW_EDIT_TOOLS` contains only `"Edit"`, `"Write"`, and `"MultiEdit"`. Claude
Code also ships a `NotebookEdit` built-in tool that edits Jupyter notebook
(`.ipynb`) files cell-by-cell. Because `NotebookEdit` is absent from the deny
set, an agent can use it to rewrite notebook cells—which contain arbitrary
Python, JavaScript, or shell code—without going through any of the eighteen
`edit_*` tools, completely bypassing meta-edit's typed editing surface.

## Attack surface

`raw-edit-policy.ts` lines 8–12:

```typescript
export const RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  // NotebookEdit is absent
]);
```

`SPEC.md §5.1` states:

> Triggered on `PreToolUse` for `Edit`, `Write`, `MultiEdit`. Always denies.

`NotebookEdit` is not listed, creating a scope gap. Jupyter notebooks in a
repository can contain:

- Executable Python or shell (`!command`) cells used in CI pipelines or build scripts
- Data processing logic with side effects (DB writes, API calls)
- Test harnesses

Edits to these files warrant the same kind-specific discipline as edits to `.py`
or `.ts` source files. Omitting `NotebookEdit` from the deny set gives the agent
an unrestricted back-door for code changes that circumvents the entire tool
surface meta-edit is designed to enforce.

## Reproducing failing test

Add the following test to `src/hooks/raw-edit-policy.test.ts`.
It **currently passes** with `"allow"` — this documents the defect.

```typescript
// Add inside the existing describe("evaluateRawEdit", ...) block

it("denies NotebookEdit (scope gap: Jupyter notebooks contain executable code)", () => {
  // NotebookEdit is a Claude Code built-in that edits .ipynb files.
  // It is currently NOT in RAW_EDIT_TOOLS, so this assertion fails.
  const r = evaluateRawEdit("NotebookEdit");
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("edit_*");
});
```

Running `bun test src/hooks/raw-edit-policy.test.ts` with this test added will
fail because `evaluateRawEdit("NotebookEdit")` currently returns `{ decision: "allow" }`.

## Expected vs actual

| Input | Expected | Actual |
|---|---|---|
| `"NotebookEdit"` | `deny` | `allow` |

## Suggested fix direction

Add `"NotebookEdit"` to `RAW_EDIT_TOOLS`:

```typescript
export const RAW_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);
```

Additionally, update `SPEC.md §5.1` to list `NotebookEdit` explicitly so the
spec and implementation stay in sync (per CLAUDE.md §4: fixes propagate to both
files in the same change).

The `.claude/settings.json` hook matcher pattern `"Edit|Write|MultiEdit"` should
also be extended to `"Edit|Write|MultiEdit|NotebookEdit"` so the hook is actually
invoked for notebook edits.

## Out of scope notes

This is a scope gap in the existing deny list, not a request for classification
or detection logic. Adding `NotebookEdit` is strictly within MVP scope (§3).

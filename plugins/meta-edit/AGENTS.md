# AGENTS.md

This repository is the implementation and dogfood workspace for `meta-edit`.

## Read First

Before making changes, read:

1. `docs/SPEC.md`
2. `IMPLEMENTATION-LOG.md`
3. `OBSERVED-FAILURES.md` when the change touches policy or known failure modes

`docs/SPEC.md` is the source of truth for the twenty-one edit kinds, required
fields, grant flow, audit log, and scope boundaries.

## Editing Discipline

Use the `meta-edit` typed declaration tools before changing repository files.
Codex normally edits through `apply_patch`; after a typed declaration, the
Codex hook allows `apply_patch` only when every patch target has an active
matching grant and matching `before_sha256`.

Do not use shell writes such as `sed -i`, `cat > file`, `tee file`, or
`git apply` to edit source. Use `apply_patch` after a typed declaration.

If the `meta-edit` MCP server or hooks are unavailable, still honor the typed
surface as the project convention and call out any raw-edit fallback.

## Scope

Keep changes within the product described by `docs/SPEC.md`:

- twenty-one `edit_*` MCP tools
- grant issuing and consuming
- raw edit / apply_patch hook enforcement
- Bash write bypass policy
- edit log, `log`, `summary`, and install commands
- Claude Code, opencode, and Codex packaging

Do not add diff classification, mutation testing, PR gate judgment,
post-write verification, or generic detector machinery unless the user
explicitly overrides the spec scope.

## Tests And Build

Use focused tests while developing, then run:

```sh
bun test
bun run typecheck
bun run build
```

If a test is known to fail because of the harness or sandbox, report the exact
test and observed failure rather than claiming a green run.

## Descriptions

`src/tools/descriptions.ts` mirrors `docs/SPEC.md` section 4. Do not paraphrase
or improve those descriptions in one place only. Any real description fix must
update both files in the same change.

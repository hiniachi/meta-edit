# Contributing to meta-edit

Thanks for considering a contribution. The project is small and the
scope is narrow on purpose ([`docs/SPEC.md`](./docs/SPEC.md) §3 and
[`CLAUDE.md`](./CLAUDE.md) §3 explain why); please read those first.

## What's in scope

- Bug fixes for any of the nineteen `edit_*` tools, the two safety
  hooks, the edit log, or the CLI subcommands.
- Tightening of validation rules in `src/tools/common.ts` for
  documented bypass classes (see [`OBSERVED-FAILURES.md`](./OBSERVED-FAILURES.md)).
- Tests, docs, examples.

## What's out of scope (without prior discussion)

- Detection / classification of patch contents (whether a change is
  "really" a refactor, etc.). The whole bet is that **tool descriptions
  are enough**; adding detection prematurely makes that question
  impossible to answer cleanly.
- New `edit_*` tool categories — open an issue first with the failure
  mode you observed in production agent runs.
- Mutation testing, regression-coverage gates, plan/spec workspace
  protocols. These belong to other projects.

If you're not sure whether something is in scope, open an issue
labelled `discussion` before writing the code.

## Development setup

```sh
bun install
bun test
bun run typecheck
bun run build
```

Bun 1.x is the primary runtime. CI also runs the test suite under
Node 20 with Bun's `bun:test` shim.

## Pull request flow

1. Fork the repo and create a topic branch off `main`.
2. Make your change. Keep diffs small and focused.
3. Run `bun test` and `bun run typecheck` locally.
4. Open a PR with a clear description: what changed, why, and any
   relevant `OBSERVED-FAILURES.md` entries you're closing.
5. CI must pass on both Bun and Node before review.
6. Address review feedback in additional commits (don't force-push
   during review unless asked).

## Editing through `meta-edit`'s own tools

Once you have meta-edit running locally as an MCP server, use the
nineteen `edit_*` tools to make changes (per CLAUDE.md §6). The
descriptions are the product — read them at every call. If a
description tells you to "stop and ask", actually stop and ask.

## Reviewing tool descriptions

`src/tools/descriptions.ts` is copied verbatim from `docs/SPEC.md` §4.
If you change a description, update **both** in the same commit. Don't
paraphrase or "improve" the prose — it's tuned for instruction-
following, which is different from prose quality.

## Reporting bugs

Open a GitHub issue with:

- The `edit_*` tool you were using (or the hook / CLI subcommand).
- The exact input that triggered the bug.
- The actual behavior vs. the expected behavior per `docs/SPEC.md`.
- A line from `.meta-edit/state/edits.jsonl` if relevant.

Security issues — see [`SECURITY.md`](./SECURITY.md).

## Licensing

By contributing, you agree that your contribution will be licensed
under the same MIT license as the rest of the project.

---
created_at: 2026-05-03T20:30:00+09:00
id: dogfood-2026-05-03-2030
category: bug/mcp-validation
severity: high
target_file: src/tools/common.ts
related_files:
  - src/server.ts
  - "@modelcontextprotocol/sdk consumer"
discovered_in: 2026-05-03 opencode-migration implementation session
---

# [BUG] typed_edit calls reject non-empty `test_files: string[]` with "Expected array, received string"

## TL;DR

Calling any SQLite-derived typed_edit tool (e.g. `edit_policy_change`)
with a non-empty `test_files` array is rejected by Zod validation:

```
Invalid arguments for edit_policy_change: [
  {
    "code": "invalid_type",
    "expected": "array",
    "received": "string",
    "path": ["test_files"],
    "message": "Expected array, received string"
  }
]
```

`test_files: []` (empty array) is accepted — confirmed via repeated
successful `edit_docs_only` calls in the same session.

This blocks **every SQLite-derived typed_edit tool** because they all
require `test_files` non-empty per `TOOLS_REQUIRING_TEST_FILES`.
Workflow tools (`edit_docs_only` with empty `test_files`) and the two
opt-out tools (`edit_refactor_only`, `edit_test_only_change`) are
unaffected.

## Why HIGH

- **Self-application breaks**: per `CLAUDE.md` §6, edits to this repo
  go through typed_edit after Phase 3. Production-code changes
  legitimately requiring test obligations cannot be declared at all.
- **Silent on the working empty-array path**: empty `test_files: []`
  works, so the bug is not visible in surface-area smoke tests.
- **Affects 15 of 18 tools** (every SQLite-derived production tool).
  Only `edit_docs_only` (workflow), `edit_refactor_only`, and
  `edit_test_only_change` accept calls without test_files.
- **No agent-side workaround**: the agent has no way to coerce the
  argument to a different shape; the encoding pipeline is owned by the
  harness + MCP server.

## Reproduction

Within Claude Code with the meta-edit MCP server registered, invoke:

```
mcp__plugin_meta-edit_meta-edit__edit_policy_change({
  target_file: "src/hooks/raw-edit-policy.ts",
  rationale: "any non-empty rationale",
  risk_level: "low",
  test_files: ["src/hooks/raw-edit-policy.test.ts"]   // <-- this
})
```

Result: Zod validation error as quoted above. Same call with
`test_files: []` would also fail server-side validation (because the
tool requires non-empty), but the failure mode there would be the
*content* validation (TOOLS_REQUIRING_TEST_FILES) rather than the
*marshaling* validation. The bug is that the array shape itself is
mis-marshaled — the validator sees a string before any meta-edit
business rule runs.

Also reproduced with single-element arrays (`["a"]`,
`["src/foo.test.ts","src/bar.test.ts"]`) — the cardinality and content
are irrelevant; non-empty arrays are uniformly rejected.

## Root cause hypothesis (to verify in fix)

Likely one of:

1. **MCP SDK serialization bug**: when the harness serializes the
   tool-call arguments, non-empty `string[]` is JSON-stringified one
   level too many, arriving as `"[\"src/foo.test.ts\"]"` (a string)
   instead of `["src/foo.test.ts"]` (an array). The empty-array case
   may be special-cased or short-circuited elsewhere.
2. **Schema definition glitch in `src/tools/common.ts`**: the zod
   schema for `test_files` may have a transform / preprocessor that
   collapses arrays to strings under some condition. Unlikely given
   the empty-array path works, but worth ruling out by inspection.
3. **`additionalProperties` interaction**: tools' schemas use
   `additionalProperties: false`. If the MCP SDK quotes string-array
   parameters when `additionalProperties` is enforced, that would be
   the bug. Cross-check with `additional_files` (an array of objects)
   which **does** marshal correctly — the workflow-tool path was
   exercised successfully in the same session.

## Workaround (current session, partial)

For changes that fit `edit_refactor_only` (no test_files required) or
`edit_test_only_change` (test_files MUST be empty), use those tools.
For changes that legitimately require test_files (15 SQLite-derived
tools), there is **no workaround** — the call cannot land. The agent
must either (a) report the bug and stop, (b) decompose the change into
a refactor framing if applicable (semantically risky — many production
changes are not honest refactors), or (c) wait for the bug fix.

## Fix direction (out-of-scope items explicitly flagged)

1. **Inspect the MCP request payload at the server boundary** *(in
   scope, triage step)*. Add a debug log in `src/server.ts` that
   dumps the raw `arguments` object before Zod parsing — confirms
   whether the harness is delivering a string vs an array. This is a
   one-line `process.stderr.write(JSON.stringify(arguments))` before
   the schema validation.
2. **Locate the serialization layer at fault** *(in scope, post-1)*.
   If (1) shows the server receives a JSON-string, the bug is
   upstream of meta-edit (in the MCP SDK or harness). If the server
   receives an array, the bug is in our zod parsing.
3. **Coerce in the schema** *(workaround, only if upstream cannot be
   fixed quickly)*. Add a zod `preprocess` to `EditToolRequest.test_files`
   that JSON-parses string inputs into arrays. This is harness-bug
   compensation that should be removed once the upstream fix lands.
4. **DO NOT add a generic JSON-string fallback to every array
   parameter** *(out of scope per Article 7 / §3)*. Targeted compensation
   for known harness bugs, only with a pointer to the upstream issue.

## Notes for triage

- This bug is the reason the opencode-migration `OC-2` step
  (`add apply_patch to RAW_EDIT_TOOLS`) cannot land via `edit_policy_change`
  in its target session. Workaround under consideration: frame as
  `edit_refactor_only` since on the Claude Code path the change is
  observably a no-op (apply_patch isn't a Claude Code tool). The
  honest framing remains `edit_policy_change`; the workaround is a
  scope-stretch driven by this harness bug.
- Empty-array path (`test_files: []`) being accepted suggests the bug
  is in non-empty-array marshaling specifically. May be related to
  how the harness handles `minItems` / cardinality constraints on
  array schemas.
- `additional_files` (array of objects) marshaled correctly in the
  same session — the bug appears specific to **arrays of strings**.

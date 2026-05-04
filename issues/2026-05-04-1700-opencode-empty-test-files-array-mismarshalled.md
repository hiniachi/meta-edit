---
created_at: 2026-05-04T17:00:00+09:00
id: dogfood-2026-05-04-1700
category: bug/mcp-client-marshaling
severity: high
target_file: src/tools/common.ts
related_files:
  - src/opencode/plugin.ts
  - issues/2026-05-03-2030-mcp-string-array-arg-marshaling-bug.md
discovered_in: 2026-05-04 opencode E2E (post-PR #70 plugin runtime SKILL push)
---

# [BUG] opencode mis-marshals empty `test_files: []` as a JSON-string when calling `edit_test_only_change` / `edit_docs_only`

## TL;DR

When invoked from **opencode** (v1.14.x), the typed_edit tools that
require `test_files` to be EMPTY — `edit_test_only_change` and
`edit_docs_only` — fail at the meta-edit MCP server's Zod schema
validation:

```
Invalid arguments for edit_test_only_change: [
  {
    "code": "invalid_type",
    "expected": "array",
    "received": "string",
    "path": ["test_files"],
    "message": "Expected array, received string"
  }
]
```

The same call from **Claude Code** (verified in the same session this
was discovered: `met_20260505_*` tokens issued without warnings)
succeeds. Schema-side handling of `test_files: []` is therefore correct
on the meta-edit server; the bug is in opencode's MCP-client argument
marshaling, which appears to JSON-string-encode an empty array before
sending it across the stdio MCP transport.

## Why HIGH

- **Blocks the two highest-traffic tools on opencode**:
  `edit_test_only_change` (every test change) and `edit_docs_only`
  (every README / comment / SPEC edit). With these denied, opencode
  users effectively can't accept the typed surface for any non-source
  edit.
- **Silent on Claude Code**: this session has called the same tools
  with `test_files: []` repeatedly; all succeeded. Without
  cross-harness E2E the regression is invisible from a single-harness
  test plan.
- **Serialization bug is opencode-side**: meta-edit cannot fix it
  upstream; we can only mitigate by accepting both shapes at the
  server boundary.

## Reproduction (opencode)

```sh
cd /tmp/oc-meta-edit-fixture  # see RUNBOOK.md
opencode  # TUI

# Ask the agent:
# "Use edit_docs_only on README.md to add a sentence."
#
# Agent invokes the typed_edit tool with test_files: [].
# meta-edit MCP server returns the Zod error above.
```

Confirmed by user E2E on opencode v1.14.33 against meta-edit v0.4.0.
The 3 tools the agent tried that **passed** (`edit_refactor_only`,
`edit_boundary_condition`, `edit_boolean_condition`) all received
non-empty `test_files: ["..."]` payloads, which opencode does
serialize correctly. The empty-array path is the regression surface.

## Reproduction (Claude Code — DOES NOT REPRODUCE)

In the same Claude Code session that authored this issue, the
following typed_edit calls succeeded with `test_files: []`:

| Call | Token issued | Outcome |
|---|---|---|
| `edit_docs_only` on `issues/INDEX.md` | `met_20260505_08d99b98b4` | ✅ |
| `edit_test_only_change` on `src/opencode/plugin.test.ts` | `met_20260505_0e2602f2b8` | ✅ |
| `edit_docs_only` on this very file | `met_20260505_9f079c34c2` | ✅ |

Claude Code's MCP client therefore marshals `test_files: []` as an
actual JSON array; only opencode's mis-marshals it as a JSON string.

## Root cause hypothesis

opencode's MCP client likely runs a JSON-stringify step on each
parameter independently when constructing the JSON-RPC `params`
object, and an empty array round-trips through that step as the
literal string `"[]"` instead of being preserved as an array. A
cross-check against opencode's source would confirm; the binary is
shipped as a compiled native ELF in this repo's environment, so
direct inspection is awkward.

This is the same shape as
[`issues/2026-05-03-2030-mcp-string-array-arg-marshaling-bug.md`](./2026-05-03-2030-mcp-string-array-arg-marshaling-bug.md)
but in the opposite direction (that one was about a Claude Code
schema-cache transient affecting non-empty arrays; this one is an
opencode-runtime bug affecting empty arrays). Both manifest as
"Expected array, received string" at the Zod boundary, so a
defensive coercion at the schema layer would close both classes.

## Recommended mitigation (server-side, in this repo)

Add a `z.preprocess` to `EditToolRequestSchema.test_files` (and to
`additional_files` for symmetry) in `src/tools/common.ts` that
JSON-parses string inputs before the array-of-strings check:

```typescript
const ArrayOrJsonStringArray = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* fall through to the array check, which will fail with the
           original "expected array" error */
      }
    }
    return v;
  },
  z.array(z.string()),
);
```

Replace `test_files: z.array(z.string())` with this preprocessed
shape. Behavior:

- **Proper array input** (Claude Code): pass-through, no change in
  behavior.
- **JSON-string-encoded array input** (opencode bug): coerced back
  into an array, validation succeeds.
- **Anything else**: rejected with the same "expected array" error.

Trade: the workaround silently absorbs the upstream bug. To preserve
observability, log a stderr WARN whenever we coerce, with a pointer
back to this issue file. When opencode fixes their MCP client, we can
remove the preprocess; the WARN log lets us see how often it's
actually firing in the field before then.

## Out of scope

- Fixing opencode's MCP client. Upstream — file an issue at the
  opencode repo and link this file.
- Changing `additional_files` schema beyond the symmetric coercion.
  The bug is specific to arrays of primitive types per opencode's
  serializer; arrays of objects (like `additional_files`) seem to
  serialize correctly (PR #66 E2E saw `additional_files` work), but
  the cost of the symmetric preprocess is zero so it's worth doing.

## Notes for triage

- Verifying the workaround end-to-end requires actually running
  opencode (no unit-test substitute — the bug lives in opencode's
  marshaling layer, not in our server). Suggested verification:
  rerun the `/tmp/oc-meta-edit-fixture` E2E with an
  `edit_docs_only` call after landing the preprocess.
- The Claude Code path is unaffected; this fix is a
  defense-in-depth + opencode unblock, not a Claude Code bugfix.

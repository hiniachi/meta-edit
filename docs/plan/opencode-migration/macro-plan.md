# Macro plan — opencode migration

> Status: **draft / awaiting decisions**. This document scopes the work
> required to make `meta-edit` usable from
> [opencode](https://opencode.ai) in addition to Claude Code. Several
> decisions (§Open questions) need user sign-off before implementation
> starts. Per `CLAUDE.md` §3 this expands the MVP surface; the user has
> requested it explicitly.

## Objective

Run the same nineteen `edit_*` tools and the two safety policies
(`deny-raw-edit`, `deny-bash-write-bypass`) under opencode, with parity
to the Claude Code experience: the agent loses access to the raw
`edit` / `write` / `apply_patch` / `bash`-as-write primitives and is
funnelled through the kind-specific tools, with edits appended to
`.meta-edit/state/edits.jsonl`.

Out of scope for this migration:

- New `edit_*` categories.
- Any v0.2 classifier work (`SPEC.md` §11).
- A native (non-MCP) opencode tool surface — see §Open questions Q4.
- Windows support (matches current scope).

## Background: how the two harnesses differ

| Concern | Claude Code | opencode |
|---|---|---|
| Plugin packaging | `.claude-plugin/` marketplace OR npm bin | `.opencode/plugins/*.{ts,js}` OR npm package listed in `plugin: []` config array. No marketplace. |
| MCP registration | Marketplace `mcpServers` block OR user-edited `~/.claude.json` | `mcp` object inside `opencode.json` (global or project). `type: "local"`, `command: [...]`, `enabled`, `environment`. |
| Pre-tool hook | External executable, JSON over stdin/stdout, exit code controls allow/deny. Configured via `settings.json` `hooks.PreToolUse` matchers. | In-process JS/TS plugin function; `tool.execute.before(input, output)` hook, `throw` to abort. No external process. |
| Editing tool names | `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash` (capitalised) | `edit`, `write`, `apply_patch`, `bash` (lowercase). No notebook tool. |
| Tool permission model | Hook-only (deny via PreToolUse) | Hook **and** declarative `tools: { edit: false, write: false }` plus pattern-gated `permission: { bash: { "rm -rf *": "deny" } }`. |
| CLAUDE.md analog | `CLAUDE.md` | `AGENTS.md` / `instructions` config field |

The implication for `meta-edit`:

1. **MCP server** — reusable as-is. opencode connects to the same
   stdio MCP server we already ship; the nineteen tool descriptions and
   the edit log don't change.
2. **Hooks** — must be **rewritten** as an opencode plugin module
   (TypeScript exporting a `Plugin`). The pure policy modules
   (`raw-edit-policy.ts`, `bash-write-policy.ts`) are reusable; the
   stdin/stdout entry points (`deny-raw-edit.ts`,
   `deny-bash-write-bypass.ts`) and the hook-runtime are not.
3. **Installer CLI** — `meta-edit install-hooks` writes
   `.claude/settings.json`. We need a sibling that writes
   `opencode.json` (`mcp` block + `plugin` array entry), or document
   manual config.
4. **Plugin marketplace** — has no opencode equivalent; document
   npm-only install for opencode users.

## Architecture sketch (proposed)

```
src/
├─ tools/                          (unchanged — MCP server)
├─ state/                          (unchanged — edit log, protected paths)
├─ hooks/
│  ├─ raw-edit-policy.ts           (pure, harness-independent — unchanged)
│  ├─ bash-write-policy.ts         (pure, harness-independent — unchanged)
│  ├─ deny-raw-edit.ts             (Claude Code stdin/stdout entry — unchanged)
│  ├─ deny-bash-write-bypass.ts    (Claude Code stdin/stdout entry — unchanged)
│  └─ hook-runtime.ts              (Claude Code only — unchanged)
├─ opencode/                       (NEW)
│  ├─ plugin.ts                    (default export: opencode Plugin function)
│  ├─ tool-name-map.ts             (Edit→edit, Write→write, MultiEdit→edit*, etc.)
│  └─ install.ts                   (config-edit helpers for `meta-edit install-opencode`)
├─ cli/
│  ├─ hooks-cmd.ts                 (Claude Code installer — unchanged)
│  └─ opencode-cmd.ts              (NEW — install/uninstall opencode plugin + MCP)
└─ ...
```

`src/opencode/plugin.ts` is the only new runtime entry point. It looks
roughly like:

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { evaluateRawEdit } from "../hooks/raw-edit-policy.js";
import { evaluateBashCommand } from "../hooks/bash-write-policy.js";
import { OPENCODE_TO_CANONICAL } from "./tool-name-map.js";

export const MetaEditPlugin: Plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    const canonical = OPENCODE_TO_CANONICAL[input.tool];
    if (!canonical) return;

    if (canonical === "RawEdit") {
      const decision = evaluateRawEdit(canonical);
      if (decision.decision === "deny") throw new Error(decision.reason);
      return;
    }

    if (canonical === "Bash") {
      const decision = evaluateBashCommand(output.args.command ?? "");
      if (decision.decision === "deny") throw new Error(decision.reason);
    }
  },
});
```

The MCP server is unchanged — opencode users add it to their
`opencode.json`:

```json
{
  "mcp": {
    "meta-edit": {
      "type": "local",
      "command": ["meta-edit", "serve"],
      "enabled": true
    }
  },
  "plugin": ["@hiniachi/meta-edit/opencode"]
}
```

## Success criteria

1. A user with the npm package installed and the two config snippets
   above gets:
   - The nineteen `edit_*` MCP tools in the opencode tool list with
     full descriptions visible.
   - Raw `edit` / `write` / `apply_patch` calls aborted by the plugin
     with the same human-readable reason text the Claude Code hook
     emits.
   - `bash` calls matching `bash-write-policy` patterns aborted with
     the same reason text.
2. Edits produced via the MCP tools are appended to
   `.meta-edit/state/edits.jsonl` exactly as on Claude Code.
3. `meta-edit install-opencode --scope user|project` (if we build it —
   see Q5) idempotently writes the `mcp` and `plugin` entries.
4. No regression in Claude Code behaviour: the existing
   `.claude-plugin/`, `hooks/hooks.json`, and `meta-edit install-hooks`
   paths are byte-identical in output.
5. `bun test` green, `bun run typecheck` clean, `bun run build` clean.
   New tests cover: tool-name mapping, plugin hook deny paths, config
   installer.
6. README has an "Install (opencode)" section sibling to the existing
   "Option B: npm package" section.

## Work units

| id | title | depends_on | parallel_with | blast_radius |
|---|---|---|---|---|
| OC-1 | Tool-name map (Edit→edit, Bash→bash, …) + tests | — | OC-2, OC-3 | s |
| OC-2 | Extract harness-agnostic shape from `evaluateRawEdit` (already pure — confirm and document) | — | OC-1 | xs |
| OC-3 | Extract harness-agnostic shape from `evaluateBashCommand` (already pure — confirm and document) | — | OC-1 | xs |
| OC-4 | `src/opencode/plugin.ts` + unit tests (mock context object, assert throw on deny) | OC-1, OC-2, OC-3 | OC-5 | m |
| OC-5 | Add `@opencode-ai/plugin` as **peer/optional** dependency; build emits `dist/opencode/plugin.js` | OC-4 | OC-4 | s |
| OC-6 | `meta-edit install-opencode --scope user|project` CLI subcommand (writes `mcp` + `plugin` to `opencode.json`); idempotent; uninstall counterpart | OC-1 | OC-7 | m |
| OC-7 | README "Install (opencode)" section, README.ja.md / README.zh-CN.md mirror | — | OC-6 | s |
| OC-8 | `examples/.opencode/` reference config to mirror `examples/.github/workflows/` | OC-4, OC-6 | — | xs |
| OC-9 | `package.json` `exports` field: expose `./opencode` subpath; verify `import "@hiniachi/meta-edit/opencode"` resolves to `dist/opencode/plugin.js` | OC-5 | — | s |
| OC-10 | End-to-end smoke: spin up real opencode against a fixture repo, run a bash bypass, verify deny | OC-4..OC-9 | — | m |

## Risk register

- **R1**: opencode's plugin API may change between minor versions. Mitigation:
  pin `@opencode-ai/plugin` peer range, document tested versions in
  README. Re-run OC-10 on each opencode bump.
- **R2**: opencode's `tool.execute.before` runs in-process; a `throw` from
  our hook crashes the whole agent turn unless caught. Need to verify
  in OC-10 that `throw new Error(reason)` produces an agent-visible
  deny rather than a fatal error. If it does crash, fall back to
  setting `output.aborted = true` or whatever the documented escape
  hatch is. (Worth checking against opencode source before OC-4.)
- **R3**: The bash policy's reusability assumes
  `evaluateBashCommand(commandString)` is fully pure. A skim shows it
  is, but the function takes `EvaluateBashOptions` — confirm no
  reliance on `process.cwd()` or env vars that would differ between
  harnesses.
- **R4**: opencode has no `NotebookEdit` tool, but a future addition
  could re-open the notebook bypass. Tracked as a follow-up; not
  blocking.
- **R5**: opencode's `apply_patch` tool is **not** present in the Claude
  Code raw-edit list. We must add it to the deny list specifically for
  the opencode plugin (it's a write primitive there). The
  `RAW_EDIT_TOOLS` constant currently hard-codes Claude Code names; we
  either add `apply_patch` to it (cheap, harmless on Claude Code where
  the tool doesn't exist) or maintain two lists. Recommend: add
  `apply_patch` to the canonical raw-edit set.

## Sequencing & estimate

OC-1 → OC-2 / OC-3 (in parallel) → OC-4 → OC-5 / OC-6 (in parallel) →
OC-7 / OC-8 / OC-9 → OC-10.

Rough estimate: **2 days** of focused work, plus 0.5 day for OC-10
integration testing once an opencode harness is ready.

## Open questions (need user input)

These need answers before implementation starts.

### Q1. Scope: does this belong in v0.2 or as a sidecar?

`CLAUDE.md` §3 lists "VCS adapter abstraction" as out of scope. opencode
support is not strictly a VCS adapter, but it is a second-harness
adapter — same flavour of cross-cutting work. Two options:

- **(a)** Land it in the current package as a `src/opencode/` subtree,
  bundled with the existing Claude Code plugin. One npm package,
  optional `@opencode-ai/plugin` peer dep.
- **(b)** Defer to v0.2 and ship as a separate package
  `@hiniachi/meta-edit-opencode-plugin` that depends on the core.

Recommendation: **(a)**, because the plumbing reuses the pure policy
modules and a separate package would re-export them anyway. But it
expands the MVP scope per §3, so user confirmation needed.

### Q2. Deny mechanism: hook-throw, or declarative `tools: false`?

opencode supports two ways to neutralise raw `edit` / `write`:

- **Hook**: `tool.execute.before` throws — agent sees a clear deny
  reason ("use edit_* tools instead"). Mirrors Claude Code behaviour.
- **Declarative**: `tools: { edit: false, write: false, apply_patch: false }`
  in `opencode.json` — the tools simply don't exist for the agent.
  Cleaner but the agent gets no explanation.

Recommendation: **both**. Declarative as belt-and-braces (defence in
depth, no race), and hook for the explanation message in case opencode
ever adds a way to re-enable a tool in mid-session. But this doubles
the install footprint. Confirm preference.

### Q3. Bash deny: hook-only or declarative pattern list?

opencode's `permission.bash` accepts pattern-keyed `"deny"` rules
(e.g. `"rm -rf *": "deny"`). Our `bash-write-policy` is a complex
classifier (~1900 LOC) that analyses parsed shell syntax — far beyond
glob patterns. We must use the hook for the heavy lifting.

The declarative permission block could serve as a coarse first line
(deny `tee`, `dd`, etc. unconditionally) but would either over-block
(false positives the agent gets no explanation for) or under-block
(redundant with the hook).

Recommendation: **hook-only**, no declarative bash patterns. Confirm.

### Q4. Tool surface: MCP, or opencode-native plugin tools?

opencode's plugin API supports defining tools directly in TS:
`tool: { edit_refactor_only: tool({ ... }) }`. We could expose the
nineteen tools natively, skipping MCP entirely.

- **Pro**: better type integration, no separate stdio process, single
  source of truth in TS.
- **Con**: the tool-definition shape would diverge from what we ship
  to Claude Code via MCP — two parallel registries to maintain. Loses
  the property that the same binary works in both harnesses.

Recommendation: **MCP** for v1 of the migration. Revisit in v0.2 if
opencode users complain about the latency / process overhead.

### Q5. Installer CLI: `meta-edit install-opencode`?

Current Claude Code installer: `meta-edit install-hooks --scope
user|project` writes `.claude/settings.json`. opencode equivalent
would write `~/.config/opencode/opencode.json` or
`<project>/opencode.json`'s `mcp` and `plugin` keys.

Options:

- **(a)** Build `meta-edit install-opencode --scope user|project`
  symmetric to `install-hooks`.
- **(b)** Document manual config edits in README only.

Recommendation: **(a)**. `install-hooks` exists for exactly this UX
reason; opencode users deserve parity. ~half a day of work (OC-6).

### Q6. `apply_patch` deny: include in canonical `RAW_EDIT_TOOLS`?

`apply_patch` is opencode-specific. Adding it to `RAW_EDIT_TOOLS` is
harmless on Claude Code (the tool doesn't exist there, so the matcher
never fires) and keeps the deny list authoritative.

Recommendation: **yes**, add to `RAW_EDIT_TOOLS`. Bump the constant
location to make it harness-agnostic (no Claude Code naming
assumption). Confirm.

### Q7. NotebookEdit on opencode

opencode has no notebook tool today. We don't need to do anything,
but the canonical raw-edit list includes `NotebookEdit`. Leaving it in
is a no-op for opencode. Recommend leaving as-is.

### Q8. Distribution: single npm package, or two?

Tied to Q1. If (a): `@hiniachi/meta-edit` exposes `./opencode`
subpath. If (b): new package `@hiniachi/meta-edit-opencode-plugin`.

Recommend: **single package**, `./opencode` subpath via `exports`.

---

## Decision log (to be filled in)

- [ ] Q1: …
- [ ] Q2: …
- [ ] Q3: …
- [ ] Q4: …
- [ ] Q5: …
- [ ] Q6: …
- [ ] Q7: …
- [ ] Q8: …

Once Q1–Q8 are answered, this doc is converted from "draft" to
"accepted" and the work units in the table become the implementation
checklist.

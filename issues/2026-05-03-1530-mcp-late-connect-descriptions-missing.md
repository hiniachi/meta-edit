---
created_at: 2026-05-03T15:30:00+09:00
id: dogfood-2026-05-03-1530
category: ux/onboarding
severity: high
target_file: src/server.ts
related_files:
  - src/tools/registry.ts
  - src/server.test.ts
  - docs/SPEC.md
  - CLAUDE.md
discovered_in: 2026-05-03 onboarding dogfood — fresh-directory adoption flow
---

# [UX/Onboarding] Late-connect MCP path silently strips tool descriptions from agent context

## TL;DR

Onboarding sequence:

1. User starts a Claude Code session in a directory with **no `.git`** and **no project `CLAUDE.md`** (a realistic adoption flow — picking up `meta-edit` from a fresh checkout, scratch dir, or a sibling repo).
2. The MCP server `meta-edit serve` fails to launch because `assertIsRepo` (`src/server.ts:24-34`) throws synchronously inside `createServer` before transport handshake.
3. Claude Code marks the MCP server as **failed for the session** and continues without registering its tool catalog.
4. User runs `git init`, then `/mcp reconnect` (or equivalent).
5. The server **starts successfully**, but the nineteen `edit_*` tool **descriptions never enter the running agent's context**. The agent appears to "have" the typed surface (names may show in `/mcp`), but the load-bearing description prose — the entire product, per `SPEC.md` §4 / Article 4 / `CLAUDE.md` §4 — is not seen by the model on subsequent turns.

The core hypothesis ("descriptions guide AI behavior") is **silently broken** in this onboarding path. The agent falls back to general-purpose editing inference while the typed_edit calls still appear to succeed, so neither user nor agent gets a signal that the bet has been voided.

## Why this is HIGH severity

- It targets the **only** load-bearing mechanism in the project (descriptions are the product; everything else is plumbing per `CLAUDE.md` §4).
- The failure is **silent**. Calls to typed_edit still validate, still write to the edit log, and still return success — so the audit trail looks healthy while the cognitive intervention is absent.
- The triggering sequence is the **most natural onboarding flow** for a new adopter: clone, start Claude Code, hit a "not a repo" error, `git init`, retry. Anyone trying meta-edit on a fresh project will hit this.
- Recovery is non-obvious: a full Claude Code session restart is required; `/mcp reconnect` is **not** sufficient if Claude Code does not re-inject ListTools results into the running agent's context window mid-session.

## Reproduction

```bash
mkdir /tmp/mete-edit-onboard && cd /tmp/mete-edit-onboard
# Configure meta-edit MCP server pointing at this directory
claude  # start a session
# Observe: MCP server logs show:
#   meta-edit: "/tmp/mete-edit-onboard" does not appear to be a repository root ...
git init
# Trigger /mcp reconnect (or whatever the harness exposes)
# Server now boots cleanly, ListTools succeeds when probed.
# But:
#   - Ask the agent "what edit_* tools do you see and what do they say?"
#   - The agent enumerates names but cannot quote any description body.
#   - Or: instruct it to perform a small change; it ignores the kind-specific
#     obligations (test_files, "stop and ask", boundary-condition guidance, etc.)
#     because the prose was never inserted into its context.
```

(Exact reproduction depends on the Claude Code build's behavior around MCP
reconnection and ListTools re-injection. Empirically observed once on
2026-05-03; needs deterministic repro before any fix lands.)

## Root cause — two layers

**Layer 1 (meta-edit, fixable here):** `assertIsRepo` runs at `createServer` time and throws hard. The server cannot stay up to serve ListTools while the user repairs the environment. So the very first opportunity to surface descriptions is consumed by an environment error.

**Layer 2 (Claude Code / MCP harness, not fixable here):** Even after a successful late connect, whether the harness re-fetches ListTools mid-session and re-injects each tool's `description` text into the live agent context is **implementation-dependent**. The MCP spec includes `notifications/tools/list_changed`, but observable behavior in the reported session was that the descriptions did not arrive. Confirming the precise harness behavior is part of triaging this.

The two layers compound: Layer 1 ensures the first ListTools never even runs; Layer 2 ensures that fixing the directory after the fact may not retroactively heal the agent's view.

## Fix directions (out-of-scope items explicitly flagged)

1. **Make `assertIsRepo` lazy / advisory** *(in scope)*. Move the check from `createServer` into the per-tool path-validation gate. The server stays up and serves ListTools (so descriptions reach context); per-tool calls return a clear `not_a_repository` error until the user runs `git init`. This trades one synchronous hard fail for a soft fail at the right boundary, and crucially **lets the descriptions land before the user touches anything**.
2. **Document the workaround** *(in scope)*. Until (1) lands, `CLAUDE.md` and `README` should state plainly: *after `git init`, fully restart Claude Code; `/mcp reconnect` alone may not refresh tool descriptions in the running context.*
3. **Add a session-start sentinel test** *(in scope, downstream of (1))*. Add a `src/server.test.ts` case that asserts `createServer` against a non-repo directory **does not throw** (post-fix) and that ListTools still returns nineteen descriptions, so future regressions to eager-fail behavior fail CI.
4. **Empirically pin Claude Code's reconnect behavior** *(triage step, not a fix)*. Before/after (1), confirm via probe whether the harness re-injects descriptions on `/mcp reconnect`. The answer determines whether (1) alone is sufficient or whether documentation in (2) must remain.
5. **DO NOT add classification / detection / verification.** Per `CLAUDE.md` §3 and §7.3, tempting as it is to "detect when descriptions are absent and warn the agent", that is exactly the kind of diff-classifier work the MVP forbids. Layer-2 mitigation belongs to Claude Code, not to meta-edit's source tree.

## Notes for triage

- This is one of the few issues where the failure mode is **invisible from the audit log**: edit-log entries look identical to a healthy session.
- Closest existing relative: `2026-05-03-0105-description-size-token-cost.md` — both touch the "descriptions reach context" surface, but from opposite ends (this issue: descriptions absent; that issue: descriptions present but expensive).
- No reproducing test ships with this filing because the failure crosses the meta-edit ↔ Claude Code boundary; deterministic repro is itself part of the triage work above.

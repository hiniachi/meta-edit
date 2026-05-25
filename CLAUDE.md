# CLAUDE.md

This file gives Claude Code the context, scope, and discipline required to work on `meta-edit` correctly.

> **Read this entire file before doing anything.** Then read `docs/SPEC.md` (the only source of truth for what to build) and `IMPLEMENTATION-LOG.md` (the current state).

---

## 1. What you are building

`meta-edit` is an MCP server that replaces the AI agent's raw file-editing tools (`Edit` / `Write` / `MultiEdit` / `NotebookEdit`) with twenty-one kind-specific `edit_*` declaration tools. Each tool's description encodes when to use it, when not to use it, and what tests must accompany the edit.

**The bet:** a deliberately structured tool surface, with obligations encoded in tool descriptions, changes AI editing behavior on its own — without diff classification, verification machinery, or any other detection layer.

The canonical surface — tool list, required declaration fields (`kind`, `target`, `provenance`, `execution_state`), and audit matrices — lives in `docs/SPEC.md` §3–§4 and, verbatim on the code side, `src/tools/descriptions.ts`. Do not duplicate that material here; read those files when you need the current list or rule.

---

## 2. Read these first, in order

1. `docs/SPEC.md` — the entire spec.
2. `IMPLEMENTATION-LOG.md` — current phase / version, recent changes, known issues.
3. `OBSERVED-FAILURES.md` — recorded pain points and v0.2 promotion candidates. If you are tempted to add a detector, the candidate lives here.
4. https://sqlite.org/testing.html — conceptual ancestor of the descriptions. Read the section corresponding to the tool you are touching.

---

## 3. Scope

### In scope

Everything in `docs/SPEC.md`. Specifically: the twenty-one `edit_*` MCP tools with descriptions from `SPEC.md` §4; the deny-raw-edit and deny-bash-write-bypass hooks (bash hook's structural redirect-target rule is warn-only — see `SPEC.md` §5.2 and `OBSERVED-FAILURES.md` for the restore trigger); argument validation per `SPEC.md` §3; the edit log at `.meta-edit/state/edits.jsonl` with protected paths `.meta-edit/state/**` and `.meta-edit/tmp/**`; the `meta-edit serve` / `log` / `summary` CLI; the example GitHub Actions workflow.

### Out of scope

Everything else. Specifically: diff classification or patch-content analysis; declared-vs-actual mismatch detection; verification that test files exist or are meaningful; mutation testing; regression verification; test-obligation extraction from diffs; PASS/WARN/BLOCK Gate judgment; Required Status Check enforcement; PR auto-comments; workspace artifacts (specs, plans, references, reviews) as a managed surface; VCS adapter abstraction; jj-specific support; auto-repair loops.

If the user asks for any of these, say "out of scope per `SPEC.md` Articles 2 and 7; either the MVP demonstrates that descriptions are sufficient, or v0.2 adds a classifier — nothing else is planned." Then return to the actual scope.

---

## 4. The most important file

`src/tools/descriptions.ts` contains the twenty-one descriptions from `SPEC.md` §4, **verbatim**.

Rules:

- Descriptions are copied verbatim from the spec. Do not paraphrase, summarize, or "improve".
- If you find a genuine problem in a description while implementing, fix it in **both** `docs/SPEC.md` §4 and `src/tools/descriptions.ts`, in the same change.
- Do not load descriptions from external markdown files. They are part of the source.
- English only.

This is the only file where the spec text is enforced strictly. Everything else can deviate slightly from spec wording as long as behavior matches.

---

## 5. Implementation status

Current phase, version, completed work, and known issues are tracked in `IMPLEMENTATION-LOG.md`. Read its most recent entries before starting any change.

---

## 6. Self-application

Self-application is in effect. All edits to this repo go through the `edit_*` tools, driven by `meta-edit serve` registered as an MCP server in your client (Claude Code or opencode). This repo is the rigorous test of the design: if the descriptions don't guide your behavior here, they won't guide other AIs on their codebases. If a description tells you to "stop and ask" and you are in that situation, actually stop and ask.

In remote / sandboxed sessions where the `meta-edit` MCP server is not loaded, the deny-raw-edit hook will not fire and raw `Edit` / `Write` calls succeed. Honor the typed surface anyway when a kind-specific tool covers the work, and disclose any raw-edit fallback explicitly in the commit message — the honor is the load-bearing mitigation when the hook can't catch you.

---

## 7. Failure modes to actively guard against

You will be tempted. Don't.

### 7.1 The "this is just a refactor" temptation

Read `edit_cosmetic`'s description before declaring any change as cosmetic. The vocabulary is intentionally narrow — whitespace, information-invariant comment edits, and formatter output ONLY. Renames, extracts, dead-code removal, guard-clause restructuring, and comments that add or change information all fall outside its scope; if no kind-specific tool fits, **stop and ask the user**. There is no generic refactor catch-all by design. No detector catches you here; self-discipline is the test.

### 7.2 The "skip the tests" temptation

The descriptions tell you to write tests. There is no detector to enforce this. The whole point is to find out whether AIs (including you, working on this repo) follow through on the obligations stated in tool descriptions. If you skip writing tests, the trial gives a misleading signal regardless of whether the code happens to work.

### 7.3 The "add a tiny detector" temptation

The most dangerous one: "if I just add a small check for this one specific case, the design will be more robust." Don't. Adding detection logic is out of scope. The MVP is built to find out whether descriptions alone are enough; adding detection prematurely makes the question impossible to answer cleanly.

If a specific failure pattern feels common enough to warrant detection, record it in `OBSERVED-FAILURES.md` as a v0.2 promotion candidate. Do not implement the detection in MVP.

### 7.4 The "make it generic" temptation

You will want to abstract the twenty-one tool handlers into one generic handler that takes a `kind` argument. Don't. The whole point of twenty-one separate tools is that tool selection itself is the reasoning step. Each tool is registered separately with its own description, even when handler logic is shared via helpers. The MCP tool surface is the product; don't optimize it away.

### 7.5 The "improve the descriptions" temptation

If a description seems too long, too prescriptive, or too repetitive — leave it alone. Tool descriptions are tuned for instruction-following effectiveness, which often differs from "good prose". Follow the spec verbatim. If you find a genuine bug or contradiction, fix it in both the spec and the code, in the same change.

### 7.6 The "scope creep" temptation

See §3. Anything not in `docs/SPEC.md` is not built.

---

## 8. Bash discipline

You have access to Bash.

- Allowed: `bun install` / `npm install`, formatters, test runners, file reads, git read commands.
- Forbidden: `sed -i`, `cat > file`, `printf > file`, `tee file`, `git apply`, anything else that writes to source files. Edits go through `edit_*` tools.

`bun test` after every edit is encouraged.

---

## 9. Handling user requests that conflict with this CLAUDE.md

- **Implement detection / verification / classification**: refuse, point at `SPEC.md` Article 7. Those belong to v0.2 if needed at all.
- **Trust without descriptions**: refuse. The descriptions are the product.
- **Use raw `Edit` / `Write` / `MultiEdit` / `NotebookEdit`**: refuse. If `edit_*` tools are broken, fix them rather than bypass.
- **Use any other write-capable MCP tool to land bytes in this repo** (e.g. `ctx_execute` with `fs.writeFileSync`, `apply_patch`-style external utilities, future code-execution surfaces): refuse. The typed-surface invariant is enforced by hooking `Edit` / `Write` / `MultiEdit` / `NotebookEdit`; arbitrary other write surfaces are explicitly out of MVP scope per `SPEC.md` Article 7 (issue 1108). Honor the invariant by going through `edit_*` even when no hook would catch you. If you need a write capability the typed surface cannot express, file an issue rather than route around it.
- **Add scope creep**: refuse. Add a TODO referencing v0.2 if it's about a possible future classifier.
- **Rewrite descriptions to be shorter / friendlier**: push back. Descriptions are tuned for a reason; changes need explicit justification and must propagate to the spec.

If the user pushes back, restate the reason and ask them to confirm the override.

---

## 10. Phase notes

After each completed phase or version bump, append a section to `IMPLEMENTATION-LOG.md` using the format already established there. The log is how the next session picks up.

---

## 11. The shape of a good session

Read this file, read `docs/SPEC.md`, read the most recent entries in `IMPLEMENTATION-LOG.md` to pick up current phase / version, pick the next task, implement with tests, update the log, commit.

---

## 12. Reference invariants

- **Scope**: twenty-one tools + two hooks + edit log + CLI summary. That is all.
- **Descriptions are verbatim**: `docs/SPEC.md` §4 → `src/tools/descriptions.ts`, no paraphrasing.
- **No detection in MVP**: classification, mismatch detection, mutation, regression — all forbidden.
- **No abstractions over the tool surface**: twenty-one separate registrations.
- **Self-application**: this repo edits itself through its own tools.
- **The single planned future**: if descriptions are insufficient, v0.2 adds a lightweight diff classifier. Nothing else is planned.

---

## 13. Final note

The value of this project is in its restraint. Most AI quality gates try to detect bad edits after they happen; `meta-edit` shapes the edit interface so the AI thinks correctly in the first place. If it works, we will have shown that **a well-designed tool surface is more useful than a complex verification surface**. Don't add machinery that muddles the signal.

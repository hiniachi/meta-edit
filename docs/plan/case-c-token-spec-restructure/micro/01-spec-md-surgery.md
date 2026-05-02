# SPEC.md Constitutional Surgery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `docs/SPEC.md` per the disposition map in `../macro-plan.md`: insert Part I (8 articles) at the top, slim Part II sections, delete sections absorbed into the constitution, and update external cross-references — all in a single PR landing on `main`.

**Architecture:** Sequential surgical edits to one file (`docs/SPEC.md`) plus minor cross-reference updates in `CLAUDE.md`, `README.md`, `README.ja.md`. Each task either inserts, replaces, or deletes a known line range. Source-of-truth for Part I content is `docs/plan/case-c-token-spec-restructure/macro-plan.md` lines 24–279.

**Tech Stack:** Plain markdown. No code changes in this plan (those follow in subsequent micro-plans once the constitution is in place per macro-plan Part IV).

---

## File Structure

**Modified:**
- `docs/SPEC.md` (1280 → ~1090 lines after surgery)
- `CLAUDE.md` (4 references to `§11` updated to point at Articles 2/7)
- `README.md` (1 reference to `§11` updated)
- `README.ja.md` (1 reference to `§11` updated)
- `IMPLEMENTATION-LOG.md` (append entry recording the restructure)

**Created:** None.

**Source-of-truth references:**
- Part I content (Articles 1–8): `docs/plan/case-c-token-spec-restructure/macro-plan.md` lines 24–279
- Disposition map: `macro-plan.md` lines 281–312
- Slim section drafts: inlined in this plan (Tasks 3, 4, 5, 6, 8)

**Stable-numbered Part II sections (not renumbered):**
After absorption of §1, §8, §11, §12, the remaining Part II sections retain their current numbers (gaps where absorbed sections were). This minimizes external-reference churn. Final numbering: §2, §3, §4, §5, §6, §7, §9, §10.

---

## Task 1: Pre-surgery baseline capture

**Files:**
- Read: `docs/SPEC.md`

- [ ] **Step 1: Capture baseline metrics for self-verification**

Run:
```bash
wc -l docs/SPEC.md
grep -nE '^## [0-9]+\. ' docs/SPEC.md
sha256sum docs/SPEC.md
```

Expected output: 1280 lines, 12 top-level sections, a sha256 to record. Save these in a scratch buffer for Task 11's verification.

- [ ] **Step 2: Confirm working branch**

Run:
```bash
git branch --show-current
```

Expected: `chore/case-c-token-spec-restructure`. If not on this branch, switch to it: `git switch chore/case-c-token-spec-restructure`.

---

## Task 2: Insert Part I (constitution) at the top of SPEC.md

**Files:**
- Modify: `docs/SPEC.md` (insert after line 6, before current line 7's `---`)

- [ ] **Step 1: Read macro-plan Part I content**

Run:
```bash
sed -n '24,279p' docs/plan/case-c-token-spec-restructure/macro-plan.md
```

This is the verbatim content to be inserted. The block starts with `## Part I — Constitutional draft (8 articles)` and ends just before `## Part II — Restructure mapping`.

- [ ] **Step 2: Build the insertion block and insert AFTER existing line-7 separator**

Construct the insertion block:

1. `## Part I — Constitution` (new heading; NOT the macro-plan's `Constitutional draft (8 articles)` wording — the macro-plan's outer heading and its meta-planning intro paragraph are dropped).
2. Articles 1–8 verbatim, starting from `### Article 1 — Mission` and ending at the last line before `## Part II — Restructure mapping` in the macro-plan. Use `sed -n '26,279p' docs/plan/case-c-token-spec-restructure/macro-plan.md` to extract.
3. A `---` separator after Article 8.
4. `## Part II — Derived Specification` heading.

Locate the existing `---` separator on line 7 of SPEC.md (it sits between the intro paragraph and `## 1. The bet`). Insert the constructed block IMMEDIATELY AFTER that `---`. The existing `## 1. The bet` line remains unchanged at this commit (Task 8 will delete it).

Final structure after this step:

```markdown
# meta-edit Specification

[existing intro paragraph kept verbatim]

This document is the complete specification of `meta-edit`.

---

## Part I — Constitution

### Article 1 — Mission
[verbatim from macro-plan]

### Article 2 — The bet
[verbatim from macro-plan]

[...Articles 3–8...]

---

## Part II — Derived Specification

## 1. The bet
[existing content, will be deleted in Task 8]
```

- [ ] **Step 3: Verify Part I is correctly placed**

Run:
```bash
grep -n "^## Part I — Constitution\|^## Part II — Derived Specification\|^### Article" docs/SPEC.md
```

Expected: 1 line for Part I, 8 lines for Articles 1–8, 1 line for Part II.

- [ ] **Step 4: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs(spec): add Part I — Constitution (Articles 1-8) at the head

Inserts the 8-article constitution from macro-plan.md verbatim before
the existing numbered sections (now grouped under Part II).
Existing §1-§12 content is preserved at this commit; subsequent commits
slim/absorb/delete per the disposition map."
```

---

## Task 3: Slim §2 Architecture (Part II)

**Files:**
- Modify: `docs/SPEC.md` — replace current `## 2. Architecture` block (currently 39 lines) with the slim version

- [ ] **Step 1: Replace §2 content**

Replace the entire `## 2. Architecture` block (from `## 2. Architecture` to the next `---` separator) with:

```markdown
## 2. Architecture

```
Claude Code (host)
  │
  │  Edit / Write / MultiEdit / NotebookEdit
  ▼
PreToolUse hook: deny-raw-edit (token-aware, see §5)
  ├─ valid token + sha256 checks pass → allow + consume
  └─ otherwise → deny
  ▼
File system (write performed by native Edit/Write)

Independently:
PreToolUse hook: deny-bash-write-bypass — blocks shell-route writes (§5.2)

MCP server: meta-edit-mcp
  ├─ 17 SQLite-discipline-derived tools (single-file declarations)
  ├─ 2 workflow tools (batch declarations of N files)
  └─ Issues tokens; never writes files

State
  ├─ .meta-edit/state/grants/         in-flight tokens
  └─ .meta-edit/state/edits.jsonl     append-only audit log

CLI
  ├─ meta-edit serve / log / summary
```

That is the entire system.
```

- [ ] **Step 2: Verify section line count**

Run:
```bash
awk '/^## 2\. Architecture/{f=1; n=NR} f && /^---$/ && NR>n {print NR-n; exit}' docs/SPEC.md
```

Expected: between 25 and 35 (slim target ~25 lines plus the trailing separator).

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs(spec): slim §2 Architecture to token-aware diagram

Replaces 39-line description with ~25-line diagram showing the
declaration → token → native-edit + hook flow. Old apply.ts-based
architecture removed."
```

---

## Task 4: Rewrite §3 Common schema (Part II)

**Files:**
- Modify: `docs/SPEC.md` — replace current `## 3. The nineteen tools: common schema` block (124 lines)

- [ ] **Step 1: Replace §3 content**

Replace the entire `## 3.` block (from `## 3. The nineteen tools: common schema` to the next `---` separator at line ~189) with:

```markdown
## 3. The nineteen tools: common schema

A typed_edit MCP call is a **declaration of intent**. The server validates the request, issues a single-use token bound to one or more sha256 tuples, and returns. **It does not write.** Native `Edit` / `Write` / `MultiEdit` performs the write under hook validation (see §5).

```typescript
type EditToolRequest = {
  target_file: string;            // primary bound file. Always present.
  rationale: string;              // 1-3 sentences, non-empty after trim
  risk_level: "low" | "medium" | "high" | "critical";
  test_files: string[];           // forward declaration; not bound by token

  before_sha256: string;          // hex(64). For edit_create_file's
                                  // target_file, sha256("").
  after_sha256: string;           // hex(64).

  // ONLY accepted by the 2 workflow tools (edit_docs_only,
  // edit_create_file). The 17 SQLite-derived tools MUST omit this
  // field; validation rejects its presence elsewhere.
  additional_files?: Array<{
    file: string;
    before_sha256: string;        // sha256("") for create entries
    after_sha256: string;
  }>;
};

type EditToolResult = {
  token: string;                  // e.g. "met_20260502_a3f9b2..."
  expires_at: string;             // ISO-8601, declaration_time + 30s
  edit_id: string;                // e.g. "edit_20260502_0001"
  warnings: string[];
  audit_error?: string;           // present whenever an audit-log write
                                  // fails. The caller MUST check the
                                  // edit_log directly for ground truth.
};
```

### Argument validation

The MCP server enforces:

- `target_file` is inside the repo (after `realpath`) and not in protected paths (`.meta-edit/state/**`, `.meta-edit/tmp/**`).
- `rationale` is non-empty after trim.
- `test_files` cardinality follows the per-tool rule encoded in §4: non-empty for SQLite-derived production tools that impose test obligations; empty for `edit_refactor_only` / `edit_test_only_change` / `edit_docs_only`.
- `before_sha256` and `after_sha256` are exactly 64 hex chars.
- `before_sha256` matches the current disk content of `target_file` at declaration time (sha256(disk_content), or sha256("") when `edit_create_file` and the file does not yet exist).
- `additional_files` is accepted only for the 2 workflow tools, with cardinality ≤ 32 (operational hygiene; not a constitutional value).
- Each `file` in `additional_files` is validated under the same path-safety rules as `target_file`.

Validation failures result in a rejected request with a non-empty `warnings` array and no token issued.

### Token issuance

A successful declaration produces a token bound to the set of
`(file, before_sha256, after_sha256)` tuples (1 entry for SQLite-derived; 1+N for workflow tools). The token expires 30 seconds after issuance. Storage is `.meta-edit/state/grants/<token_id>.json`, a protected path.

The MCP server does not analyze the new content. It does not check whether the chosen tool is appropriate for the change. It does not verify the test files exist or contain meaningful tests. None of that. The whole point per Article 4 is that tool descriptions, not server logic, do the work.

### Multi-kind precedence

If a single change might fit multiple tools, prefer the more specific:

- `edit_permission_logic` over `edit_boolean_condition` / `edit_boundary_condition`
- `edit_retry_timeout` over generic `edit_boundary_condition`
- `edit_external_side_effect` over generic `edit_error_handling` for failure-side-effect interactions
- `edit_data_migration` over generic `edit_db_schema` when existing data is being modified
- `edit_policy_change` over any ordinary code tool when the change touches `meta-edit` configuration, hooks, or tool descriptions

A change that spans multiple kinds and cannot be safely split should choose the highest-risk applicable tool and mention secondary aspects in `rationale`.
```

- [ ] **Step 2: Verify section line count and key fields**

Run:
```bash
awk '/^## 3\. The nineteen tools/{f=1; n=NR} f && /^---$/ && NR>n {print NR-n; exit}' docs/SPEC.md
grep -E "before_sha256|after_sha256|additional_files|token" docs/SPEC.md | head -20
```

Expected: section length ~50 lines (slim target ~40, allowed up to 60). The grep should show the new schema fields are present.

- [ ] **Step 3: Verify obsolete content is gone**

Run:
```bash
grep -nE "old_content|new_content|sibling temp|MAX_CHANGE_BYTES|NUL byte|apply phase" docs/SPEC.md
```

Expected: no matches in §3 or §10. (May still appear elsewhere temporarily until later tasks; that is OK.)

- [ ] **Step 4: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs(spec): rewrite §3 schema to declaration + token (Case C)

Replaces content-pair schema (old_content/new_content) with sha256
binding (before_sha256/after_sha256) and adds workflow-tool
additional_files batch field. Drops apply phase 1/2/3 mechanics, NUL
byte rejection, MAX_CHANGE_BYTES bound, and multi-file scope rule.
The server no longer writes; native Edit/Write does, gated by §5."
```

---

## Task 5: Update §5 Hooks (token-aware deny-raw-edit)

**Files:**
- Modify: `docs/SPEC.md` — current `## 5. Hooks` block (109 lines)

- [ ] **Step 1: Replace §5 content**

Replace the entire `## 5.` block (from `## 5. Hooks` to the next `---` separator) with:

```markdown
## 5. Hooks

Two PreToolUse hooks, both shipped under `hooks/` in this repo.

### 5.1. deny-raw-edit (token-aware)

Fires on Claude Code's built-in `Edit`, `Write`, `MultiEdit`, and `NotebookEdit` tools. Validates that each call carries a `_meta_edit_token` parameter referencing a fresh declaration in `.meta-edit/state/grants/`.

```
on_pre_tool_use(toolName, toolInput):
  token_id = toolInput["_meta_edit_token"]
  if not token_id:
    return deny("untyped raw edit")

  token = grants.lookup(token_id)
  if token is None or token.expired():
    return deny("token expired or unknown")

  file_path = realpath(toolInput["file_path"])
  bound = token.find_binding(file_path)
  if bound is None:
    return deny("file_path not bound by this token")

  # Pre-condition: declared starting state matches disk
  disk_content = read(file_path) if exists(file_path) else b""
  if sha256(disk_content) != bound.before_sha256:
    return deny("disk has drifted from declaration (staleness)")

  # Post-condition: simulated write produces declared content.
  # Catches honest mistakes where toolInput would produce content
  # differing from the declared after_sha256.
  proposed = simulate(toolName, toolInput, disk_content)
  if sha256(proposed) != bound.after_sha256:
    return deny("simulated write does not match declared after_sha256")

  grants.consume(token_id, file_path)
  return allow()

simulate(toolName, toolInput, current):
  case "Edit":         return current.replace(toolInput.old_string,
                                              toolInput.new_string, count=1)
  case "Write":        return toolInput.content
  case "MultiEdit":    apply each edit in sequence; return final
  case "NotebookEdit": return UNSUPPORTED   # see §11 / Article 7
```

The pre-condition check is **staleness detection**, not a TOCTOU defense: it catches declarations made against a prior disk state but does not eliminate the residual race between hook approval and the native write. The residual race is accepted under the threat model in Article 3.

Read-only tools (Read, Grep, Glob, Bash without writes, ...) do not consume tokens; the agent may freely interleave them between declaration and consumption, bounded only by the token's TTL.

After the native write completes, a PostToolUse path appends a `consumed` record to `.meta-edit/state/edits.jsonl` (see §6).

Other-MCP write paths (e.g. `ctx_execute` writing to disk without going through this hook — see issue 1108) are an acknowledged hook-scope gap. Closing that gap is a future hook expansion (PostToolUse monitoring, MCP-write allowlist), not part of this hook.

### 5.2. deny-bash-write-bypass

Fires on Claude Code's `Bash` tool. Denies write patterns that would route bytes into the repository without going through native Edit/Write:

- **Verb denylist**: `cat >`, `sed -i`, `tee`, `dd of=`, `mv`, `cp`, `patch`, `rsync`, `git apply`, ...
- **Heredoc-with-redirect**: `cat <<EOF > target`
- **Inline interpreter writes**: `python -c '...write'`, `node -e '...write'`, `perl -e ...`, `ruby -e ...`, `php -r ...`
- **Decode-and-execute pipelines**: `base64 -d | bash`, `eval "$(...)"`
- **Protected-path writes**: `printf > .meta-edit/state/...` (always denied regardless of redirect target)

The structural redirect-target check (a redirect to a path outside the safe-sink allowlist) is **warned, not denied** since v0.1.5. The call proceeds with a `permissionDecisionReason` nudging the agent toward an `edit_*` tool. The verb-denylist and protected-path checks remain `deny`.

Substring-matching is the bypass-resistance limit. Determined commands (alternative interpreters, encoded payloads, exotic constructs) can evade. Per Article 3's non-adversarial assumption, the goal is to make the typed surface easier than honest workaround paths, not to provide a sandbox.
```

- [ ] **Step 2: Verify section length and content**

Run:
```bash
awk '/^## 5\. Hooks/{f=1; n=NR} f && /^---$/ && NR>n {print NR-n; exit}' docs/SPEC.md
grep -nE "_meta_edit_token|simulate\(toolName|staleness detection|issue 1108" docs/SPEC.md
```

Expected: section length 70-90 lines. Grep finds the four key concepts.

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs(spec): retarget §5 hooks to token-aware deny-raw-edit

deny-raw-edit becomes the binding-validation gate per Article 5:
checks _meta_edit_token, before_sha256 staleness, and simulated post
sha256 against declared after_sha256. Read-only tools don't consume.
deny-bash-write-bypass content trimmed but unchanged in policy."
```

---

## Task 6: Slim §6 Edit log

**Files:**
- Modify: `docs/SPEC.md` — current `## 6. Edit log` block (45 lines)

- [ ] **Step 1: Replace §6 content**

Replace the entire `## 6.` block with:

```markdown
## 6. Edit log

`.meta-edit/state/edits.jsonl` — JSON Lines, append-only, protected.

Each declaration produces two records:

1. **Issued** — written when the typed_edit handler returns success.

```json
{"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:00+09:00",
 "phase":"issued",
 "kind":"edit_boundary_condition",
 "target_file":"src/foo.ts",
 "rationale":"...",
 "risk_level":"medium",
 "test_files":["tests/foo.test.ts"],
 "binding":[{"file":"src/foo.ts","before_sha256":"...","after_sha256":"..."}],
 "token":"met_20260502_a3f9b2..."}
```

2. **Consumed** — written when the token is consumed by the deny-raw-edit hook (see §5).

```json
{"edit_id":"edit_20260502_0001","ts":"2026-05-02T19:00:11+09:00",
 "phase":"consumed",
 "consuming_tool":"Edit"}
```

Records reaching only `issued` without a `consumed` sibling are evidence of a half-finished declaration (token expired, agent abandoned the edit). Audit consumers reconcile by `edit_id`.

Failed declarations (validation rejection at the MCP server) record one entry with `phase: "rejected"` and a non-empty `audit_error` field.

Rotation and retention are not specified; in MVP the file grows unbounded. Operators that anticipate long-running deployments should add their own rotation outside `meta-edit`.
```

- [ ] **Step 2: Verify**

Run:
```bash
awk '/^## 6\. Edit log/{f=1; n=NR} f && /^---$/ && NR>n {print NR-n; exit}' docs/SPEC.md
grep -nE "phase.\:.\"issued\"|phase.\:.\"consumed\"|phase.\:.\"rejected\"" docs/SPEC.md
```

Expected: ~30 lines. Grep finds 3 phase markers.

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs(spec): slim §6 to 2-state edit-log records (issued/consumed)

Each declaration produces an 'issued' record at MCP-server return and a
'consumed' record when the token is consumed by the deny-raw-edit hook.
Audit consumers reconcile by edit_id. Half-finished declarations
(issued without consumed) are evidence of expired/abandoned tokens."
```

---

## Task 7: Slim §10 Implementation notes

**Files:**
- Modify: `docs/SPEC.md` — current `## 10. Implementation notes` block (57 lines)

- [ ] **Step 1: Replace §10 content**

Replace the entire `## 10.` block with:

```markdown
## 10. Implementation notes

### Recommended stack

- TypeScript for the MCP server, hooks, and CLI
- `zod` for argument schemas
- JSONL for the edit log; no database
- Bun + Node 20 in CI

### Repository layout

```
meta-edit/
  src/
    tools/
      common.ts             shared types, validation, token issuance
      descriptions.ts       the nineteen descriptions, verbatim from §4
      registry.ts           MCP tool registration
    server.ts               MCP stdio server entry
    cli.ts                  CLI entry
    state/
      edit-log.ts           jsonl read/write
      grants.ts             token issuance / lookup / consumption
      protected-paths.ts    path matching
    hooks/
      deny-raw-edit.ts
      deny-bash-write-bypass.ts
  examples/
    .github/workflows/meta-edit-summary.yml
  package.json
  README.md  CLAUDE.md  SPEC.md
```

### Descriptions-verbatim rule

`src/tools/descriptions.ts` contains the nineteen descriptions from §4 of this document, verbatim. Spec and code MUST stay in sync; any change to either updates both in the same change.

Tool handlers share common logic via helpers, but each tool is registered separately under the MCP server with its own description. Per Article 4, tool selection is the cognitive intervention; the surface is not collapsed into a generic `kind`-parameterized handler.
```

- [ ] **Step 2: Verify**

Run:
```bash
awk '/^## 10\. Implementation notes/{f=1; n=NR} f && /^---$/ && NR>n {print NR-n; exit}' docs/SPEC.md
```

Expected: ~30-40 lines.

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs(spec): slim §10 implementation notes; add grants.ts to layout

Drops apply.ts mechanics walkthrough (sibling-temp, parent-fsync,
TOCTOU loops). Adds src/state/grants.ts for token issuance per Article
5's binding mechanism. Descriptions-verbatim rule retained as the
load-bearing invariant for §4."
```

---

## Task 8: Delete sections absorbed into Part I (§1, §8, §11, §12)

**Files:**
- Modify: `docs/SPEC.md` — delete four entire blocks

- [ ] **Step 1: Delete §1 The bet**

Find the block starting `## 1. The bet` and ending at the next `---` separator. Delete everything from `## 1. The bet` through and including that trailing `---`. The content is now in Article 2.

- [ ] **Step 2: Delete §8 Threat model and mitigations**

Find the block starting `## 8. Threat model and mitigations` and ending at the next `---` separator. Delete the entire block including the trailing `---`. The content is now in Article 3.

- [ ] **Step 3: Delete §11 Future direction**

Find the block starting `## 11. Future direction` and ending at the next `---` separator. Delete the entire block including the trailing `---`. The content is now distributed across Articles 2 and 7.

- [ ] **Step 4: Delete §12 References**

Find the block starting `## 12. References` to end of file. Delete it. The content is now in Article 8.

- [ ] **Step 5: Verify**

Run:
```bash
grep -nE "^## (1\. The bet|8\. Threat model|11\. Future direction|12\. References)" docs/SPEC.md
grep -nE "^## [0-9]+\. " docs/SPEC.md
```

First grep: 0 matches (all four sections gone).
Second grep: should show §2, §3, §4, §5, §6, §7, §9, §10 only (8 numbered sections in Part II).

- [ ] **Step 6: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs(spec): delete §1 §8 §11 §12 (absorbed into Part I articles)

§1 The bet → Article 2.
§8 Threat model → Article 3 (with explicit lazy/fallible/non-adversarial
   actor model added during constitutional drafting).
§11 Future direction → Articles 2 (classifier) and 7 (anti-scope-creep).
§12 References → Article 8.

Part II now contains §2, §3, §4, §5, §6, §7, §9, §10 (gap-numbered to
preserve external references that already exist)."
```

---

## Task 9: Update external references to deleted §11

**Files:**
- Modify: `CLAUDE.md` (4 occurrences)
- Modify: `README.md` (1 occurrence)
- Modify: `README.ja.md` (1 occurrence)

- [ ] **Step 1: Update CLAUDE.md §11 references**

Find every `SPEC.md §11` in `CLAUDE.md`. Each refers to the planned v0.2 diff classifier as the only future-direction. Replace with `SPEC.md Article 2 / Article 7` (the constitution now hosts that direction).

Specific occurrences (line numbers may have shifted):
- Around line 76: `out of scope per SPEC.md §11; either the MVP demonstrates...` → `out of scope per SPEC.md Articles 2 and 7; either the MVP demonstrates...`
- Around line 222: `Implement detection / verification / classification: refuse, point at SPEC.md §11.` → `Implement detection / verification / classification: refuse, point at SPEC.md Article 7.`

Run after editing:
```bash
grep -n "§11" CLAUDE.md
```

Expected: 0 matches.

- [ ] **Step 2: Update README.md §11 reference**

Around line 187: `The optional v0.2 lightweight diff classifier (see [SPEC.md §11]...)` → `The optional v0.2 lightweight diff classifier (see [SPEC.md Article 2](./docs/SPEC.md))` and adjust the link target to `docs/SPEC.md` without an anchor (since Article 2 is in Part I).

Run:
```bash
grep -n "§11" README.md
```

Expected: 0 matches.

- [ ] **Step 3: Update README.ja.md §11 reference**

Around line 155: same pattern as English README. `[SPEC.md §11]` → `[SPEC.md Article 2]`.

Run:
```bash
grep -n "§11" README.ja.md
```

Expected: 0 matches.

- [ ] **Step 4: Verify no remaining §11/§12 references repository-wide**

Run:
```bash
grep -rn "§11\|§12\|§ 11\|§ 12" --include="*.md" .
```

Expected: 0 matches (or only inside docs/plan/ planning artifacts, which are historical and may keep them).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md README.ja.md
git commit -m "docs: update §11 references to point at Article 2 / Article 7

§11 (Future direction) was absorbed into the constitution. CLAUDE.md
references to 'out of scope per §11' now correctly point at Article 7
(constitutional out-of-scope); README references to the planned
classifier point at Article 2 (where the experiment's escape hatch
is now hosted)."
```

---

## Task 10: Append IMPLEMENTATION-LOG.md entry

**Files:**
- Modify: `IMPLEMENTATION-LOG.md` (append an entry)

- [ ] **Step 1: Read current IMPLEMENTATION-LOG.md format**

Run:
```bash
tail -40 IMPLEMENTATION-LOG.md
```

Note the entry format used by recent phases.

- [ ] **Step 2: Append new entry**

Append at the end of the file (matching existing format):

```markdown
## Phase 8: Constitutional restructure (SPEC Part I + Part II slim)

- Completed: 2026-05-02
- What works:
  - SPEC.md Part I (Articles 1–8) added at the head as the constitution.
  - Part II §2, §3, §5, §6, §10 slimmed per the disposition map in
    `docs/plan/case-c-token-spec-restructure/macro-plan.md`.
  - §1, §8, §11, §12 deleted (absorbed into Articles 2, 3, 2/7, 8
    respectively).
  - External references in CLAUDE.md, README.md, README.ja.md updated.
- Known issues:
  - SPEC.md now describes Case C target semantics (declaration + token)
    while `src/tools/apply.ts` still implements v0.1.x content-pair.
    This spec-vs-code drift is a deliberate spec-first migration choice
    (see macro-plan Part IV); subsequent micro-plans bring code into
    alignment.
- Tests added: none (docs-only change).
- Spec deviations: none — this commit IS the spec.
```

- [ ] **Step 3: Commit**

```bash
git add IMPLEMENTATION-LOG.md
git commit -m "docs: log Phase 8 — constitutional restructure of SPEC.md"
```

---

## Task 11: Final verification

**Files:**
- Read: `docs/SPEC.md`, `CLAUDE.md`, `README.md`, `README.ja.md`

- [ ] **Step 1: Line-count check**

Run:
```bash
wc -l docs/SPEC.md
```

Expected: between 1050 and 1130 lines. The macro-plan target is ~1090.

- [ ] **Step 2: Section count check**

Run:
```bash
grep -nE "^## Part I|^## Part II|^## [0-9]+\. |^### Article" docs/SPEC.md | wc -l
```

Expected: exactly 1 Part I + 1 Part II + 8 Articles + 8 Part II numbered sections = 18 lines.

- [ ] **Step 3: Verify §4 is unchanged**

Run:
```bash
sha256sum docs/SPEC.md
awk '/^## 4\. The nineteen tool descriptions/,/^---$/' docs/SPEC.md | wc -l
```

The §4 block should still be ~756 lines (it was untouched).

Optional: compare descriptions.ts vs §4:
```bash
git diff main -- src/tools/descriptions.ts
```

Expected: no diff (descriptions.ts not touched in this surgery).

- [ ] **Step 4: Verify obsolete content fully purged**

Run:
```bash
grep -nE "old_content|new_content|sibling temp|MAX_CHANGE_BYTES|apply phase 1|apply phase 2|apply phase 3" docs/SPEC.md
```

Expected: 0 matches.

- [ ] **Step 5: Verify Part I content matches macro-plan**

Run:
```bash
diff <(awk '/^### Article 1 — Mission/,/^---$/' docs/SPEC.md) \
     <(awk '/^### Article 1 — Mission/,/^### Article 2/' docs/plan/case-c-token-spec-restructure/macro-plan.md | head -n -1)
```

Expected: empty diff for Article 1 (and analogously for Articles 2-8 if needed).

- [ ] **Step 6: Push and prepare for review**

```bash
git push
gh pr view 53 --json title,state,isDraft
```

Confirm PR #53 picks up the new commits (Tasks 2-10 add ~9 commits to the branch).

---

## Self-review checklist (run after Task 11)

1. **Spec coverage:** Every section in macro-plan Part II disposition map (§1 absorb, §2 slim, §3 slim heavily, §4 keep, §5 slim+retarget, §6 slim, §7 keep, §8 absorb, §9 keep, §10 slim, §11 absorb, §12 absorb) is implemented by Tasks 2–8. ✓

2. **Placeholder scan:** No "TBD", "TODO", "implement later" in this plan. ✓

3. **Type consistency:** Schema field names (`before_sha256`, `after_sha256`, `additional_files`, `_meta_edit_token`) match between Task 4 (§3 schema), Task 5 (§5 hook pseudocode), and Task 6 (§6 edit-log records). ✓

4. **External-ref completeness:** Tasks 9 covers all `SPEC.md §11` mentions in CLAUDE.md, README.md, README.ja.md. CONTRIBUTING.md was checked and references only §3 / §4 (still valid). ✓

5. **Idempotence:** Each task's verification step (line count + grep) confirms the surgery's effect. Tasks can be re-run; the verifications will catch partial completion.

---

## Out of scope for this plan

These are downstream micro-plans, NOT part of the SPEC.md surgery:

- `02-apply-ts-to-grant-issuer.md` — migrate `src/tools/apply.ts` to a thin grant issuer (drop content-pair handling, add token issuance).
- `03-deny-raw-edit-token-aware.md` — rewrite `src/hooks/raw-edit-policy.ts` to validate tokens per §5.
- `04-edit-log-2state-records.md` — migrate `src/state/edit-log.ts` to the issued/consumed schema in §6.
- `05-grants-module.md` — implement `src/state/grants.ts`.

Each of those will be its own micro-plan once Phase 8 (this surgery) lands and the spec is the canonical reference.

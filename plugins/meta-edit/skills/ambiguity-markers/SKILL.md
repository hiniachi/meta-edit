---
name: ambiguity-markers
description: "Use when formalizing or extending a project's uncertainty-marker conventions in agent instruction files such as AGENTS.md or CLAUDE.md — codifies a small greppable controlled vocabulary across two orthogonal axes (work-status: TODO / FIXME / XXX / HACK / NOTE, and epistemic-certainty: Observed / Inferred from source / **Hypothesis** / **Unverified**) with per-language syntax examples for the languages present in the current project. Trigger when the user asks to \"establish ambiguity markers\", \"codify uncertainty conventions\", \"add hedging vocabulary to agent instructions\", or invokes `/ambiguity-markers`. Complements meta-edit's required `provenance` field (docs/SPEC.md §3.3 / §4) by giving its prose-hedging obligation a concrete grep-discoverable vocabulary that humans, agents, and tooling can all index over."
---

# ambiguity-markers

Establish a small greppable controlled vocabulary for uncertainty in the
current project's source, docs, and tests, and codify it into the project's
agent instruction file.

The skill carries two orthogonal axes (§1) and per-language syntax templates
(§3). An agent that invokes the skill does **not** parse manifests or run a
formal language detector — it looks at the project directory casually
(e.g. `ls src/`, file-extension scan) to identify the main languages in use,
then picks the matching templates from §3.

## When to use

- The user asks to add an "uncertainty markers" / "hedging vocabulary" /
  "ambiguity tags" section to the project's agent instruction file.
- The user invokes `/ambiguity-markers`.
- During an agent-instructions audit when the project's prose-hedging convention is
  un-codified and the agent notices recurring informal markers
  (`// XXX:`, `// TODO:`, ad-hoc `Unverified:`) that would benefit from a
  unified vocabulary.

Do **not** auto-trigger on every project open; this is an explicit-invocation
skill.

## What the invoking agent does

1. **Read** the current project's agent instruction file (prefer `AGENTS.md`
   on Codex, `CLAUDE.md` on Claude Code; if both exist, read both and update
   the one the user asked about).
2. **Look at the source tree casually** — `ls src/`, walk a level or two, scan
   file extensions. Goal: list the main languages in use. No manifest parsing,
   no formal detection.
3. **Judge idempotency semantically** — do the existing agent instructions
   already document either of the two axes (§1), in any form? The judgment is
   semantic: an existing "TODO conventions" subsection covers the work-status
   axis even if its heading differs.
4. **If both axes are already documented**, report what was found and **skip**.
   Do not duplicate.
5. **If one axis is documented and the other is not**, propose only the
   missing axis.
6. **If neither is documented**, propose both.
7. **Compose the proposed instruction-file section** using the §4 skeleton, with
   per-language code blocks (§3) for each language identified in step 2.
   Drop language subsections whose languages are not present.
8. **Show the proposed text to the user**, frame the per-language code blocks
   as "one example, not prescriptive" — these anchor the convention; the
   user's house style governs authoring.
9. **Write only after user confirmation**. Use the typed edit surface
   appropriate to the host project (e.g. meta-edit's `edit_explanation` with
   `provenance: user_confirmed`, citing this session's user instruction).
10. **Never touch source files, tests, or unrelated docs**. The skill writes
    one file: the project's top-level agent instruction file selected in step 1.

## 1. The two axes

The vocabulary is two **orthogonal** axes. Either can stack with the other in
the same line: `TODO: **Unverified**: assumes X` is a valid sentence.

### Work-status axis (industry-standard greppable markers)

| Marker | Meaning |
|---|---|
| `TODO:` | Work to be done, not yet attempted. |
| `FIXME:` | Broken, needs a fix. |
| `XXX:` | Known issue / risky area / sharp edge. |
| `HACK:` | Workaround / non-ideal solution kept in place deliberately. |
| `NOTE:` | Informational annotation worth surfacing to a future reader. |

### Epistemic-certainty axis (loosely tracks meta-edit's `provenance` enum)

| Marker | Meaning | Loose `provenance` mapping |
|---|---|---|
| `Observed:` | Directly observed from execution, logs, or just-read code. | `direct_observation` |
| `Inferred from <X>:` | Reasoned from observation; `<X>` cites the observation. | `inference` |
| `**Hypothesis**:` | Proposed explanation, not yet confirmed. | `speculation` |
| `**Unverified**:` | Assertion not yet verified; verify before acting on it. | `speculation` |

The mapping is intentionally loose: the `provenance` enum is the audit
index, the markers in prose carry the actual hedging language. A reader sees
the markers; an auditor `grep`s them; a meta-edit declaration still records
the enum.

## 2. Why this skill

The `provenance` field (meta-edit v0.6.0+) demands that the *prose* of an
edit carries hedging language — the enum is the audit index, the prose is
what a future reader actually sees (docs/SPEC.md §3.3 / §4). But "use
hedging language" is abstract. The form of that hedging differs per
language: `// **Unverified**: ...` in TypeScript, `# **Unverified**: ...`
in Python, `**Unverified**: ...` in Markdown.

Codifying a small controlled vocabulary at the project level means:

1. The agent has concrete markers to reach for when expressing uncertainty,
   instead of inventing ad-hoc phrasing per edit.
2. A reviewer can `grep -rn '\*\*Unverified\*\*' src/` and audit every
   speculative claim in one pass.
3. Polyglot projects stay internally consistent across languages — the same
   markers, just different comment syntax around them.

## 3. Per-language syntax templates

Pick only the templates for languages the invoking agent identified in
step 2 of the flow. Drop the rest.

### TypeScript / JavaScript (`*.ts`, `*.tsx`, `*.js`, `*.jsx`)

```ts
// TODO: extract the boundary check into a named helper
// FIXME: race between Phase 2 temp-write and Phase 3 rename — see OBSERVED-FAILURES
// **Unverified**: assumes O_NOFOLLOW returns ELOOP on Linux 5.x — verify

/**
 * Validate the request and bind a token.
 *
 * Observed: when target_file does not yet exist, computeBeforeSha256 returns
 *   SHA256_EMPTY (v0.4.2 behavior).
 * Inferred from grants.test.ts:62-69: declaration metadata field shape rarely
 *   changes after release.
 */
```

### Python (`*.py`)

```python
# TODO: backfill the migration for the new column
# **Hypothesis**: the flake is timing-dependent on slower runners — verify with --rerun

def parse_token(raw: str) -> Token:
    """Parse a token string.

    **Unverified**: assumes raw is already canonicalized upstream.
    Inferred from caller chain in pipeline.py:42: this is reached after canonicalize().
    """
```

### Rust (`*.rs`)

```rust
// TODO: replace the .unwrap() with proper error handling
// **Unverified**: assumes the lock is held by the caller — verify against caller chain
// FIXME: the panic in unrecoverable_error() is a workaround until ? is wired

/// Observed: this function is hot in benchmarks (call count ~10^6).
/// **Hypothesis**: inlining the inner loop would cut 8% — measure before committing.
fn process(input: &[u8]) -> Result<Output, Error> {
    todo!()
}
```

### Go (`*.go`)

```go
// TODO: support cancellation via context.Context
// XXX: this assumes Unix line endings — Windows callers must pre-normalize

/* Observed: the underlying syscall returns EINTR ~0.1% of the time under load.
   **Unverified**: the retry policy below is correct for EINTR but not for other
   errno values. */
```

### Markdown (`*.md`, including `AGENTS.md`, `CLAUDE.md`, `README.md`, design docs, planning docs)

```markdown
**Unverified**: the cadence-counter promotion will fire on review-signal triggers only;
no edit-log count is load-bearing alone (see design §6).

TODO: backfill the §6 JSON example for the new `audit_warnings` field.

**Hypothesis**: under-declaration of `repeating_failure` will manifest as zero
counts in dogfood logs. Inferred from §2's honesty-asymmetry argument.
```

### Bash / shell (`*.sh`, CI scripts)

```bash
# TODO: pin the bun version after 1.3.10 stabilizes
# XXX: this awk pipeline assumes BSD coreutils on macOS — verify before dropping
# **Unverified**: the IFS reset on line 42 is needed for nested function calls.
```

### YAML (`.github/workflows/*.yml`, config files)

```yaml
# FIXME: ubuntu-22.04 image deprecation 2026-08; bump to ubuntu-24.04
# Observed: 2026-04 cache thrash when run-id is reused — see action logs
```

### TOML (`Cargo.toml`, `pyproject.toml`)

```toml
# TODO: pin minimum supported Rust version (MSRV) to 1.75 after deps stabilize
# **Unverified**: the workspace inheritance below is correct for cargo 1.74+
```

### JSON (no comment support)

JSON does not support comments. Express the same intent in:

- the relevant `description` / `comment` field, if the schema has one
  (e.g. `package.json`'s `description`, `meta` fields);
- the commit message landing the change;
- the project's `IMPLEMENTATION-LOG.md` (or equivalent ongoing journal);
- an adjacent `*.md` doc when a structural place is needed.

## 4. The Agent Instruction Section The Skill Writes

Use this skeleton. Drop language subsections whose languages are not present
in the current project. Frame the per-language code blocks as **one
example** — they exist to anchor the convention, not to dictate style.

````markdown
## Uncertainty markers (greppable)

Small controlled vocabulary for incomplete work and epistemic uncertainty in
this project. The two axes are independent and can stack; `grep` / review /
audit can run over either.

### Work-status axis

- `TODO:` — work to be done
- `FIXME:` — broken, needs fix
- `XXX:` — known issue / risky
- `HACK:` — workaround
- `NOTE:` — informational annotation

### Epistemic-certainty axis (loose mapping to meta-edit `provenance`)

- `Observed:` — directly observed from execution, logs, or just-read code
  (`provenance: direct_observation`)
- `Inferred from <X>:` — reasoned from observation; `<X>` cites the
  observation (`provenance: inference`)
- `**Hypothesis**:` — proposed explanation, not yet confirmed
  (`provenance: speculation`)
- `**Unverified**:` — assertion not yet verified; verify before acting on
  it (`provenance: speculation`)

The mapping is loose: the `provenance` enum is the audit index; the markers
in prose are what a future reader actually sees.

### Per-language examples

One example per language, not prescriptive — match the surrounding file
style.

<!-- per-language code blocks copied from §3 of the ambiguity-markers
     skill, only for the languages present in this project -->
````

## 5. Out of scope

- **Manifest parsing** (`package.json`, `Cargo.toml`, `pyproject.toml`,
  `go.mod`, etc.) — the invoking agent does a light file-extension /
  directory inspection instead. Detection-as-feature is out.
- **Lint configuration** — the skill does not propose ESLint rules, ripgrep
  configs, or CI greps. Tooling is downstream of convention.
- **IDE integration** — no .vscode tags, no editor-specific marker overlays.
- **Machine-readable metadata** — the markers are greppable strings, not
  parsed annotations.
- **Editing source files, tests, or unrelated docs** — the skill
  writes one file. Source / docs / tests adopt the convention organically
  through future edits, not through a sweep by this skill.
- **Per-user `~/.claude/rules/*.md`** — conventions are project-shaped, not
  user-shaped. This writes to the selected project instruction file.
- **Hard-coding the marker set** — if a project has a long-established
  marker convention that differs from §1 (e.g. uses `WIP:` instead of
  `TODO:`), the agent should propose adopting the project's existing
  vocabulary rather than overwriting it.

## 6. Idempotency contract

The skill is safe to re-run. Re-runs:

- Re-read the current project instruction file from scratch.
- Re-evaluate which axes are covered (semantic judgment, not string
  matching).
- Propose only what is missing.
- Make zero changes if both axes are already covered.

A user who re-edits the section by hand between runs keeps full control; the
skill never reverts hand-edits without first proposing and asking.

---
id: a6-01
category: security/audit-log
severity: MEDIUM
affected_files: [src/state/edit-log.ts]
test_file: src/state/edit-log.test.ts
---

# [SECURITY] Missing regression test for JSON injection safety in `rationale` field

## Summary

`JSON.stringify` correctly escapes embedded newlines, NUL bytes, and ANSI
escape sequences, so a malicious `rationale` string cannot inject a second
JSON line into `edits.jsonl`.  However, no test asserts this property.
`rationale` is entirely attacker-controlled (it comes from the tool caller),
making it the highest-risk injection surface in the log.  The absence of a
regression test on a security-critical code path means a future refactor
(e.g. switching from `JSON.stringify` to a hand-rolled serialiser, or
introducing string interpolation) could silently introduce real injection
without any test catching it.

## Attack surface

`append()` at `src/state/edit-log.ts:82` writes:

```typescript
// edit-log.ts:82
const line = JSON.stringify(entry) + "\n";
```

If `JSON.stringify` were ever bypassed or replaced, a `rationale` value like:

```
innocent text\n{"injected":true,"edit_id":"edit_evil_0001",...}\n
```

would produce two lines in `edits.jsonl`, and `readAll` would return an
extra phantom entry.  Control characters such as NUL (`\x00`) and ANSI CSI
sequences (`\x1b[...`) inside `rationale` are similarly silently included in
terminal output, potentially corrupting `meta-edit log` display.

The v0.1.2 Zod-validated `readAll` (line 129) provides no protection here:
the injected line is valid JSON that would pass schema validation if it
contains all required fields.

## Reproducing failing test

The test below will **pass** on current code (demonstrating the safety
property holds today) but acts as a regression guard.  It is filed as an
issue because the test does not yet exist, and its absence is a defect for a
security-critical path.

```typescript
// Add inside describe("EditLog.append / readAll", ...) in edit-log.test.ts

it("JSON.stringify escapes newlines in rationale — no line injection", () => {
  const log = new EditLog(tmpRoot);

  // Craft a rationale that would inject a second JSON object if not escaped.
  const maliciousRationale =
    'evil\n{"injected":true,"edit_id":"edit_99991231_9999",' +
    '"timestamp":"2026-04-30T00:00:00+00:00","tool_name":"edit_refactor_only",' +
    '"target_file":"src/pwned.ts","rationale":"x","risk_level":"low",' +
    '"test_files":[],"patch_size_bytes":0,"applied":true,"warnings":[]}\n';

  const e = {
    edit_id: "edit_20260430_0001",
    timestamp: "2026-04-30T10:00:00+09:00",
    tool_name: "edit_boundary_condition" as const,
    target_file: "src/foo.ts",
    rationale: maliciousRationale,
    risk_level: "medium" as const,
    test_files: ["tests/foo.test.ts"],
    patch_size_bytes: 42,
    applied: true,
    warnings: [],
  };

  log.append(e);

  // readAll must return exactly one entry.
  const entries = log.readAll();
  expect(entries.length).toBe(1);
  expect(entries[0]?.rationale).toBe(maliciousRationale); // literal value round-trips

  // The raw file must contain exactly one non-empty line.
  const raw = fs.readFileSync(log.filePath, "utf8");
  const nonEmpty = raw.split("\n").filter((l) => l.trim().length > 0);
  expect(nonEmpty.length).toBe(1);

  // And that line must NOT contain a literal newline inside the JSON value
  // (i.e. JSON.stringify escaped it as \\n).
  expect(nonEmpty[0]).not.toMatch(/"injected":true/);
});

it("JSON.stringify escapes NUL bytes and ANSI escapes in rationale", () => {
  const log = new EditLog(tmpRoot);

  const nulRationale = "before\x00after";
  const ansiRationale = "color\x1b[31mred\x1b[0m reset";

  for (const rationale of [nulRationale, ansiRationale]) {
    const e = {
      edit_id: `edit_20260430_000${rationale === nulRationale ? "1" : "2"}`,
      timestamp: "2026-04-30T10:00:00+09:00",
      tool_name: "edit_boundary_condition" as const,
      target_file: "src/foo.ts",
      rationale,
      risk_level: "medium" as const,
      test_files: ["tests/foo.test.ts"],
      patch_size_bytes: 1,
      applied: true,
      warnings: [],
    };
    log.append(e);
  }

  const entries = log.readAll();
  expect(entries.length).toBe(2);
  expect(entries[0]?.rationale).toBe(nulRationale);
  expect(entries[1]?.rationale).toBe(ansiRationale);

  // Raw file: each line must be valid JSON (no raw control characters).
  const raw = fs.readFileSync(log.filePath, "utf8");
  for (const line of raw.split("\n").filter((l) => l.trim().length > 0)) {
    // Raw NUL or ESC outside a JSON string escape would violate JSON spec.
    expect(line).not.toMatch(/[\x00-\x08\x0a-\x1f]/);
  }
});
```

## Expected vs actual

**Expected (and current):** `JSON.stringify` escapes `\n` as `\\n`, `\x00`
as `\\u0000`, and `\x1b` as `\\u001b`.  `readAll` returns exactly as many
entries as `append` was called.  No injected lines appear.

**Without the test:** a future regression (custom serialiser, string
interpolation) could silently break this, and no test would catch it.

## Suggested fix direction

Add the two test cases above to the `"EditLog.append / readAll"` describe
block in `src/state/edit-log.test.ts`.  No production code change is needed.

## Out of scope notes

Content sanitization of `rationale` before storage is explicitly out of
scope (SPEC §11); the guarantee is only that the serialisation layer
preserves the value correctly as a JSON string.

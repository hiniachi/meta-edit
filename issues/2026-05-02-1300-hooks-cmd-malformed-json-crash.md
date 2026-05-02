---
created_at: 2026-05-02T13:00:00+09:00
category: bug
severity: medium
target_file: src/cli/hooks-cmd.ts
target_lines: 243-249
related_test: src/cli/hooks-cmd.test.ts
pr_branch: claude/auto-review-2026-05-02-1300-hooks-cmd-malformed-json-crash
status: pr-open
reviewed_files:
  - src/cli/hooks-cmd.ts
  - src/cli/hooks-cmd.test.ts
---

# `runInstallHooks` / `runUninstallHooks` crash with unhandled `SyntaxError` on malformed `settings.json`

## 概要

`readSettings()` in `src/cli/hooks-cmd.ts` calls `JSON.parse()` without a try/catch. When
`~/.claude/settings.json` or `.claude/settings.json` contains invalid JSON (e.g. a hand-edit
typo), both `runInstallHooks` and `runUninstallHooks` propagate an unhandled `SyntaxError`
instead of writing a user-facing error to the `err` stream and returning a non-zero exit code.
The `err` and `out` streams on `HooksCmdOptions` exist precisely for this pattern; the crash
path bypasses them entirely.

## 該当箇所

```typescript
// src/cli/hooks-cmd.ts:243-249
function readSettings(filePath: string): SettingsShape {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim().length === 0) return {};
  return JSON.parse(text) as SettingsShape;  // ← throws SyntaxError on malformed JSON
}
```

`runInstallHooks` (line 57) and `runUninstallHooks` (line 68) both call `readSettings` without
a try/catch, so any `SyntaxError` escapes to the CLI entrypoint, which prints a raw stack trace
rather than a helpful message.

## 再現テスト

```typescript
// add to the "runInstallHooks (effectful)" describe in src/cli/hooks-cmd.test.ts
it("does not throw and returns non-zero when settings.json contains malformed JSON", () => {
  const target = settingsPathForScope("project", { cwd: tmpRoot });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "{ invalid json }", "utf8");
  let code = -1;
  expect(() => {
    code = runInstallHooks({ scope: "project", cwd: tmpRoot, out, err });
  }).not.toThrow();
  expect(code).not.toBe(0);
  expect(collectedErr.join("")).toMatch(/parse|JSON/i);
});

it("runUninstallHooks: does not throw and returns non-zero when settings.json is malformed", () => {
  const target = settingsPathForScope("project", { cwd: tmpRoot });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "{ invalid json }", "utf8");
  let code = -1;
  expect(() => {
    code = runUninstallHooks({ scope: "project", cwd: tmpRoot, out, err });
  }).not.toThrow();
  expect(code).not.toBe(0);
  expect(collectedErr.join("")).toMatch(/parse|JSON/i);
});
```

Both tests currently fail because the functions throw `SyntaxError` instead of returning.

## 期待される挙動

Both `runInstallHooks` and `runUninstallHooks` should:
1. Catch JSON parse errors from `readSettings`.
2. Write a human-readable error message to `options.err`.
3. Return a non-zero exit code (1).
4. Never throw an unhandled `SyntaxError` to the caller.

## 修正方針

- Wrap `JSON.parse` in `readSettings` with a try/catch that re-throws a descriptive
  `Error` including the file path and the parse error message.
- In `runInstallHooks` and `runUninstallHooks`, wrap the `readSettings` call in a
  try/catch that writes to `options.err` and returns `1`.

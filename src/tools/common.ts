import * as fs from "node:fs";
import * as path from "node:path";
import { parsePatch, type StructuredPatch } from "diff";
import { z } from "zod";
import {
  TOOLS_REQUIRING_TEST_FILES,
  type ToolName,
} from "./descriptions.js";
import {
  isProtectedPath,
  normalizeRepoRelative,
} from "../state/protected-paths.js";

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const EditToolRequestSchema = z.object({
  target_file: z.string().min(1),
  patch: z.string().min(1),
  rationale: z.string(),
  risk_level: RiskLevelSchema,
  test_files: z.array(z.string()),
});

export type EditToolRequest = z.infer<typeof EditToolRequestSchema>;

export type EditToolResult = {
  applied: boolean;
  edit_id: string;
  warnings: string[];
};

export type ValidationContext = {
  repoRoot: string;
};

export type ValidationFailure = {
  ok: false;
  warnings: string[];
};

export type PatchChange = {
  canonical: string;
  diff: StructuredPatch;
};

export type ValidationSuccess = {
  ok: true;
  touchedFiles: string[];
  changes: PatchChange[];
};

export type ValidationResult = ValidationFailure | ValidationSuccess;

// Defensive bound on patch size to keep parsePatch's worst-case bounded
// and to avoid pathological inputs from a malicious MCP client.
export const MAX_PATCH_BYTES = 1_048_576;

// Git extended diff headers that imply a non-modify-only operation.
// Even when oldFileName/newFileName look benign, we reject these so a
// downstream applier cannot honor the extended semantics behind our back.
const FORBIDDEN_EXTENDED_HEADERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "rename from", pattern: /^rename from /m },
  { name: "rename to", pattern: /^rename to /m },
  { name: "copy from", pattern: /^copy from /m },
  { name: "copy to", pattern: /^copy to /m },
  { name: "new file mode", pattern: /^new file mode /m },
  { name: "deleted file mode", pattern: /^deleted file mode /m },
  { name: "similarity index", pattern: /^similarity index /m },
  { name: "dissimilarity index", pattern: /^dissimilarity index /m },
];

export function validateRequest(
  toolName: ToolName,
  request: EditToolRequest,
  ctx: ValidationContext,
): ValidationResult {
  const warnings: string[] = [];

  if (request.rationale.trim().length === 0) {
    warnings.push("rationale must be non-empty");
  }

  if (toolName === "edit_test_only_change") {
    if (request.test_files.length > 0) {
      warnings.push("test_files must be empty for edit_test_only_change");
    }
  } else if (TOOLS_REQUIRING_TEST_FILES.includes(toolName)) {
    if (request.test_files.length === 0) {
      warnings.push(`test_files must be non-empty for ${toolName}`);
    }
  }

  const targetCheck = checkPathSafety(request.target_file, ctx.repoRoot);
  if (!targetCheck.ok) {
    warnings.push(`target_file: ${targetCheck.error}`);
  }

  const testFileCanonicals: string[] = [];
  for (const tf of request.test_files) {
    const c = checkPathSafety(tf, ctx.repoRoot);
    if (!c.ok) {
      warnings.push(`test_files entry "${tf}": ${c.error}`);
    } else {
      testFileCanonicals.push(c.canonical);
    }
  }

  const patchCheck = preValidatePatchInput(request.patch);
  if (!patchCheck.ok) {
    warnings.push(...patchCheck.errors);
    return { ok: false, warnings };
  }

  let parsed;
  try {
    parsed = parsePatch(request.patch);
  } catch (err) {
    warnings.push(
      `patch could not be parsed as a unified diff: ${(err as Error).message}`,
    );
    return { ok: false, warnings };
  }
  if (parsed.length === 0) {
    warnings.push("patch did not contain any file headers");
    return { ok: false, warnings };
  }

  const touched: string[] = [];
  const changes: PatchChange[] = [];
  for (const p of parsed) {
    if (!p.oldFileName && !p.newFileName) {
      warnings.push(
        "patch entry has no file header; input is not a valid unified diff",
      );
      continue;
    }
    if (!p.hunks || p.hunks.length === 0) {
      warnings.push(
        `patch entry for "${p.oldFileName ?? p.newFileName}" has no hunks`,
      );
      continue;
    }

    const cls = classifyPatchFile(p.oldFileName, p.newFileName);
    if (cls.kind === "invalid") {
      warnings.push("patch entry has no usable file header");
      continue;
    }
    if (cls.kind === "creation") {
      warnings.push(
        "patch contains a file creation (/dev/null source); modify-only patches are required",
      );
      continue;
    }
    if (cls.kind === "deletion") {
      warnings.push(
        `patch contains a file deletion (${cls.filename}); modify-only patches are required`,
      );
      continue;
    }
    if (cls.kind === "rename") {
      warnings.push(
        `patch contains a rename (${cls.from} -> ${cls.to}); modify-only patches are required`,
      );
      continue;
    }

    const safe = checkPathSafety(cls.filename, ctx.repoRoot);
    if (!safe.ok) {
      warnings.push(`patch path "${cls.filename}": ${safe.error}`);
      continue;
    }
    touched.push(safe.canonical);
    changes.push({ canonical: safe.canonical, diff: p });
  }

  const allowed = new Set<string>();
  if (targetCheck.ok) {
    allowed.add(targetCheck.canonical);
  }
  if (toolName !== "edit_test_only_change") {
    for (const c of testFileCanonicals) {
      allowed.add(c);
    }
  }

  for (const t of touched) {
    if (!allowed.has(t)) {
      const allowedList = [...allowed].join(", ");
      warnings.push(
        `patch modifies "${t}" which is outside the declared scope (allowed: ${allowedList})`,
      );
    }
  }

  if (warnings.length > 0) {
    return { ok: false, warnings };
  }
  return { ok: true, touchedFiles: touched, changes };
}

export type ToolHandler = (
  toolName: ToolName,
  args: EditToolRequest,
) => Promise<EditToolResult>;

export function makeStubHandler(ctx: ValidationContext): ToolHandler {
  return async (toolName, args) => {
    const result = validateRequest(toolName, args, ctx);
    if (!result.ok) {
      return {
        applied: false,
        edit_id: "edit_00000000_0000",
        warnings: result.warnings,
      };
    }
    return {
      applied: false,
      edit_id: "edit_00000000_0000",
      warnings: [
        `${toolName}: validation passed; patch application is implemented in Phase 3`,
      ],
    };
  };
}

export type EditLogLike = {
  nextEditId(now?: Date): string;
  append(entry: import("../state/edit-log.js").EditLogEntry): void;
};

export type ApplyChangesFn = (
  repoRoot: string,
  changes: PatchChange[],
) => import("./apply.js").ApplyResult;

export type ApplyingHandlerDependencies = {
  ctx: ValidationContext;
  log: EditLogLike;
  applyChanges: ApplyChangesFn;
  now?: () => Date;
};

export function makeApplyingHandler(
  deps: ApplyingHandlerDependencies,
): ToolHandler {
  const { ctx, log, applyChanges } = deps;
  const now = deps.now ?? (() => new Date());

  return async (toolName, args) => {
    const ts = now();
    const editId = log.nextEditId(ts);
    const patchSize = Buffer.byteLength(args.patch, "utf8");
    const baseEntry = {
      edit_id: editId,
      timestamp: isoTimestampForHandler(ts),
      tool_name: toolName,
      target_file: args.target_file,
      rationale: args.rationale,
      risk_level: args.risk_level,
      test_files: args.test_files,
      patch_size_bytes: patchSize,
    } as const;

    const validation = validateRequest(toolName, args, ctx);
    if (!validation.ok) {
      log.append({
        ...baseEntry,
        applied: false,
        warnings: validation.warnings,
      });
      return {
        applied: false,
        edit_id: editId,
        warnings: validation.warnings,
      };
    }

    const result = applyChanges(ctx.repoRoot, validation.changes);
    log.append({
      ...baseEntry,
      applied: result.applied,
      warnings: result.warnings,
    });
    return {
      applied: result.applied,
      edit_id: editId,
      warnings: result.warnings,
    };
  };
}

function isoTimestampForHandler(d: Date): string {
  // Inlined to avoid a circular import between common.ts and edit-log.ts.
  const pad = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const offAbs = Math.abs(offMin);
  const offH = pad(Math.floor(offAbs / 60));
  const offM = pad(offAbs % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${offH}:${offM}`
  );
}

function preValidatePatchInput(
  patch: string,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const byteLength = Buffer.byteLength(patch, "utf8");
  if (byteLength > MAX_PATCH_BYTES) {
    errors.push(
      `patch is ${byteLength} bytes; exceeds the ${MAX_PATCH_BYTES}-byte limit`,
    );
    return { ok: false, errors };
  }

  if (patch.includes("\0")) {
    errors.push("patch contains NUL byte; rejected");
    return { ok: false, errors };
  }

  for (const { name, pattern } of FORBIDDEN_EXTENDED_HEADERS) {
    if (pattern.test(patch)) {
      errors.push(
        `patch contains git extended header "${name}"; modify-only patches are required`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

type PatchFileClassification =
  | { kind: "invalid" }
  | { kind: "creation" }
  | { kind: "deletion"; filename: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "modify"; filename: string };

function classifyPatchFile(
  oldName: string | undefined,
  newName: string | undefined,
): PatchFileClassification {
  const oldT = trimDiffHeader(oldName);
  const newT = trimDiffHeader(newName);

  if (oldT === null && newT === null) {
    return { kind: "invalid" };
  }
  if (oldT === null && newT !== null) {
    return { kind: "creation" };
  }
  if (newT === null && oldT !== null) {
    return { kind: "deletion", filename: oldT };
  }
  if (oldT === newT) {
    return { kind: "modify", filename: oldT! };
  }
  const oldS = stripSingleCharPrefix(oldT!);
  const newS = stripSingleCharPrefix(newT!);
  if (oldS !== null && newS !== null && oldS === newS) {
    return { kind: "modify", filename: oldS };
  }
  return {
    kind: "rename",
    from: oldS ?? oldT!,
    to: newS ?? newT!,
  };
}

function trimDiffHeader(name: string | undefined): string | null {
  if (name === undefined || name === null) {
    return null;
  }
  const tabIndex = name.indexOf("\t");
  const trimmed = (tabIndex >= 0 ? name.slice(0, tabIndex) : name).trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed === "/dev/null") {
    return null;
  }
  return trimmed;
}

function stripSingleCharPrefix(p: string): string | null {
  const m = /^[^\s/]\/(.+)$/.exec(p);
  return m && typeof m[1] === "string" ? m[1] : null;
}

function checkPathSafety(
  p: string,
  repoRoot: string,
): { ok: true; canonical: string } | { ok: false; error: string } {
  if (path.isAbsolute(p)) {
    return {
      ok: false,
      error: `path "${p}" is absolute; must be repository-relative`,
    };
  }
  const norm = normalizeRepoRelative(p);
  if (norm.length === 0) {
    return { ok: false, error: "path is empty after normalization" };
  }
  const lexicalRoot = path.resolve(repoRoot);
  const lexicalResolved = path.resolve(lexicalRoot, norm);
  if (
    lexicalResolved !== lexicalRoot &&
    !lexicalResolved.startsWith(lexicalRoot + path.sep)
  ) {
    return { ok: false, error: `path "${p}" escapes repository root` };
  }

  const realRoot = realpathOrSelf(lexicalRoot);
  const realResolved = realpathOfDeepestExisting(lexicalResolved);

  if (realResolved === null) {
    // realpath threw a non-ENOENT/ENOTDIR error (EACCES, EPERM, ELOOP, ...).
    // We cannot tell whether the filesystem target is inside the repo and
    // outside protected paths, so we fail closed rather than fall back to
    // the lexical form (which would silently accept symlinks to unreadable
    // out-of-repo locations).
    return {
      ok: false,
      error: `path "${p}" could not be canonicalized via realpath; failing closed`,
    };
  }

  if (
    realResolved !== realRoot &&
    !realResolved.startsWith(realRoot + path.sep)
  ) {
    return {
      ok: false,
      error: `path "${p}" escapes repository root after symlink resolution`,
    };
  }

  // NOTE: when the leaf does not exist on disk, realpathOfDeepestExisting
  // re-attaches the missing tail lexically. That means a TOCTOU race exists
  // between this validation and the eventual patch application — a symlink
  // could appear on the missing path and redirect into a protected dir.
  //
  // Phase 3 (the patch applier) MUST, immediately before opening the file
  // for write:
  //   1. Re-run realpath on the full resolved target,
  //   2. Compare the resulting canonical path against the canonical repo
  //      root captured here (`realRoot`) — and reject if it is not equal
  //      to that root or a descendant of it,
  //   3. Re-run isProtectedPath on the freshly canonicalized form and
  //      reject if it now matches a protected prefix.
  // Failing any of these checks means a symlink appeared during the race
  // window; the apply must abort with a fail-closed error.
  const canonical = normalizeRepoRelative(path.relative(realRoot, realResolved));
  if (canonical.length === 0) {
    return { ok: false, error: `path "${p}" resolves to the repository root` };
  }
  if (isProtectedPath(canonical)) {
    return {
      ok: false,
      error: `path "${p}" resolves into a protected directory (.meta-edit/state/ or .meta-edit/tmp/)`,
    };
  }
  return { ok: true, canonical };
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function realpathOfDeepestExisting(p: string): string | null {
  let cur = p;
  const tail: string[] = [];
  while (true) {
    try {
      const real = fs.realpathSync(cur);
      if (tail.length === 0) {
        return real;
      }
      return path.join(real, ...tail.reverse());
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        const parent = path.dirname(cur);
        if (parent === cur) {
          return p;
        }
        tail.push(path.basename(cur));
        cur = parent;
        continue;
      }
      // EACCES, EPERM, ELOOP, EMFILE, etc. — fail closed. The caller will
      // turn this into a validation rejection so we never accept a path we
      // could not canonicalize.
      return null;
    }
  }
}

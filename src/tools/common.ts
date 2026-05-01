import * as fs from "node:fs";
import * as path from "node:path";
import * as Diff from "diff";
import { z } from "zod";
import {
  TOOLS_REQUIRING_TEST_FILES,
  type ToolName,
} from "./descriptions.js";
import {
  isProtectedPath,
  normalizeRepoRelative,
} from "../state/protected-paths.js";
import { realpathOfDeepestExisting } from "../utils/realpath.js";

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// A single content-pair change. The server reads disk content and
// asserts byte-for-byte equality with `old_content` before any write,
// then atomically replaces the file with `new_content`. Modify-only:
// the file must already exist; creation, deletion, and rename are not
// representable in this shape.
export const ChangeSchema = z.object({
  file: z.string().min(1),
  old_content: z.string(),
  new_content: z.string(),
});
export type Change = z.infer<typeof ChangeSchema>;

// Defensive cap on the number of `change` entries. Combined with
// `MAX_CHANGE_BYTES`, this bounds the total work the server has to do
// per request — both for validation (per-change `checkPathSafety`,
// NUL scan) and for the synthesized-diff computation that populates
// `patch_size_bytes`. Chosen well above any realistic agent edit
// (typical: 1-5 changes per call).
export const MAX_CHANGES_PER_REQUEST = 100;

export const EditToolRequestSchema = z.object({
  target_file: z.string().min(1),
  rationale: z.string(),
  risk_level: RiskLevelSchema,
  test_files: z.array(z.string()),
  changes: z
    .array(ChangeSchema)
    .min(1)
    .max(MAX_CHANGES_PER_REQUEST),
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

export type ContentChange = {
  canonical: string;
  oldContent: string;
  newContent: string;
};

export type ValidationSuccess = {
  ok: true;
  touchedFiles: string[];
  changes: ContentChange[];
};

export type ValidationResult = ValidationFailure | ValidationSuccess;

// Defensive bound on the total request payload size: the sum across
// all `change.old_content` and `change.new_content` of
// `Buffer.byteLength(s, "utf8")`. Same 1 MiB ceiling the prior
// `MAX_PATCH_BYTES` enforced on the unified-diff string, just measured
// on the new shape.
export const MAX_CHANGE_BYTES = 1_048_576;

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

  if (request.changes.length === 0) {
    warnings.push("changes must contain at least one entry");
    return { ok: false, warnings };
  }
  if (request.changes.length > MAX_CHANGES_PER_REQUEST) {
    warnings.push(
      `changes contains ${request.changes.length} entries; exceeds the ${MAX_CHANGES_PER_REQUEST}-entry limit`,
    );
    return { ok: false, warnings };
  }

  let totalBytes = 0;
  for (const c of request.changes) {
    totalBytes +=
      Buffer.byteLength(c.old_content, "utf8") +
      Buffer.byteLength(c.new_content, "utf8");
  }
  if (totalBytes > MAX_CHANGE_BYTES) {
    warnings.push(
      `changes total payload is ${totalBytes} bytes; exceeds the ${MAX_CHANGE_BYTES}-byte limit`,
    );
    return { ok: false, warnings };
  }

  const touched: string[] = [];
  const changes: ContentChange[] = [];
  for (const c of request.changes) {
    if (c.old_content.includes("\0")) {
      warnings.push(`change.old_content for "${c.file}" contains NUL byte; rejected`);
      continue;
    }
    if (c.new_content.includes("\0")) {
      warnings.push(`change.new_content for "${c.file}" contains NUL byte; rejected`);
      continue;
    }
    // Reject no-op changes (old_content === new_content). Pre-PR-D the
    // jsdiff parser rejected zero-hunk patches; the content-pair flow
    // would otherwise accept them and still stage+rename the file,
    // bumping mtime / inode and triggering downstream watchers /
    // rebuilds for a semantically empty edit. Codex GitHub bot review
    // on PR #29 (P2) caught this regression.
    if (c.old_content === c.new_content) {
      warnings.push(
        `change for "${c.file}" has identical old_content and new_content (no-op); reject so audit logs and watchers are not bumped for empty edits`,
      );
      continue;
    }
    const safe = checkPathSafety(c.file, ctx.repoRoot);
    if (!safe.ok) {
      warnings.push(`change.file "${c.file}": ${safe.error}`);
      continue;
    }
    touched.push(safe.canonical);
    changes.push({
      canonical: safe.canonical,
      oldContent: c.old_content,
      newContent: c.new_content,
    });
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
        `change modifies "${t}" which is outside the declared scope (allowed: ${allowedList})`,
      );
    }
  }

  // Reject duplicate canonicals. Earlier validateRequest rejected
  // multi-section patches that targeted the same file; the same
  // protection applies here. Two changes pointing at the same
  // canonical path mean the second silently wins and the first's
  // intent is lost — clearer to fail and have the caller submit
  // separate edit_* calls.
  const seenCanonical = new Set<string>();
  for (const t of touched) {
    if (seenCanonical.has(t)) {
      warnings.push(
        `changes contain multiple entries targeting "${t}". Submit each as its own edit_* call so changes are not silently dropped.`,
      );
    } else {
      seenCanonical.add(t);
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
  changes: ContentChange[],
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
    const baseEntry = {
      edit_id: editId,
      timestamp: isoTimestampForHandler(ts),
      tool_name: toolName,
      target_file: args.target_file,
      rationale: args.rationale,
      risk_level: args.risk_level,
      test_files: args.test_files,
    } as const;

    const validation = validateRequest(toolName, args, ctx);
    if (!validation.ok) {
      // Synthesizing the unified diff before validation would let a
      // malicious or buggy client force unbounded `createTwoFilesPatch`
      // work on a request that was about to be rejected. We log
      // `patch_size_bytes: 0` on validation failure — there is no
      // applied diff to measure.
      const finalWarnings = appendLogSafely(log, {
        ...baseEntry,
        patch_size_bytes: 0,
        applied: false,
        warnings: validation.warnings,
      });
      return {
        applied: false,
        edit_id: editId,
        warnings: finalWarnings,
      };
    }

    // Validation passed — total payload is bounded by MAX_CHANGE_BYTES
    // and the changes count is bounded by MAX_CHANGES_PER_REQUEST. Now
    // it's safe to synthesize the forensic diff for `patch_size_bytes`.
    let synthesized = "";
    for (const c of args.changes) {
      synthesized += Diff.createTwoFilesPatch(
        c.file,
        c.file,
        c.old_content,
        c.new_content,
        "old",
        "new",
      );
    }
    const patchSize = Buffer.byteLength(synthesized, "utf8");

    const result = applyChanges(ctx.repoRoot, validation.changes);
    // The new content is already on disk if result.applied. We MUST NOT
    // throw out of the handler here even if log.append fails: the
    // client would see the call as failed and likely retry, causing
    // duplicate edits. appendLogSafely surfaces the log failure as a
    // warning instead.
    const finalWarnings = appendLogSafely(log, {
      ...baseEntry,
      patch_size_bytes: patchSize,
      applied: result.applied,
      warnings: result.warnings,
    });
    return {
      applied: result.applied,
      edit_id: editId,
      warnings: finalWarnings,
    };
  };
}

function appendLogSafely(
  log: EditLogLike,
  entry: import("../state/edit-log.js").EditLogEntry,
): string[] {
  try {
    log.append(entry);
    return entry.warnings;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    const msg = (e as Error | undefined)?.message ?? String(e);
    return [
      ...entry.warnings,
      `failed to append edit log entry "${entry.edit_id}" (${code ?? "ERR"}: ${msg}); the call result is reported but the audit record may be missing or incomplete`,
    ];
  }
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
  let norm: string;
  try {
    norm = normalizeRepoRelative(p);
  } catch (err) {
    // normalizeRepoRelative throws on NUL bytes (a4-02) — surface as a
    // structured error rather than an unhandled exception.
    return {
      ok: false,
      error: `path "${p}" is invalid: ${(err as Error).message}`,
    };
  }
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

import * as path from "node:path";
import { parsePatch } from "diff";
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

export type ValidationSuccess = {
  ok: true;
  touchedFiles: string[];
};

export type ValidationResult = ValidationFailure | ValidationSuccess;

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

    const oldName = canonicalPathFromHeader(p.oldFileName);
    const newName = canonicalPathFromHeader(p.newFileName);

    if (oldName === null) {
      warnings.push(
        "patch contains a file creation (/dev/null source); modify-only patches are required",
      );
      continue;
    }
    if (newName === null) {
      warnings.push(
        "patch contains a file deletion (/dev/null target); modify-only patches are required",
      );
      continue;
    }
    if (oldName !== newName) {
      warnings.push(
        `patch contains a rename (${oldName} -> ${newName}); modify-only patches are required`,
      );
      continue;
    }

    const safe = checkPathSafety(oldName, ctx.repoRoot);
    if (!safe.ok) {
      warnings.push(`patch path "${oldName}": ${safe.error}`);
      continue;
    }

    touched.push(safe.canonical);
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
  return { ok: true, touchedFiles: touched };
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

function canonicalPathFromHeader(name: string | undefined): string | null {
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
  return trimmed.replace(/^[ab]\//, "");
}

function checkPathSafety(
  p: string,
  repoRoot: string,
):
  | { ok: true; canonical: string }
  | { ok: false; error: string } {
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
  const resolvedRoot = path.resolve(repoRoot);
  const resolved = path.resolve(resolvedRoot, norm);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(resolvedRoot + path.sep)
  ) {
    return { ok: false, error: `path "${p}" escapes repository root` };
  }
  // Re-derive the repo-relative path from the *resolved* absolute path so that
  // traversal aliases (e.g. "src/../.meta-edit/state/edits.jsonl") are
  // collapsed before the protected-path check and the scope comparison.
  const canonical = normalizeRepoRelative(path.relative(resolvedRoot, resolved));
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

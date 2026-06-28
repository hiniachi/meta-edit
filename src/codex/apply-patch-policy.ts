import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { HookDecision } from "../hooks/hook-runtime.js";
import { buildReminderContext } from "../reminders/context.js";
import { isoTimestamp, type ConsumedEntry, type EditLog } from "../state/edit-log.js";
import type { ActiveBindingMatch, GrantsStore } from "../state/grants.js";
import { checkPathSafety, sha256Hex } from "../tools/common.js";

export type ApplyPatchTarget = {
  operation: "add" | "update" | "delete";
  path: string;
};

export type ApplyPatchExtractResult =
  | { ok: true; targets: ApplyPatchTarget[] }
  | { ok: false; error: string };

type PreflightTarget = {
  canonical: string;
  match: ActiveBindingMatch;
};

export function extractApplyPatchTargets(
  patch: string,
): ApplyPatchExtractResult {
  if (typeof patch !== "string" || patch.trim().length === 0) {
    return { ok: false, error: "apply_patch payload is empty" };
  }

  const lines = patch.split(/\r?\n/);
  if (lines[0] !== "*** Begin Patch") {
    return { ok: false, error: "apply_patch payload missing Begin Patch header" };
  }
  const endIndex = lines.indexOf("*** End Patch");
  if (endIndex === -1) {
    return { ok: false, error: "apply_patch payload missing End Patch footer" };
  }

  const targets: ApplyPatchTarget[] = [];
  for (const line of lines.slice(1, endIndex)) {
    if (line.startsWith("*** Move to:")) {
      return {
        ok: false,
        error:
          "apply_patch move/rename patches are not supported by meta-edit yet; declare and edit the final file explicitly",
      };
    }

    const add = parseHeader(line, "*** Add File:");
    if (add !== null) {
      targets.push({ operation: "add", path: add });
      continue;
    }
    const update = parseHeader(line, "*** Update File:");
    if (update !== null) {
      targets.push({ operation: "update", path: update });
      continue;
    }
    const del = parseHeader(line, "*** Delete File:");
    if (del !== null) {
      targets.push({ operation: "delete", path: del });
      continue;
    }
  }

  if (targets.length === 0) {
    return { ok: false, error: "apply_patch payload contains no file targets" };
  }
  return { ok: true, targets };
}

export async function evaluateCodexApplyPatch(args: {
  patch: string;
  repoRoot: string;
  grants: GrantsStore;
  log: EditLog;
  now?: () => Date;
}): Promise<HookDecision> {
  const parsed = extractApplyPatchTargets(args.patch);
  if (!parsed.ok) {
    return { decision: "deny", reason: parsed.error };
  }

  const preflight: PreflightTarget[] = [];
  const seen = new Set<string>();

  for (const target of parsed.targets) {
    const pathCheck = checkPathSafety(target.path, args.repoRoot);
    if (!pathCheck.ok) {
      return {
        decision: "deny",
        reason:
          `[meta-edit:path-mismatch] apply_patch target "${target.path}" is not safe: ${pathCheck.error}`,
      };
    }
    const canonical = pathCheck.canonical;
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    const diskRead = await readFileForBinding(args.repoRoot, canonical);
    if (!diskRead.ok) {
      return {
        decision: "deny",
        reason:
          `[meta-edit:unreadable] could not read "${canonical}" before apply_patch preflight ` +
          `(${diskRead.error}); re-read and re-issue a typed_edit declaration.`,
      };
    }
    const diskSha = sha256Hex(diskRead.content);
    const match = await args.grants.findActiveBindingForFile(canonical, {
      preferBeforeSha: diskSha,
    });
    if (match === null) {
      return {
        decision: "deny",
        reason:
          `meta-edit reminder:\n\n` +
          `I was about to apply_patch "${canonical}" (repoRoot="${args.repoRoot}") but no active typed_edit declaration covers it.\n\n` +
          `That would skip the intended classification step. The correct next move is to call a typed edit_* MCP tool first, then retry the patch.`,
      };
    }
    if (match.binding.before_sha256 !== diskSha) {
      return {
        decision: "deny",
        reason:
          `[meta-edit:stale] apply_patch preflight found disk drift for "${canonical}" ` +
          `(declared before_sha256=${shortHash(match.binding.before_sha256)}, actual ${shortHash(diskSha)}). ` +
          `Re-read the file and issue a fresh typed_edit declaration before retrying.`,
      };
    }
    preflight.push({ canonical, match });
  }

  const contexts: string[] = [];
  const nowFn = args.now ?? (() => new Date());
  let consumedCount = 0;
  for (const item of preflight) {
    const consumeRes = await args.grants.consume(
      item.match.grant.token_id,
      item.canonical,
    );
    if (!consumeRes.consumed) {
      const err = consumeRes.error ?? "unknown error";
      if (consumedCount > 0) {
        const reason =
          `[meta-edit:partial-consume] apply_patch preflight succeeded, but consuming "${item.canonical}" failed after ${consumedCount} earlier binding(s) were already consumed: ${err}. ` +
          "The patch is allowed to proceed (warn, not a block) to avoid burning the already-consumed grants; the uncovered target was not separately consumed — re-check the edit log afterward.";
        return {
          decision: "warn",
          reason,
          ...(contexts.length > 0
            ? { additionalContext: contexts.join("\n\n") }
            : {}),
        };
      }
      return {
        decision: "deny",
        reason:
          `[meta-edit:consume-failed] apply_patch preflight succeeded but consuming "${item.canonical}" failed: ${err}. ` +
          "Re-declare with a typed edit_* MCP tool before retrying.",
      };
    }
    consumedCount++;

    const consumed: ConsumedEntry = {
      edit_id: item.match.grant.edit_id,
      ts: isoTimestamp(nowFn()),
      phase: "consumed",
      consuming_tool: "apply_patch",
    };
    try {
      args.log.appendConsumed(consumed);
    } catch (e) {
      process.stderr.write(
        `[meta-edit] WARN: failed to append consumed record for ${item.match.grant.edit_id}: ${(e as Error).message}\n`,
      );
    }

    const declaration = item.match.grant.declaration;
    if (declaration !== undefined) {
      contexts.push(
        buildReminderContext({
          phase: "write_allowed",
          kind: declaration.kind,
          ...(declaration.target !== undefined ? { target: declaration.target } : {}),
          provenance: declaration.provenance,
          ...(declaration.execution_state !== undefined
            ? { executionState: declaration.execution_state }
            : {}),
          targetFile: item.canonical,
          declaredTestFiles: declaration.test_files,
        }),
      );
    }
  }

  return {
    decision: "allow",
    ...(contexts.length > 0
      ? { additionalContext: contexts.join("\n\n") }
      : {}),
  };
}

function parseHeader(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) return null;
  const value = line.slice(prefix.length).trim();
  return value.length > 0 ? value : null;
}

async function readFileForBinding(
  repoRoot: string,
  canonical: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    return {
      ok: true,
      content: await fs.readFile(path.join(repoRoot, canonical), "utf8"),
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { ok: true, content: "" };
    }
    return { ok: false, error: err.code ?? err.message };
  }
}

function shortHash(hash: string): string {
  return hash.length >= 12 ? `${hash.slice(0, 12)}...` : hash;
}

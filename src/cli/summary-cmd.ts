import { EditLog, type EditLogEntry } from "../state/edit-log.js";
import type { RiskLevel } from "../tools/common.js";
import { TOOL_NAMES } from "../tools/descriptions.js";
import { parseStrictSince } from "./parse-since.js";

/**
 * Strip ANSI escape sequences (CSI, OSC) from a string so that audit values
 * embedded in the human-readable summary table cannot manipulate the
 * operator's terminal (clear-screen, OSC title injection, cursor moves, etc.).
 *
 * Only the CLI display layer is sanitised — the underlying edit log
 * (`.meta-edit/state/edits.jsonl`) preserves the original value as the audit
 * record of ground truth.
 */
function stripAnsi(s: string): string {
  // CSI: ESC [ ... letter ; OSC: ESC ] ... BEL ; plus any bare ESC byte.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07|.)/g, "");
}

export type SummaryOptions = {
  repoRoot: string;
  since?: Date | undefined;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
};

export function runSummaryCommand(options: SummaryOptions): number {
  const log = new EditLog(options.repoRoot);
  const all = log.readAll();
  const filtered =
    options.since === undefined
      ? all
      : all.filter((e) => {
          const t = new Date(e.ts).getTime();
          return Number.isFinite(t) && t >= (options.since as Date).getTime();
        });
  const text = formatSummary(filtered, options.since);
  options.out.write(text);
  return 0;
}

export function formatSummary(
  entries: EditLogEntry[],
  since: Date | undefined,
): string {
  // Reconcile by edit_id: an issued record paired with a consumed sibling
  // means the deny-raw-edit hook authorized the corresponding native
  // Edit/Write call (PreToolUse, before the write executes). The actual
  // write success is not in the audit log — that's git's job. An issued
  // record without a consumed sibling is an abandoned/expired declaration.
  // A rejected record never has a sibling.
  const issuedIds = new Set<string>();
  const consumedIds = new Set<string>();
  const rejectedIds = new Set<string>();
  for (const e of entries) {
    if (e.phase === "issued") issuedIds.add(e.edit_id);
    else if (e.phase === "consumed") consumedIds.add(e.edit_id);
    else if (e.phase === "rejected") rejectedIds.add(e.edit_id);
  }

  // Total declarations the server processed = issued + rejected. A consumed
  // record always has an issued sibling (or the audit log is corrupt; the
  // reconciliation surfaces that as `issued without consumed`).
  const totalDeclarations = issuedIds.size + rejectedIds.size;
  let authorizedCount = 0;
  let abandonedCount = 0;
  for (const id of issuedIds) {
    if (consumedIds.has(id)) authorizedCount++;
    else abandonedCount++;
  }
  const rejectedCount = rejectedIds.size;

  const sinceLabel =
    since === undefined ? "all time" : `since ${formatIso(since)}`;

  const issuedEntries = entries.filter(
    (e): e is Extract<EditLogEntry, { phase: "issued" }> => e.phase === "issued",
  );
  const byTool = countBy(issuedEntries, (e) => stripAnsi(e.kind));
  const byRisk = countBy(issuedEntries, (e) => e.risk_level);
  const byFile = countBy(issuedEntries, (e) => stripAnsi(e.target_file));

  const lines: string[] = [];
  lines.push(`meta-edit summary (${sinceLabel})`);
  lines.push("");
  lines.push(`Total declarations: ${totalDeclarations}`);
  lines.push(`  Authorized (hook approved write): ${authorizedCount}`);
  lines.push(`  Abandoned (issued, never authorized): ${abandonedCount}`);
  lines.push(`  Rejected (validation failure): ${rejectedCount}`);
  lines.push("");

  lines.push("By tool:");
  const toolCounts = new Map<string, number>();
  for (const name of TOOL_NAMES) toolCounts.set(name, 0);
  for (const [name, count] of byTool.entries()) toolCounts.set(name, count);
  const toolOrder = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of toolOrder) {
    if (count === 0 && name !== "edit_policy_change") {
      continue;
    }
    lines.push(
      `  ${name.padEnd(28)}${String(count).padStart(4)}  (${pct(count, issuedEntries.length)})`,
    );
  }
  lines.push("");

  lines.push("By risk_level:");
  const riskOrder: RiskLevel[] = ["low", "medium", "high", "critical"];
  for (const r of riskOrder) {
    const count = byRisk.get(r) ?? 0;
    lines.push(`  ${r.padEnd(8)} ${String(count).padStart(4)}`);
  }
  lines.push("");

  lines.push("Files most edited:");
  const topFiles = Array.from(byFile.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topFiles.length === 0) {
    lines.push("  (no edits yet)");
  } else {
    for (const [file, count] of topFiles) {
      lines.push(`  ${file.padEnd(40)} ${String(count).padStart(4)}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  const v = Math.round((part / total) * 100);
  return `${v}%`;
}

function formatIso(d: Date): string {
  return d.toISOString();
}

export function parseSummaryArgs(argv: string[]): {
  ok: true;
  since?: Date;
} | {
  ok: false;
  error: string;
} {
  let since: Date | undefined;
  let sinceSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--since") {
      if (sinceSeen) {
        return { ok: false, error: "--since may only appear once" };
      }
      sinceSeen = true;
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: "--since requires a date" };
      const d = parseDate(v);
      if (d === null) {
        return { ok: false, error: `--since: invalid date "${v}"` };
      }
      since = d;
    } else {
      return { ok: false, error: `unknown flag: ${arg}` };
    }
  }
  return since === undefined ? { ok: true } : { ok: true, since };
}

function parseDate(s: string): Date | null {
  return parseStrictSince(s);
}

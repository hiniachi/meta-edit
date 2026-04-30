import { EditLog, type EditLogEntry } from "../state/edit-log.js";
import type { RiskLevel } from "../tools/common.js";
import { TOOL_NAMES } from "../tools/descriptions.js";
import { parseStrictSince } from "./parse-since.js";

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
          const t = new Date(e.timestamp).getTime();
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
  const total = entries.length;
  const applied = entries.filter((e) => e.applied).length;
  const failed = total - applied;

  const sinceLabel =
    since === undefined ? "all time" : `since ${formatIso(since)}`;

  const byTool = countBy(entries, (e) => e.tool_name);
  const byRisk = countBy(entries, (e) => e.risk_level);
  const byFile = countBy(entries, (e) => e.target_file);

  const lines: string[] = [];
  lines.push(`meta-edit summary (${sinceLabel})`);
  lines.push("");
  lines.push(`Total edits: ${total}`);
  lines.push(`  Applied successfully: ${applied}`);
  lines.push(`  Validation failures:  ${failed}`);
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
    lines.push(`  ${name.padEnd(28)}${String(count).padStart(4)}  (${pct(count, total)})`);
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

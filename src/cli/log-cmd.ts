import { EditLog, type EditLogEntry } from "../state/edit-log.js";
import type { RiskLevel } from "../tools/common.js";
import { parseStrictSince } from "./parse-since.js";

export type LogFilters = {
  tool?: string | undefined;
  risk?: RiskLevel | undefined;
  since?: Date | undefined;
};

export type LogCommandOptions = {
  repoRoot: string;
  filters: LogFilters;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
};

export function runLogCommand(options: LogCommandOptions): number {
  const log = new EditLog(options.repoRoot);
  const entries = log.readAll();
  const filtered = filterEntries(entries, options.filters);
  for (const e of filtered) {
    options.out.write(JSON.stringify(e) + "\n");
  }
  return 0;
}

export function filterEntries(
  entries: EditLogEntry[],
  filters: LogFilters,
): EditLogEntry[] {
  return entries.filter((e) => {
    if (filters.tool !== undefined && e.tool_name !== filters.tool) return false;
    if (filters.risk !== undefined && e.risk_level !== filters.risk) return false;
    if (filters.since !== undefined) {
      const t = parseTimestamp(e.timestamp);
      if (t === null) return false;
      if (t.getTime() < filters.since.getTime()) return false;
    }
    return true;
  });
}

export function parseLogArgs(argv: string[]): {
  ok: true;
  filters: LogFilters;
} | {
  ok: false;
  error: string;
} {
  const filters: LogFilters = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tool") {
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: "--tool requires a value" };
      filters.tool = v;
    } else if (arg === "--risk") {
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: "--risk requires a value" };
      if (v !== "low" && v !== "medium" && v !== "high" && v !== "critical") {
        return { ok: false, error: `--risk must be one of low|medium|high|critical (got "${v}")` };
      }
      filters.risk = v;
    } else if (arg === "--since") {
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: "--since requires a date" };
      const d = parseSinceDate(v);
      if (d === null) {
        return { ok: false, error: `--since: invalid date "${v}" (try YYYY-MM-DD or an ISO 8601 timestamp)` };
      }
      filters.since = d;
    } else {
      return { ok: false, error: `unknown flag: ${arg}` };
    }
  }
  return { ok: true, filters };
}

function parseTimestamp(ts: string): Date | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseSinceDate(s: string): Date | null {
  return parseStrictSince(s);
}

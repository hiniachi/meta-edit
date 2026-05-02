import { EditLog, type EditLogEntry } from "../state/edit-log.js";
import type { RiskLevel } from "../tools/common.js";
import { parseStrictSince } from "./parse-since.js";

export type LogFilters = {
  /**
   * Filter on the `kind` field of issued/rejected records (e.g.
   * "edit_boundary_condition"). Consumed records have no kind so they are
   * dropped when this filter is set.
   */
  tool?: string | undefined;
  /** Filter on risk_level. Only issued records carry it. */
  risk?: RiskLevel | undefined;
  /** Inclusive lower bound on the record `ts` field. */
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
    if (filters.tool !== undefined) {
      // `kind` only exists on issued + rejected; consumed records carry
      // only the consuming_tool, which is never an edit_* tool name.
      if (e.phase === "consumed") return false;
      if (e.kind !== filters.tool) return false;
    }
    if (filters.risk !== undefined) {
      // risk_level only on issued. consumed/rejected carry no risk so
      // they are filtered out when --risk is in play.
      if (e.phase !== "issued") return false;
      if (e.risk_level !== filters.risk) return false;
    }
    if (filters.since !== undefined) {
      const t = parseTimestamp(e.ts);
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
  let toolSeen = false;
  let riskSeen = false;
  let sinceSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tool") {
      if (toolSeen) return { ok: false, error: "--tool may only appear once" };
      toolSeen = true;
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: "--tool requires a value" };
      filters.tool = v;
    } else if (arg === "--risk") {
      if (riskSeen) return { ok: false, error: "--risk may only appear once" };
      riskSeen = true;
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: "--risk requires a value" };
      if (v !== "low" && v !== "medium" && v !== "high" && v !== "critical") {
        return { ok: false, error: `--risk must be one of low|medium|high|critical (got "${v}")` };
      }
      filters.risk = v;
    } else if (arg === "--since") {
      if (sinceSeen) return { ok: false, error: "--since may only appear once" };
      sinceSeen = true;
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

import { EditLog, type EditLogEntry } from "../state/edit-log.js";
import { ProvenanceSchema, type EditTarget, type Provenance, type RiskLevel } from "../tools/common.js";
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
  /**
   * Filter on the v0.5.0 prod/test target. Only issued/rejected impl-tool
   * records carry it; the 5 workflow-axis kinds (and the legacy
   * edit_docs_only bucket) have no target and are dropped when this
   * filter is set. Consumed records carry no target either.
   */
  target?: EditTarget | undefined;
  /**
   * Filter on the v0.6.0 provenance field. Accepts a single value
   * (`--provenance speculation`) or a comma-separated set
   * (`--provenance speculation,inference`). Legacy v0.5.x entries that
   * predate provenance are dropped when this filter is set.
   */
  provenance?: ReadonlySet<Provenance> | undefined;
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
    // Unparseable timestamps are dropped UNCONDITIONALLY (whether or not
    // --since is in play) so that invalid-ts entries can never silently
    // change the count between filtered and unfiltered views. Per issue
    // 2026-05-02-1041-invalid-timestamp-silently-dropped-by-since-filter.
    const ts = parseTimestamp(e.ts);
    if (ts === null) return false;
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
    if (filters.target !== undefined) {
      // target only on issued/rejected impl-tool records (15 SQLite +
      // edit_cosmetic). consumed records carry no target; workflow-axis
      // kinds (5 v0.6.0 + legacy edit_docs_only) have target absent by
      // design; both are filtered out when --target is in play.
      if (e.phase === "consumed") return false;
      if (e.target !== filters.target) return false;
    }
    if (filters.provenance !== undefined) {
      // provenance only on issued/rejected v0.6.0+ records. consumed
      // records carry no provenance; v0.5.x legacy entries (read-time
      // optional per state/edit-log.ts) likewise do not. Both drop out
      // when --provenance is in play.
      if (e.phase === "consumed") return false;
      if (e.provenance === undefined) return false;
      if (!filters.provenance.has(e.provenance)) return false;
    }
    if (filters.since !== undefined) {
      if (ts.getTime() < filters.since.getTime()) return false;
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
  let targetSeen = false;
  let provenanceSeen = false;
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
    } else if (arg === "--target") {
      if (targetSeen) return { ok: false, error: "--target may only appear once" };
      targetSeen = true;
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: "--target requires a value" };
      if (v !== "prod" && v !== "test") {
        return { ok: false, error: `--target must be prod or test (got "${v}")` };
      }
      filters.target = v;
    } else if (arg === "--provenance") {
      if (provenanceSeen) return { ok: false, error: "--provenance may only appear once" };
      provenanceSeen = true;
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: "--provenance requires a value" };
      const parts = v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (parts.length === 0) {
        return { ok: false, error: `--provenance: empty value` };
      }
      const set = new Set<Provenance>();
      for (const p of parts) {
        const parsed = ProvenanceSchema.safeParse(p);
        if (!parsed.success) {
          return {
            ok: false,
            error: `--provenance: invalid value "${p}" (expected one of user_confirmed, accepted_artifact, direct_observation, inference, speculation)`,
          };
        }
        set.add(parsed.data);
      }
      filters.provenance = set;
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

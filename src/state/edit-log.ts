import * as fs from "node:fs";
import * as path from "node:path";
import type { RiskLevel } from "../tools/common.js";

// Append-only JSON Lines log of every edit_* call attempted against this
// repository. Per docs/SPEC.md §6:
//   .meta-edit/state/edits.jsonl
//   {"edit_id":"edit_YYYYMMDD_NNNN", ...}
//
// edit_id is monotonic within a calendar day. On first use we scan the
// existing log to find today's largest NNNN and start the in-process
// counter from there + 1. Sequential calls increment in memory; the file
// itself is read once per day boundary, not per call.

export type EditLogEntry = {
  edit_id: string;
  timestamp: string;
  tool_name: string;
  target_file: string;
  rationale: string;
  risk_level: RiskLevel;
  test_files: string[];
  patch_size_bytes: number;
  applied: boolean;
  warnings: string[];
};

const EDIT_ID_RE = /^edit_(\d{8})_(\d{4})$/;

export class EditLog {
  private readonly statePath: string;
  private readonly logPath: string;
  private todayKey: string | null = null;
  private todayCounter = 0;

  constructor(repoRoot: string) {
    this.statePath = path.join(repoRoot, ".meta-edit", "state");
    this.logPath = path.join(this.statePath, "edits.jsonl");
  }

  get filePath(): string {
    return this.logPath;
  }

  nextEditId(now: Date = new Date()): string {
    const key = formatDayKey(now);
    if (this.todayKey !== key) {
      this.todayKey = key;
      this.todayCounter = this.scanMaxCounterForKey(key);
    }
    this.todayCounter += 1;
    const nnnn = String(this.todayCounter).padStart(4, "0");
    return `edit_${key}_${nnnn}`;
  }

  append(entry: EditLogEntry): void {
    fs.mkdirSync(this.statePath, { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(this.logPath, line, { encoding: "utf8" });
  }

  readAll(): EditLogEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }
    const text = fs.readFileSync(this.logPath, "utf8");
    const out: EditLogEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        out.push(JSON.parse(trimmed) as EditLogEntry);
      } catch {
        // Skip malformed lines; never crash the reader.
      }
    }
    return out;
  }

  private scanMaxCounterForKey(key: string): number {
    if (!fs.existsSync(this.logPath)) {
      return 0;
    }
    let text: string;
    try {
      text = fs.readFileSync(this.logPath, "utf8");
    } catch {
      return 0;
    }
    let max = 0;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "edit_id" in parsed &&
        typeof (parsed as { edit_id: unknown }).edit_id === "string"
      ) {
        const m = EDIT_ID_RE.exec((parsed as { edit_id: string }).edit_id);
        if (m && m[1] === key) {
          const n = Number.parseInt(m[2]!, 10);
          if (Number.isFinite(n) && n > max) {
            max = n;
          }
        }
      }
    }
    return max;
  }
}

function formatDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function isoTimestamp(d: Date = new Date()): string {
  // ISO 8601 with timezone offset (per SPEC §6 example).
  // Date#toISOString returns Zulu; we render local offset for parity with
  // the spec sample. If offset is 0, render "+00:00".
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

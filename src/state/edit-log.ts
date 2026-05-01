import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { RiskLevelSchema } from "../tools/common.js";

// Append-only JSON Lines log of every edit_* call attempted against this
// repository. Per docs/SPEC.md §6:
//   .meta-edit/state/edits.jsonl
//   {"edit_id":"edit_YYYYMMDD_NNNN", ...}
//
// edit_id is monotonic within a calendar day. On first use we scan the
// existing log to find today's largest NNNN and start the in-process
// counter from there + 1. Sequential calls increment in memory; the file
// itself is read once per day boundary, not per call.

// Per OBSERVED-FAILURES.md "Phase 5 (CLI) residual gaps" entry that was
// resolved in v0.1.2: the schema is validated at read time so a hand-
// edited or older `edits.jsonl` line cannot crash `meta-edit summary`
// or `meta-edit log` via a missing / non-string field.
export const EditLogEntrySchema = z.object({
  edit_id: z.string(),
  timestamp: z.string(),
  tool_name: z.string(),
  target_file: z.string(),
  rationale: z.string(),
  risk_level: RiskLevelSchema,
  test_files: z.array(z.string()),
  patch_size_bytes: z.number(),
  applied: z.boolean(),
  warnings: z.array(z.string()),
});

export type EditLogEntry = z.infer<typeof EditLogEntrySchema>;

// 4-digit minimum padding, but the counter is allowed to grow past 9999
// in a single day (e.g. `edit_20260430_10000`). The regex matches 4 or
// more digits so recovery works correctly across days that exceeded the
// padding width.
const EDIT_ID_RE = /^edit_(\d{8})_(\d{4,})$/;

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
    // Issue a6-03: two EditLog instances against the same on-disk log
    // previously collided on edit_id because each seeded its in-memory
    // counter from disk only on the first call for a day, then both
    // incremented independently in memory.
    //
    // Fix: re-scan the on-disk log on every nextEditId call and use
    // max(in-memory counter, on-disk max) as the basis for the next id.
    // This is O(N) in log size per call but the call frequency is bound
    // by the rate of edit_* tool invocations, which is human-paced;
    // O(N) per call is acceptable for the MVP scale (SPEC §11 allows
    // multi-process file-locking solutions to be deferred).
    //
    // Why max() of both counters: the in-memory counter handles
    // sequential calls *without* an intervening append (the existing
    // "increments sequentially within the same day" test exercises
    // this: three nextEditId calls back-to-back must return 1, 2, 3).
    // The on-disk scan handles concurrent instances where another
    // instance has appended between our calls.
    const key = formatDayKey(now);
    if (this.todayKey !== key) {
      this.todayKey = key;
      this.todayCounter = 0;
    }
    const onDisk = this.scanMaxCounterForKey(key);
    const base = Math.max(this.todayCounter, onDisk);
    this.todayCounter = base + 1;
    const nnnn = String(this.todayCounter).padStart(4, "0");
    return `edit_${key}_${nnnn}`;
  }

  append(entry: EditLogEntry): void {
    // Refuse to write through any symlink in the edit-log path. The log
    // is the audit record; if `.meta-edit/state` (or `edits.jsonl`
    // itself) has been replaced with a symlink that points outside the
    // repo, an attacker can either silently exfiltrate edit metadata or
    // make the tool overwrite an unrelated file. We guard each ancestor
    // explicitly with lstat (symlink-aware) before mkdir, and use
    // O_NOFOLLOW on the final open so the leaf swap is also caught.
    ensureNoSymlinkOnPath(this.statePath);
    // Issue a6-04: the audit-log directory must not be world-readable.
    // mkdirSync without an explicit mode uses 0o777 & ~umask (typically
    // 0o755). Pass mode: 0o700 so newly created ancestors are restricted
    // to the owner. Then chmodSync explicitly to defend against:
    //   1. umask narrowing the requested mode further than intended, and
    //   2. existing wide-mode .meta-edit/state directories created by
    //      a pre-fix version of the tool (we narrow on every append).
    fs.mkdirSync(this.statePath, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(this.statePath, 0o700);
        // Also narrow the .meta-edit parent that recursive mkdir may
        // have just created; harmless if the user already created it.
        const parent = path.dirname(this.statePath);
        try {
          fs.chmodSync(parent, 0o700);
        } catch {
          /* ignore — parent may be owned by another user / pre-existing */
        }
      } catch {
        /* ignore — fs may reject chmod on certain platforms */
      }
    }
    // Re-check: mkdirSync of an intermediate that was created during
    // this call may have followed a parent symlink we didn't see. Walk
    // again from the top and reject if any segment is now a symlink.
    ensureNoSymlinkOnPath(this.statePath);

    const line = JSON.stringify(entry) + "\n";
    const O_NOFOLLOW = fs.constants.O_NOFOLLOW;
    if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
      throw new Error(
        "this platform does not expose O_NOFOLLOW; meta-edit refuses to append to the edit log without symlink-leaf protection",
      );
    }
    let fd: number | null = null;
    try {
      fd = fs.openSync(
        this.logPath,
        // eslint-disable-next-line no-bitwise
        fs.constants.O_WRONLY |
          fs.constants.O_APPEND |
          fs.constants.O_CREAT |
          O_NOFOLLOW,
        0o600,
      );
      fs.writeSync(fd, line, null, "utf8");
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // JSON-malformed lines are silently skipped (existing
        // behavior — never crash the reader).
        continue;
      }
      const validated = EditLogEntrySchema.safeParse(parsed);
      if (validated.success) {
        out.push(validated.data);
      }
      // Schema-malformed lines are silently skipped: every downstream
      // consumer (`meta-edit summary` / `meta-edit log`) assumes well-
      // typed entries, and crashing on a stray bad line would lose all
      // forensic value of the surrounding good lines.
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

function ensureNoSymlinkOnPath(maybeRelativeDir: string): void {
  // Walk from the topmost segment of the path down to the leaf and
  // reject if any existing component is a symlink. Non-existent
  // components are fine — they'll be created normally by mkdirSync.
  //
  // CRITICAL: resolve to an absolute path first. The caller passed
  // path.join(repoRoot, ".meta-edit", "state"), which can be relative
  // when repoRoot is relative. Splitting a relative path on path.sep
  // and re-joining from path.sep would walk `/repo/...` instead of
  // `<cwd>/repo/...`, missing a symlinked .meta-edit at the relative
  // location. path.resolve is purely lexical — it concatenates cwd +
  // segments and normalizes `..`, never calling lstat/realpath — so it
  // is safe to use here without re-introducing symlink-following.
  const absDir = path.resolve(maybeRelativeDir);
  const segments = absDir.split(path.sep).filter((s) => s.length > 0);
  let cur: string = path.sep;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(cur);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") return; // remaining ancestors don't exist; safe to create
      throw e;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `refusing to use edit-log path: "${cur}" is a symlink. The audit log must not be redirected through a symlink.`,
      );
    }
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

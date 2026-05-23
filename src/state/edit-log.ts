import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {
  EditTargetSchema,
  ExecutionStateSchema,
  ProvenanceSchema,
  RiskLevelSchema,
} from "../tools/common.js";

// Append-only JSON Lines log of every typed_edit declaration and its
// downstream consumption. Per docs/SPEC.md §6 (Case C, v0.2):
//
//   .meta-edit/state/edits.jsonl
//
// Records carry a `phase` discriminator with three values:
//
//   1. "issued"   -- written by the typed_edit MCP handler when a grant
//                   is successfully issued. Carries the full declaration
//                   payload (kind, target_file, rationale, risk_level,
//                   test_files, binding, token).
//   2. "consumed" -- written by the deny-raw-edit hook (PreToolUse) once
//                   a token's binding has been authorized for a native
//                   Edit/Write/MultiEdit call. The record is appended
//                   BEFORE the native write executes; the audit log
//                   captures hook authorization, not write success
//                   (write success is git's job). Carries
//                   (edit_id, ts, consuming_tool).
//   3. "rejected" -- written by the typed_edit MCP handler on validation
//                   failure. Carries (edit_id, ts, kind, target_file,
//                   audit_error).
//
// Audit consumers reconcile by edit_id: an "issued" record without a
// matching "consumed" sibling is evidence of an abandoned/expired grant.

// ---------------------------------------------------------------------
// Schema (zod) -- matches SPEC §6 verbatim. Forward-compat: each variant
// does NOT call .strict() so a future record can carry extra fields
// without breaking older readers.
// ---------------------------------------------------------------------

const BindingEntrySchema = z.object({
  file: z.string(),
  before_sha256: z.string(),
});
export type BindingEntry = z.infer<typeof BindingEntrySchema>;

// v0.6.0: provenance + audit_warnings are appended to the issued / rejected
// records. Read-time these fields are optional so the log is backward-
// compatible with v0.5.x entries (which lack them); write-time the
// typed_edit handler populates both. Legacy entries surface as
// `provenance: undefined` and aggregate into the "unspecified" bucket
// at `meta-edit summary` time.
const AuditWarningEntrySchema = z.object({
  code: z.enum([
    "kind_provenance_warn",
    "additional_files_warn",
    "citation_lint_missing",
    "execution_state_repeating_failure",
    "target_spec_derivation_warn",
  ]),
  message: z.string(),
});
export type AuditWarningEntry = z.infer<typeof AuditWarningEntrySchema>;

export const IssuedEntrySchema = z.object({
  edit_id: z.string(),
  ts: z.string(),
  phase: z.literal("issued"),
  kind: z.string(),
  target_file: z.string(),
  rationale: z.string(),
  risk_level: RiskLevelSchema,
  // v0.5.0: `target` is the prod/test surface flag declared by the agent
  // on every impl tool (15 SQLite-derived + edit_cosmetic). Optional in
  // the schema because the 5 workflow kinds never carry it. Persisting
  // it here is what makes audit analysis able to split a kind's edits
  // into prod vs test rather than collapsing them into one bucket.
  target: EditTargetSchema.optional(),
  // v0.6.0: provenance is required on new write-path entries (the typed_edit
  // handler always populates it). Optional on read so the log can still
  // consume v0.5.x entries that predate the field; meta-edit summary
  // surfaces those as the "unspecified" bucket.
  provenance: ProvenanceSchema.optional(),
  // design §4.5: optional on read so pre-0.7.0 entries still validate.
  execution_state: ExecutionStateSchema.optional(),
  // v0.6.0: soft-signal warnings from the validation matrices (warn cells,
  // citation lint). Optional on read.
  audit_warnings: z.array(AuditWarningEntrySchema).optional(),
  test_files: z.array(z.string()),
  binding: z.array(BindingEntrySchema).min(1),
  token: z.string(),
});
export type IssuedEntry = z.infer<typeof IssuedEntrySchema>;

export const ConsumedEntrySchema = z.object({
  edit_id: z.string(),
  ts: z.string(),
  phase: z.literal("consumed"),
  consuming_tool: z.string(),
});
export type ConsumedEntry = z.infer<typeof ConsumedEntrySchema>;

export const RejectedEntrySchema = z.object({
  edit_id: z.string(),
  ts: z.string(),
  phase: z.literal("rejected"),
  kind: z.string(),
  target_file: z.string(),
  // v0.5.0: optional for the same reason as IssuedEntry — when the
  // agent declared a target (even one whose validation just failed for
  // an unrelated reason), audit analysis benefits from seeing the
  // intent. Omitted when the agent never supplied the field (the
  // common cause of rejection-without-target is the new "target field
  // is required" validation itself).
  target: EditTargetSchema.optional(),
  // v0.6.0: same intent as IssuedEntry.provenance — when present, log the
  // declared epistemic source so audit can group rejections by
  // (kind, provenance) cell. Optional on read for backward compat.
  provenance: ProvenanceSchema.optional(),
  // design §4.5: optional on read so pre-0.7.0 entries still validate.
  execution_state: ExecutionStateSchema.optional(),
  // SPEC §6: rejected records carry a non-empty audit_error so audit
  // consumers always have an actionable reason. (Codex review: LOW,
  // in-scope under Article 3.)
  audit_error: z.string().min(1),
});
export type RejectedEntry = z.infer<typeof RejectedEntrySchema>;

export const EditLogEntrySchema = z.discriminatedUnion("phase", [
  IssuedEntrySchema,
  ConsumedEntrySchema,
  RejectedEntrySchema,
]);
export type EditLogEntry = z.infer<typeof EditLogEntrySchema>;

// 4-digit minimum padding, but the counter is allowed to grow past 9999
// in a single day. The regex matches 4+ digits so recovery works
// correctly across days that exceeded the padding width.
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

  // ---------------------------------------------------------------
  // Edit ID allocation (unchanged from v0.1.x -- see issue a6-03)
  // ---------------------------------------------------------------
  nextEditId(now: Date = new Date()): string {
    const key = formatDayKey(now);
    if (this.todayKey !== key) {
      this.todayKey = key;
      this.todayCounter = 0;
    }
    this.ensureStateDir();
    return this.withFileLock(() => {
      const onDiskLog = this.scanMaxCounterForKey(key);
      const onDiskCounter = this.readCounterFile(key);
      const base = Math.max(this.todayCounter, onDiskLog, onDiskCounter);
      this.todayCounter = base + 1;
      this.writeCounterFile(key, this.todayCounter);
      const nnnn = String(this.todayCounter).padStart(4, "0");
      return `edit_${key}_${nnnn}`;
    });
  }

  /**
   * Issue 0105-rejection-counter: synthesize an audit-only ID for
   * validation-rejected entries that does NOT advance the daily
   * `edit_<YYYYMMDD>_<NNNN>` counter. Format:
   *   reject_<YYYYMMDD>_<8-hex-random>
   *
   * Properties:
   *   - Sortable within a day by the timestamp prefix.
   *   - Non-sequential — anyone reconciling by edit_id can filter
   *     `^edit_` to get only successful issuances; the daily counter
   *     finally maps to "real edits issued".
   *   - No persistence: rejection IDs are purely log-record handles,
   *     so we don't write a counter file or contend with the issued
   *     counter's withFileLock path.
   */
  nextRejectId(now: Date = new Date()): string {
    const key = formatDayKey(now);
    const rand = crypto.randomBytes(4).toString("hex");
    return `reject_${key}_${rand}`;
  }

  // ---------------------------------------------------------------
  // Phase-specific append helpers. Each writes a single JSONL line
  // atomically using the shared O_NOFOLLOW + cross-process lock path.
  // ---------------------------------------------------------------

  appendIssued(entry: IssuedEntry): void {
    const validated = IssuedEntrySchema.parse(entry);
    this.appendRaw(validated);
  }

  appendConsumed(entry: ConsumedEntry): void {
    const validated = ConsumedEntrySchema.parse(entry);
    this.appendRaw(validated);
  }

  appendRejected(entry: RejectedEntry): void {
    const validated = RejectedEntrySchema.parse(entry);
    this.appendRaw(validated);
  }

  /**
   * Generic append. Discriminator-validated so callers cannot accidentally
   * write a record that won't round-trip through readAll().
   */
  append(entry: EditLogEntry): void {
    const validated = EditLogEntrySchema.parse(entry);
    this.appendRaw(validated);
  }

  private appendRaw(entry: EditLogEntry): void {
    // Refuse to write through any symlink in the edit-log path. The log
    // is the audit record; if .meta-edit/state (or edits.jsonl itself)
    // has been replaced with a symlink that points outside the repo, an
    // attacker can either silently exfiltrate edit metadata or make the
    // tool overwrite an unrelated file. We guard each ancestor
    // explicitly with lstat (symlink-aware) before mkdir, and use
    // O_NOFOLLOW on the final open so the leaf swap is also caught.
    this.ensureStateDir();
    ensureNoSymlinkOnPath(this.statePath);

    const line = JSON.stringify(entry) + "\n";
    const O_NOFOLLOW = fs.constants.O_NOFOLLOW;
    if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
      throw new Error(
        "this platform does not expose O_NOFOLLOW; meta-edit refuses to append to the edit log without symlink-leaf protection",
      );
    }
    this.withFileLock(() => {
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
    });
  }

  private ensureStateDir(): void {
    ensureNoSymlinkOnPath(this.statePath);
    fs.mkdirSync(this.statePath, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      fs.chmodSync(this.statePath, 0o700);
    }
  }

  private withFileLock<T>(fn: () => T): T {
    const lockPath = path.join(this.statePath, ".lock");
    const start = Date.now();
    const TIMEOUT_MS = 30_000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        fs.mkdirSync(lockPath);
        break;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw e;
        if (Date.now() - start > TIMEOUT_MS) {
          throw new Error(
            `meta-edit: timed out waiting for edit-log lock at ${lockPath}; ` +
              `if no other meta-edit process is running, remove this directory manually.`,
          );
        }
        const until = Date.now() + 2 + Math.floor(Math.random() * 3);
        while (Date.now() < until) {
          /* spin */
        }
      }
    }
    try {
      return fn();
    } finally {
      try {
        fs.rmdirSync(lockPath);
      } catch {
        /* ignore */
      }
    }
  }

  private readCounterFile(key: string): number {
    const counterPath = path.join(this.statePath, "counter.json");
    let text: string;
    try {
      text = fs.readFileSync(counterPath, "utf8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return 0;
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 0;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      key in (parsed as Record<string, unknown>)
    ) {
      const v = (parsed as Record<string, unknown>)[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        return Math.floor(v);
      }
    }
    return 0;
  }

  private writeCounterFile(key: string, value: number): void {
    const counterPath = path.join(this.statePath, "counter.json");
    const payload = JSON.stringify({ [key]: value });

    try {
      const lst = fs.lstatSync(counterPath);
      if (lst.isSymbolicLink()) {
        throw new Error(
          `refusing to use edit-log path: "${counterPath}" is a symlink. The audit-log counter must not be redirected through a symlink.`,
        );
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw e;
    }

    const O_NOFOLLOW = fs.constants.O_NOFOLLOW;
    if (typeof O_NOFOLLOW !== "number" || O_NOFOLLOW === 0) {
      throw new Error(
        "this platform does not expose O_NOFOLLOW; meta-edit refuses to write the audit-log counter without symlink-leaf protection",
      );
    }
    let fd: number | null = null;
    try {
      fd = fs.openSync(
        counterPath,
        // eslint-disable-next-line no-bitwise
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_TRUNC |
          O_NOFOLLOW,
        0o600,
      );
      fs.writeSync(fd, payload, null, "utf8");
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
    let text: string;
    try {
      text = fs.readFileSync(this.logPath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: EditLogEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const validated = EditLogEntrySchema.safeParse(parsed);
      if (validated.success) {
        out.push(validated.data);
      }
    }
    return out;
  }

  private scanMaxCounterForKey(key: string): number {
    let text: string;
    try {
      text = fs.readFileSync(this.logPath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw e;
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
      if (code === "ENOENT") return;
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

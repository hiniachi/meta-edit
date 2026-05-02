// Token-binding grants store (Case C / v0.2). Per docs/SPEC.md Article 5
// and §3, the MCP server does not write file content; it issues a single-
// use, time-bounded grant whose binding is a list of
// (file, before_sha256) tuples. The deny-raw-edit hook consumes those
// bindings as native Edit / Write / MultiEdit calls land.
//
// v0.2.1 thinning: `after_sha256` removed from GrantBinding. The post-
// condition simulate() check has been dropped from the hook (Article 3:
// non-adversarial threat model — friction without proportional value).
// before_sha256 is now computed by the server from disk at declaration
// time; the hook re-reads disk to detect staleness only.
//
// Storage: `<repoRoot>/.meta-edit/state/grants/<token_id>.json`. The
// state directory is a protected path (see protected-paths.ts). Each
// grant is one JSON file. Per-token read/modify/write is serialised
// in-process by a per-token async mutex so two consume() calls landing
// against the same workflow grant (Article 6: 1 declaration ≡ N files)
// cannot lose updates via interleaved read/write.
//
// Threat model (Article 3): non-adversarial. We do NOT HMAC-sign tokens,
// we do NOT defend against deep TOCTOU, we do NOT keep sibling-temps for
// atomic rename. Honest mistakes only. The single-use, short-TTL nature
// of the grant is the load-bearing primitive.
//
// ---------------------------------------------------------------------
// API: see `GrantsStore` interface below.
// ---------------------------------------------------------------------

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Grant time-to-live: 5 minutes — operational hygiene; single-use binding
 * is the actual integrity guarantee. Tokens are consumed exactly once per
 * binding, so the TTL is purely garbage-collection (keeps the grants/ dir
 * from accumulating abandoned files), not a defensive boundary. Agent
 * thinking time between typed_edit and the native Edit / Write call can
 * comfortably exceed 30 seconds — especially during multi-step reasoning
 * or when the user pauses — and a 10-minute window absorbs that without
 * weakening the model. (v0.2.1: extended from 30s; v0.3.1: 5 → 10 min
 * after dogfood report that medium-size edits expired mid-thought.)
 */
export const GRANT_TTL_MS = 600_000;

export type GrantBinding = {
  /** Absolute path (post-realpath) of the file this binding governs. */
  file: string;
  /** Lowercase hex sha256(64) of the disk content at declaration time. */
  before_sha256: string;
};

export type Grant = {
  /** Unique token id. Format: `met_<YYYYMMDD>_<10-hex>`. */
  token_id: string;
  /** Edit log id (`edit_<YYYYMMDD>_NNNN`) that produced this grant. */
  edit_id: string;
  /** ISO-8601 issue timestamp. */
  issued_at: string;
  /** ISO-8601 expiry — `issued_at + GRANT_TTL_MS`. */
  expires_at: string;
  /** 1+ binding tuples. SQLite-derived tools issue 1; workflow tools issue N. */
  binding: GrantBinding[];
  /**
   * Files (binding[].file) that have already been consumed by the
   * deny-raw-edit hook. The grant is "fully consumed" — and the file
   * unlinked — once `consumed_files.length === binding.length`.
   */
  consumed_files: string[];
};

export type ConsumeResult = {
  /** True iff this call consumed a binding for `file_path`. */
  consumed: boolean;
  /** True iff every binding for the grant is now consumed (file unlinked). */
  fully_consumed: boolean;
  /** Human-readable reason when `consumed` is false. */
  error?: string;
};

export type ActiveBindingMatch = {
  grant: Grant;
  binding: GrantBinding;
};

export interface GrantsStore {
  issue(args: {
    edit_id: string;
    binding: GrantBinding[];
  }): Promise<Grant>;

  lookup(token_id: string): Promise<Grant | null>;

  consume(token_id: string, file_path: string): Promise<ConsumeResult>;

  /**
   * Scan all on-disk grants and return the most-recently-issued unconsumed
   * binding that matches `canonicalFile`. Skips expired grants and bindings
   * already in `consumed_files`. Returns null if none match. (v0.2.2: Claude
   * Code's native Edit/Write/MultiEdit input schemas reject extra fields, so
   * the agent cannot surface a token to the hook; the hook resolves the
   * declaration server-side by file path instead.)
   */
  findActiveBindingForFile(canonicalFile: string): Promise<ActiveBindingMatch | null>;

  /** Best-effort housekeeping. Returns the number of grant files removed. */
  reapExpired(): Promise<number>;
}

// ---------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------

const TOKEN_ID_RE = /^met_\d{8}_[0-9a-f]{10}$/;

/** Format a Date as YYYYMMDD in the local timezone (matches edit-log). */
function formatDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Generate a token id `met_<YYYYMMDD>_<10-hex>`. */
function generateTokenId(now: Date = new Date()): string {
  const key = formatDayKey(now);
  const rand = crypto.randomBytes(5).toString("hex");
  return `met_${key}_${rand}`;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

/** Lightweight runtime validation of a parsed grant file. */
function isGrant(value: unknown): value is Grant {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.token_id !== "string" || !TOKEN_ID_RE.test(v.token_id)) {
    return false;
  }
  if (typeof v.edit_id !== "string") return false;
  if (typeof v.issued_at !== "string") return false;
  if (typeof v.expires_at !== "string") return false;
  if (!Array.isArray(v.binding) || v.binding.length === 0) return false;
  for (const b of v.binding as unknown[]) {
    if (typeof b !== "object" || b === null) return false;
    const bb = b as Record<string, unknown>;
    if (typeof bb.file !== "string" || bb.file.length === 0) return false;
    if (
      typeof bb.before_sha256 !== "string" ||
      !HEX64_RE.test(bb.before_sha256)
    ) {
      return false;
    }
  }
  if (!Array.isArray(v.consumed_files)) return false;
  for (const c of v.consumed_files as unknown[]) {
    if (typeof c !== "string") return false;
  }
  return true;
}

/**
 * Process-wide async mutex keyed by an arbitrary string. Each key gets
 * its own promise chain so two `consume()` calls against the same
 * (repoRoot, token_id) serialise their read/modify/write cycles, while
 * different keys proceed in parallel.
 *
 * The mutex is module-scoped (a single map shared across every
 * `createGrantsStore()` instance in the process) so two stores
 * constructed for the same repo do not race against each other — that
 * was the second-pass codex finding. Entries self-evict when their
 * tail promise settles so we don't leak memory across a long-running
 * server process.
 *
 * Per Article 3 (non-adversarial), in-process serialisation is
 * sufficient — the typical deployment has one MCP server issuing
 * tokens and one Claude Code instance consuming them. Cross-process
 * coordination would need a file lock; we deliberately avoid that
 * complexity per Article 7.
 */
const SHARED_MUTEX_TAILS = new Map<string, Promise<unknown>>();

async function withSharedLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = SHARED_MUTEX_TAILS.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Chain the next runner after the previous tail (regardless of
  // success/failure) so a thrown task does not poison the lane.
  const myTurn = prev.then(
    () => undefined,
    () => undefined,
  );
  const myTail = prev.then(() => next, () => next);
  SHARED_MUTEX_TAILS.set(key, myTail);
  try {
    await myTurn;
    return await fn();
  } finally {
    release();
    // Self-evict: if no one queued behind us, delete the entry. We
    // compare identity so we never clobber a newer queue.
    if (SHARED_MUTEX_TAILS.get(key) === myTail) {
      SHARED_MUTEX_TAILS.delete(key);
    }
  }
}

class GrantsStoreImpl implements GrantsStore {
  private readonly grantsDir: string;

  constructor(repoRoot: string) {
    this.grantsDir = path.join(repoRoot, ".meta-edit", "state", "grants");
  }

  /**
   * Mutex key for serialising consume() calls against the same grant file.
   * Keyed by the absolute grant file path so two GrantsStoreImpl instances
   * targeting the same repo share the lane. (Codex review pass 2: HIGH.)
   */
  private mutexKey(token_id: string): string {
    return path.resolve(this.grantPath(token_id));
  }

  private async ensureDir(): Promise<void> {
    // mkdir recursive is idempotent; mode 0o700 confines metadata to the
    // owner. Existing dirs are left at whatever mode they already have
    // (mkdir does not chmod). The audit guarantee for state/ broadly is
    // already enforced by EditLog; here we just ensure grants/ exists.
    await fs.mkdir(this.grantsDir, { recursive: true, mode: 0o700 });
  }

  private grantPath(token_id: string): string {
    return path.join(this.grantsDir, `${token_id}.json`);
  }

  async issue(args: {
    edit_id: string;
    binding: GrantBinding[];
  }): Promise<Grant> {
    if (args.binding.length === 0) {
      throw new Error("grants.issue: binding must contain at least one entry");
    }
    // Issue-time invariants: each binding MUST be well-formed and the
    // file paths within a single grant MUST be unique. Duplicate file
    // paths in `binding` would make the grant impossible to fully
    // consume (consumed_files tracks per-file, not per-binding), which
    // is an honest workflow-tool failure mode the SPEC §3 path-safety
    // checks should also catch upstream — but we enforce here too so
    // a buggy caller cannot persist an unconsumable grant. (Codex
    // review: HIGH/MEDIUM, in-scope under Article 3.)
    const seenFiles = new Set<string>();
    for (const b of args.binding) {
      if (typeof b.file !== "string" || b.file.length === 0) {
        throw new Error("grants.issue: binding[].file must be a non-empty string");
      }
      if (seenFiles.has(b.file)) {
        throw new Error(
          `grants.issue: duplicate binding file "${b.file}" — each grant must bind each file at most once`,
        );
      }
      seenFiles.add(b.file);
      if (!HEX64_RE.test(b.before_sha256)) {
        throw new Error(
          `grants.issue: binding[].before_sha256 must be 64 lowercase hex chars (file=${b.file})`,
        );
      }
    }
    await this.ensureDir();

    // v0.2.1: lazy cleanup — before issuing a fresh grant, reap any
    // expired siblings so the grants/ directory does not accumulate
    // indefinitely under the new 5-minute TTL. Best-effort: an exception
    // here is logged via the throw chain but does not block the new
    // issuance, since stale files do not impact correctness.
    try {
      await this.reapExpired();
    } catch {
      // swallow — reaper is hygiene, not correctness
    }

    // Token id collision is astronomically unlikely (40-bit random per
    // day), but we still loop a small number of times if O_EXCL fires.
    // The wx mode below means we never silently overwrite an existing
    // grant file.
    const now = new Date();
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + GRANT_TTL_MS).toISOString();

    const MAX_RETRIES = 8;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const token_id = generateTokenId(now);
      const grant: Grant = {
        token_id,
        edit_id: args.edit_id,
        issued_at: issuedAt,
        expires_at: expiresAt,
        binding: args.binding,
        consumed_files: [],
      };
      const filePath = this.grantPath(token_id);
      try {
        // wx fails if the file already exists — guards against id collision.
        await fs.writeFile(filePath, JSON.stringify(grant), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        return grant;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    throw new Error(
      `grants.issue: exhausted token id retries (last error: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      })`,
    );
  }

  async lookup(token_id: string): Promise<Grant | null> {
    if (typeof token_id !== "string" || !TOKEN_ID_RE.test(token_id)) {
      return null;
    }
    const filePath = this.grantPath(token_id);
    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!isGrant(parsed)) return null;

    // Treat expired grants as absent — callers don't need to distinguish.
    if (Date.parse(parsed.expires_at) <= Date.now()) {
      return null;
    }
    return parsed;
  }

  async consume(token_id: string, file_path: string): Promise<ConsumeResult> {
    if (typeof token_id !== "string" || !TOKEN_ID_RE.test(token_id)) {
      return { consumed: false, fully_consumed: false, error: "invalid token id" };
    }
    // Process-wide mutex keyed on the absolute grant file path: two
    // consume() calls landing against the same workflow grant cannot
    // lose updates, even if they come from different GrantsStoreImpl
    // instances. Different tokens proceed in parallel. (Codex review:
    // HIGH, in-scope under Article 3.)
    return withSharedLock(this.mutexKey(token_id), () =>
      this.consumeLocked(token_id, file_path),
    );
  }

  private async consumeLocked(
    token_id: string,
    file_path: string,
  ): Promise<ConsumeResult> {
    const filePath = this.grantPath(token_id);
    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          consumed: false,
          fully_consumed: false,
          error: "token not found",
        };
      }
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        consumed: false,
        fully_consumed: false,
        error: "grant file is corrupt",
      };
    }
    if (!isGrant(parsed)) {
      return {
        consumed: false,
        fully_consumed: false,
        error: "grant file is malformed",
      };
    }

    if (Date.parse(parsed.expires_at) <= Date.now()) {
      // Expired grants leave their file behind for reapExpired() to
      // clean up; we don't unlink here because that would surprise
      // concurrent consumers / loggers reading the same path.
      return { consumed: false, fully_consumed: false, error: "token expired" };
    }

    const matchIdx = parsed.binding.findIndex((b) => b.file === file_path);
    if (matchIdx === -1) {
      return {
        consumed: false,
        fully_consumed: false,
        error: "file_path not bound by this token",
      };
    }
    if (parsed.consumed_files.includes(file_path)) {
      return {
        consumed: false,
        fully_consumed: false,
        error: "binding already consumed",
      };
    }

    parsed.consumed_files = [...parsed.consumed_files, file_path];
    const fullyConsumed = parsed.consumed_files.length === parsed.binding.length;

    if (fullyConsumed) {
      // Single-use complete: unlink the grant file. ENOENT is benign
      // (a concurrent consumer beat us to it — but the mutex prevents
      // that within this process).
      try {
        await fs.unlink(filePath);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    } else {
      // Persist updated consumed_files list. Plain writeFile (no rename
      // dance) per Article 3 — non-adversarial threat model. wx is not
      // used here because the file legitimately exists.
      await fs.writeFile(filePath, JSON.stringify(parsed), {
        encoding: "utf8",
        mode: 0o600,
      });
    }

    return { consumed: true, fully_consumed: fullyConsumed };
  }

  async findActiveBindingForFile(
    canonicalFile: string,
  ): Promise<ActiveBindingMatch | null> {
    if (typeof canonicalFile !== "string" || canonicalFile.length === 0) {
      return null;
    }
    let names: string[];
    try {
      names = await fs.readdir(this.grantsDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const now = Date.now();
    let best: ActiveBindingMatch | null = null;
    let bestIssuedMs = -Infinity;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const filePath = path.join(this.grantsDir, name);
      let text: string;
      try {
        text = await fs.readFile(filePath, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        // Best-effort: skip unreadable entries — a grant we cannot read
        // cannot authorize a write either.
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (!isGrant(parsed)) continue;
      // Skip expired grants — same TTL semantics as lookup().
      if (Date.parse(parsed.expires_at) <= now) continue;
      // Skip if this file is already consumed in this grant.
      if (parsed.consumed_files.includes(canonicalFile)) continue;
      // Find a matching unconsumed binding entry.
      const binding = parsed.binding.find((b) => b.file === canonicalFile);
      if (!binding) continue;

      // LIFO: prefer the most-recently-issued grant (agent's freshest
      // intent). Date.parse can return NaN for malformed input; isGrant
      // already guarantees issued_at is a string but does not validate
      // ISO format, so guard against NaN by treating it as "very old".
      const issuedMs = Date.parse(parsed.issued_at);
      const issuedScore = Number.isFinite(issuedMs) ? issuedMs : -Infinity;
      if (issuedScore > bestIssuedMs) {
        bestIssuedMs = issuedScore;
        best = { grant: parsed, binding };
      }
    }
    return best;
  }

  async reapExpired(): Promise<number> {
    let names: string[];
    try {
      names = await fs.readdir(this.grantsDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw e;
    }
    let removed = 0;
    const now = Date.now();
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const filePath = path.join(this.grantsDir, name);
      let text: string;
      try {
        text = await fs.readFile(filePath, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        // Best-effort: skip unreadable entries rather than aborting the
        // whole reap pass.
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Corrupt grant file — leave it alone. Reaper is not a janitor
        // for arbitrary garbage.
        continue;
      }
      if (!isGrant(parsed)) continue;
      if (Date.parse(parsed.expires_at) > now) continue;

      try {
        await fs.unlink(filePath);
        removed++;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        // Other errors (EACCES, EBUSY, …) — best-effort skip.
      }
    }
    return removed;
  }
}

export function createGrantsStore(repoRoot: string): GrantsStore {
  return new GrantsStoreImpl(repoRoot);
}

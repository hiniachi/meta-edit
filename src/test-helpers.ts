import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sha256Hex } from "./tools/common.js";
import type {
  IssuedEntry,
  ConsumedEntry,
  RejectedEntry,
} from "./state/edit-log.js";

// =====================================================================
// Temp directory lifecycle
// =====================================================================

export function makeTmpRoot(suffix = "test"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `meta-edit-${suffix}-`));
}

export function makeTmpRepo(suffix = "repo"): string {
  const root = makeTmpRoot(suffix);
  fs.mkdirSync(path.join(root, ".git"));
  return root;
}

export function cleanTmpRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}


// =====================================================================
// File helpers (standalone, for tests that manage their own lifecycle)
// =====================================================================

export function writeFileIn(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

// =====================================================================
// Hash helpers — delegates to production sha256Hex to prevent drift
// =====================================================================

export { sha256Hex } from "./tools/common.js";

// =====================================================================
// Constants
// =====================================================================

export const HEX64_A = "a".repeat(64);
export const HEX64_C = "c".repeat(64);

// =====================================================================
// Edit-log entry factories
// =====================================================================

export function issued(overrides: Partial<IssuedEntry> = {}): IssuedEntry {
  return {
    edit_id: "edit_20260430_0001",
    ts: "2026-04-30T10:00:00+09:00",
    phase: "issued",
    kind: "edit_boundary_condition",
    target_file: "src/foo.ts",
    rationale: "test",
    risk_level: "medium",
    // v0.5.0: impl-tool fixtures default to target: "prod" so existing
    // tests exercise the realistic shape (validateRequest requires
    // `target` on every impl tool). Workflow-kind fixtures must
    // override with `target: undefined` since workflow kinds have no
    // target field.
    target: "prod",
    // v0.6.0: provenance is required on every typed_edit declaration.
    // direct_observation is the typical fixture provenance (the test
    // is asserting on bytes/structure the agent observed) and lands in
    // every kind × provenance cell without warnings or rejects.
    provenance: "direct_observation",
    test_files: ["tests/foo.test.ts"],
    binding: [{ file: "src/foo.ts", before_sha256: HEX64_A }],
    token: "met_20260430_0123456789",
    ...overrides,
  };
}

export function consumed(overrides: Partial<ConsumedEntry> = {}): ConsumedEntry {
  return {
    edit_id: "edit_20260430_0001",
    ts: "2026-04-30T10:00:11+09:00",
    phase: "consumed",
    consuming_tool: "Edit",
    ...overrides,
  };
}

export function rejected(overrides: Partial<RejectedEntry> = {}): RejectedEntry {
  return {
    edit_id: "edit_20260430_0002",
    ts: "2026-04-30T10:01:00+09:00",
    phase: "rejected",
    kind: "edit_boundary_condition",
    target_file: "src/foo.ts",
    audit_error: "test_files must be non-empty",
    ...overrides,
  };
}

// =====================================================================
// Stream capture helpers
// =====================================================================

export function captureStdout(fn: () => unknown): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (
    chunk: string | Uint8Array,
  ) => {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    return true;
  };
  try {
    fn();
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
  return chunks.join("");
}

export function captureStderr(fn: () => unknown): string {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (
    chunk: string | Uint8Array,
  ) => {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    return true;
  };
  try {
    fn();
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
  }
  return chunks.join("");
}

export async function captureStderrAsync(
  fn: () => Promise<void>,
): Promise<string> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (
    chunk: string | Uint8Array,
  ) => {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    return true;
  };
  try {
    await fn();
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
  }
  return chunks.join("");
}

// =====================================================================
// WritableStream mock for CLI tests
// =====================================================================

export class StringStream {
  text = "";
  write(chunk: string | Uint8Array): boolean {
    this.text +=
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }
}

export function asWritableStream(s: StringStream): NodeJS.WritableStream {
  return s as unknown as NodeJS.WritableStream;
}

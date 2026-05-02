export type State = 'idle' | 'running' | 'done';

export function next(state: State, event: string): State {
  if (state === 'idle' && event === 'start') return 'running';
  if (state === 'running' && event === 'finish') return 'done';
  if (state === 'done' && event === 'reset') return 'idle';
  throw new Error(`invalid transition: ${state} on ${event}`);
}

export const SCHEMA_SQL = `CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;

export function backfill(
  rows: Array<{ id: number; name: string | null }>,
): Array<{ id: number; name: string }> {
  return rows.map((r) => {
    const trimmed = r.name?.trim();
    const finalName = trimmed && trimmed.length > 0 ? trimmed : `item-${r.id}`;
    return { id: r.id, name: finalName };
  });
}

export interface ApiResponse {
  id: string;
  status: string;
  code?: number;
}

export function encode(o: { a: number; b: number }): string {
  return `v2:${o.a}:${o.b}`;
}

export function decode(s: string): { a: number; b: number } {
  if (s.startsWith('v2:')) {
    const parts = s.slice(3).split(':');
    if (parts.length !== 2) {
      throw new Error(`malformed v2 payload: ${s}`);
    }
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error(`malformed v2 payload: ${s}`);
    }
    return { a, b };
  }
  if (s.includes('|')) {
    const parts = s.split('|');
    if (parts.length !== 2) {
      throw new Error(`malformed v1 payload: ${s}`);
    }
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error(`malformed v1 payload: ${s}`);
    }
    return { a, b };
  }
  throw new Error(`unrecognized payload format: ${s}`);
}

export function safeDiv(a: number, b: number): number {
  if (b === 0) {
    throw new Error(`safeDiv: division by zero (a=${a})`);
  }
  return a / b;
}

export interface RetryOptions {
  maxAttempts: number;
  timeoutMs: number;
  idempotencyKey?: string;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function callWithRetry(
  url: string,
  opts: RetryOptions = { maxAttempts: 3, timeoutMs: 1000 },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
      const res = await fetchImpl(url, { signal: ac.signal, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `callWithRetry: exhausted ${opts.maxAttempts} attempt(s); last error: ${String(lastError)}`,
  );
}

export async function callOnce(url: string): Promise<string> {
  return callWithRetry(url, { maxAttempts: 1, timeoutMs: 5000 });
}

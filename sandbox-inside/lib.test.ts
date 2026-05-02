import { test, expect } from 'bun:test';
import { next, encode, decode, safeDiv, backfill, SCHEMA_SQL, callWithRetry } from './lib';
import type { ApiResponse } from './lib';

test('initial state machine — idle→running on start', () => {
  expect(next('idle', 'start')).toBe('running');
});

test('allowed transition: done→idle on reset', () => {
  expect(next('done', 'reset')).toBe('idle');
});

test('forbidden: reset from running throws (no partial state change)', () => {
  expect(() => next('running', 'reset')).toThrow(/invalid transition/);
});

test('invalid input: unknown event from idle throws', () => {
  expect(() => next('idle', 'unknown')).toThrow(/invalid transition/);
});

test('schema DDL contains created_at TIMESTAMP NOT NULL with default', () => {
  expect(SCHEMA_SQL).toMatch(/created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP/);
});

test('schema is forward-compatible: existing rows get default value (DDL has DEFAULT clause)', () => {
  expect(SCHEMA_SQL).toMatch(/DEFAULT CURRENT_TIMESTAMP/);
});

test('ApiResponse backward-compat: legacy shape (no code) still valid', () => {
  const legacy: ApiResponse = { id: 'x', status: 'ok' };
  expect(legacy.code).toBeUndefined();
  expect(legacy.id).toBe('x');
  expect(legacy.status).toBe('ok');
});

test('ApiResponse with new optional code field', () => {
  const updated: ApiResponse = { id: 'y', status: 'ok', code: 42 };
  expect(updated.code).toBe(42);
});

test('codec round-trip (v2 path)', () => {
  expect(decode(encode({ a: 1, b: 2 }))).toEqual({ a: 1, b: 2 });
});

test('encode now emits v2 prefix', () => {
  expect(encode({ a: 3, b: 4 })).toBe('v2:3:4');
});

test('decode reads legacy v1 (pipe) format', () => {
  expect(decode('5|6')).toEqual({ a: 5, b: 6 });
});

test('decode rejects malformed v2 payload', () => {
  expect(() => decode('v2:abc:def')).toThrow(/malformed v2 payload/);
});

test('decode rejects unrecognized format', () => {
  expect(() => decode('garbage')).toThrow(/unrecognized payload format/);
});

test('backfill defaults nulls', () => {
  expect(backfill([{ id: 1, name: null }])).toEqual([{ id: 1, name: 'item-1' }]);
});

test('backfill defaults whitespace-only and empty strings', () => {
  expect(backfill([{ id: 2, name: '   ' }, { id: 3, name: '' }])).toEqual([
    { id: 2, name: 'item-2' },
    { id: 3, name: 'item-3' },
  ]);
});

test('backfill is idempotent: applying twice equals applying once', () => {
  const rows = [{ id: 1, name: null }, { id: 2, name: '  alpha  ' }, { id: 3, name: '' }];
  const once = backfill(rows);
  const twice = backfill(once);
  expect(twice).toEqual(once);
});

test('backfill trims surrounding whitespace from valid names', () => {
  expect(backfill([{ id: 7, name: '  beta  ' }])).toEqual([{ id: 7, name: 'beta' }]);
});

test('safeDiv ordinary case', () => {
  expect(safeDiv(6, 2)).toBe(3);
});

test('safeDiv: failure path on b=0 throws observable error with context', () => {
  expect(() => safeDiv(5, 0)).toThrow(/division by zero/);
  expect(() => safeDiv(5, 0)).toThrow(/a=5/);
});

test('safeDiv: success path unchanged after error-handling change', () => {
  expect(safeDiv(10, 4)).toBe(2.5);
});

test('callWithRetry: success on first attempt', async () => {
  const mock = (async () => ({ ok: true, status: 200, text: async () => 'first' })) as any;
  expect(await callWithRetry('https://x', { maxAttempts: 3, timeoutMs: 100 }, mock)).toBe('first');
});

test('callWithRetry: retry exhaustion throws after maxAttempts and reports last error', async () => {
  let calls = 0;
  const mock = (async () => { calls++; throw new Error('boom'); }) as any;
  await expect(
    callWithRetry('https://x', { maxAttempts: 3, timeoutMs: 100 }, mock),
  ).rejects.toThrow(/exhausted 3 attempt/);
  expect(calls).toBe(3);
});

test('callWithRetry: success on retry after early failures', async () => {
  let calls = 0;
  const mock = (async () => {
    calls++;
    if (calls < 3) throw new Error('flaky');
    return { ok: true, status: 200, text: async () => 'finally ok' };
  }) as any;
  expect(await callWithRetry('https://x', { maxAttempts: 5, timeoutMs: 100 }, mock)).toBe('finally ok');
  expect(calls).toBe(3);
});

test('callWithRetry: idempotency-key header sent on every attempt (no duplicate side-effect risk)', async () => {
  const seenKeys: Array<string | undefined> = [];
  let calls = 0;
  const mock = (async (_url: string, init?: { headers?: Record<string, string> }) => {
    calls++;
    seenKeys.push(init?.headers?.['Idempotency-Key']);
    if (calls < 2) throw new Error('flaky');
    return { ok: true, status: 200, text: async () => 'ok' };
  }) as any;
  await callWithRetry('https://x', { maxAttempts: 3, timeoutMs: 100, idempotencyKey: 'abc-123' }, mock);
  expect(seenKeys).toEqual(['abc-123', 'abc-123']);
});

test('callWithRetry: timeout aborts attempt and ultimately exhausts retries', async () => {
  const mock = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
    })) as any;
  await expect(
    callWithRetry('https://x', { maxAttempts: 2, timeoutMs: 30 }, mock),
  ).rejects.toThrow(/exhausted 2 attempt/);
});

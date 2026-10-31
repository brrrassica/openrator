/**
 * OpenRator — pure rollup logic (unit-testable; no RN/DB imports).
 * feed rows from /activity into endpoint_activity, then compute daily
 * rollups idempotently and build zero-filled spend series for charts.
 *
 * M7: rows carry an optional provider dimension. Legacy callers that omit it
 * behave exactly as v0.1 (one logical provider).
 */

import { ActivityRecord, ActivityRow, DailyRollup } from '../core/types';
import { ACTIVITY_WINDOW_DAYS } from '../core/config';

const DEFAULT_PROVIDER = 'openrouter';

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Normalize a provisional ActivityRecord into a stored row (or null).
 * Accepts both camelCase (reference impl) and the API's snake_case fields.
 * The provider field is omitted for legacy callers, preserving v0.1 shape. */
export function toActivityRow(
  rec: ActivityRecord,
  provider?: string,
): ActivityRow | null {
  if (!rec.date || !isDay(rec.date)) return null;
  const endpoint = rec.endpoint && rec.endpoint.length ? rec.endpoint : 'unknown';
  const pick = (camel: string, snake: string): unknown => rec[camel] ?? rec[snake];
  const row: ActivityRow = {
    day: rec.date,
    endpoint,
    apiKeyHash: String(rec.apiKeyHash ?? ''),
    requests: Math.max(0, Math.round(Number(pick('requests', 'requests') ?? 0))),
    spendUsd: Math.max(0, Number(pick('spendUsd', 'spend_usd') ?? 0)),
    tokens: Math.max(0, Math.round(Number(pick('tokens', 'tokens') ?? 0))),
  };
  if (provider) row.provider = provider;
  return row;
}

const rowKey = (r: ActivityRow): string =>
  `${r.provider ?? DEFAULT_PROVIDER}\u0001${r.day}\u0001${r.endpoint}\u0001${r.apiKeyHash}`;

/**
 * Idempotent merge: incoming rows replace existing ones with the same PK
 * (provider, day, endpoint, apiKeyHash); otherwise appended.
 */
export function mergeActivityRows(
  existing: ActivityRow[],
  incoming: ActivityRow[],
): ActivityRow[] {
  const map = new Map<string, ActivityRow>();
  for (const r of existing) map.set(rowKey(r), r);
  for (const r of incoming) map.set(rowKey(r), r);
  return Array.from(map.values());
}

/** Aggregate rows by (provider, day); byEndpoint keyed by endpoint. */
export function computeDailyRollups(rows: ActivityRow[]): DailyRollup[] {
  const byDay = new Map<string, DailyRollup>();
  for (const r of rows) {
    const provider = r.provider ?? DEFAULT_PROVIDER;
    const key = `${provider}\u0001${r.day}`;
    const rl = byDay.get(key) ?? {
      provider,
      day: r.day,
      spendUsd: 0,
      requests: 0,
      tokens: 0,
      byEndpoint: {},
    };
    rl.spendUsd += r.spendUsd;
    rl.requests += r.requests;
    rl.tokens += r.tokens;
    const e = rl.byEndpoint[r.endpoint] ?? { requests: 0, spendUsd: 0, tokens: 0 };
    e.requests += r.requests;
    e.spendUsd += r.spendUsd;
    e.tokens += r.tokens;
    rl.byEndpoint[r.endpoint] = e;
    byDay.set(key, rl);
  }
  return Array.from(byDay.values()).sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    return (a.provider ?? '') < (b.provider ?? '') ? -1 : 1;
  });
}

/** UTC helpers — all day math in YYYY-MM-DD to stay TZ-independent. */
export function fmtDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmtDay(dt);
}

/** Zero-filled series of `days` entries ending at `endDay` (inclusive). */
export function buildSpendSeries(
  endDay: string,
  days: number = ACTIVITY_WINDOW_DAYS,
  rollups: DailyRollup[] = [],
): Array<{ day: string; spendUsd: number; requests: number }> {
  // Aggregate across providers so the "All providers" view sums them.
  const byDay = new Map<string, { spendUsd: number; requests: number }>();
  for (const r of rollups) {
    const cur = byDay.get(r.day) ?? { spendUsd: 0, requests: 0 };
    cur.spendUsd += r.spendUsd;
    cur.requests += r.requests;
    byDay.set(r.day, cur);
  }
  const out: Array<{ day: string; spendUsd: number; requests: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(endDay, -i);
    const rl = byDay.get(day);
    out.push({ day, spendUsd: rl?.spendUsd ?? 0, requests: rl?.requests ?? 0 });
  }
  return out;
}

/** Top endpoints by spend within the given rollups (for rank lists). */
export function topEndpoints(
  rollups: DailyRollup[],
  n: number = 10,
): Array<{ endpoint: string; spendUsd: number; requests: number; tokens: number }> {
  const agg = new Map<string, { spendUsd: number; requests: number; tokens: number }>();
  for (const rl of rollups) {
    for (const [endpoint, e] of Object.entries(rl.byEndpoint)) {
      const cur = agg.get(endpoint) ?? { spendUsd: 0, requests: 0, tokens: 0 };
      cur.spendUsd += e.spendUsd;
      cur.requests += e.requests;
      cur.tokens += e.tokens;
      agg.set(endpoint, cur);
    }
  }
  return Array.from(agg.entries())
    .map(([endpoint, v]) => ({ endpoint, ...v }))
    .sort((a, b) => b.spendUsd - a.spendUsd)
    .slice(0, n);
}

/**
 * OpenRator — pure multi-provider aggregate helpers (M7.8).
 * Deterministic math for the "All providers" scope; no RN/DB imports.
 */

import { ActivityRow, KeyRow } from '../core/types';

/**
 * Dedupe by (provider, day, endpoint, apiKeyHash). Incoming rows win, which
 * mirrors the SQLite primary key introduced in migration v4.
 */
export function dedupeUsageRows(rows: ActivityRow[]): ActivityRow[] {
  const map = new Map<string, ActivityRow>();
  for (const r of rows) {
    const key = `${r.provider ?? 'openrouter'}\u0001${r.day}\u0001${r.endpoint}\u0001${r.apiKeyHash}`;
    map.set(key, r);
  }
  return Array.from(map.values());
}

/** Sum account credits across providers (manual/unknown values stay 0). */
export function sumCredits(
  entries: Array<{ total?: number; usage?: number }>,
): { total: number; usage: number; remaining: number } {
  const total = entries.reduce((s, e) => s + (Number(e.total) || 0), 0);
  const usage = entries.reduce((s, e) => s + (Number(e.usage) || 0), 0);
  return { total, usage, remaining: total - usage };
}

/**
 * Combine per-provider key rows for the aggregate card. Limits and usage sum;
 * the label is explicit and mixed reset windows collapse to null.
 */
export function combineKeyRows(rows: KeyRow[], label = 'All providers'): KeyRow | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  const reset = rows.every((r) => r.limitReset === rows[0].limitReset)
    ? rows[0].limitReset
    : null;
  const expires = rows
    .map((r) => r.expiresAt)
    .filter((x): x is string => Boolean(x))
    .sort()[0] ?? null;
  return {
    provider: 'all',
    hash: 'aggregate',
    label,
    isManagement: rows.some((r) => r.isManagement) ? 1 : 0,
    limit: rows.reduce((s, r) => s + r.limit, 0),
    limitRemaining: rows.reduce((s, r) => s + r.limitRemaining, 0),
    limitReset: reset,
    usageMonthly: rows.reduce((s, r) => s + r.usageMonthly, 0),
    usageDaily: rows.reduce((s, r) => s + r.usageDaily, 0),
    usageWeekly: rows.reduce((s, r) => s + r.usageWeekly, 0),
    expiresAt: expires,
    updatedAt: new Date().toISOString(),
  };
}

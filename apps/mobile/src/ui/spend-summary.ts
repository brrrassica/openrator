/**
 * OpenRator — pure Spend & Endpoint analytics selectors (M3, spec §8.2).
 * No RN/DB imports → unit-testable. Activity rows are PROVISIONAL until a
 * management key mints the real /activity shape (M0.5A); this layer is
 * written defensively against that.
 */

import { ActivityRow, Provider } from '../core/types';
import { addDays, buildSpendSeries, computeDailyRollups } from '../sync/rollups';

/** "model-slug:provider-slug" (provisional) → provider part, tail after ':'. */
export function providerOf(endpoint: string): string {
  if (!endpoint) return endpoint;
  const i = endpoint.indexOf(':');
  if (i < 0) return endpoint;
  const tail = endpoint.slice(i + 1);
  return tail.length ? tail : endpoint;
}

export interface EndpointStat {
  endpoint: string;
  providerSlug: string;
  statusPageUrl: string | null;
  requests: number;
  spendUsd: number;
  tokens: number;
  sharePct: number;
  avgPerReq: number;
}

export interface ShareSlice {
  provider: string;
  spendUsd: number;
  sharePct: number;
}

/** Aggregate endpoint rows over the inclusive window ending today. */
export function aggregateEndpoints(
  rows: ActivityRow[],
  windowDays: number,
  today: string,
): EndpointStat[] {
  const from = addDays(today, -(windowDays - 1));
  const inWindow = rows.filter((r) => r.day >= from && r.day <= today);
  const agg = new Map<string, { requests: number; spendUsd: number; tokens: number }>();
  for (const r of inWindow) {
    const cur = agg.get(r.endpoint) ?? { requests: 0, spendUsd: 0, tokens: 0 };
    cur.requests += r.requests;
    cur.spendUsd += r.spendUsd;
    cur.tokens += r.tokens;
    agg.set(r.endpoint, cur);
  }
  const total = Array.from(agg.values()).reduce((s, v) => s + v.spendUsd, 0);
  return Array.from(agg.entries())
    .map(([endpoint, v]) => ({
      endpoint,
      providerSlug: providerOf(endpoint),
      statusPageUrl: null,
      requests: v.requests,
      spendUsd: v.spendUsd,
      tokens: v.tokens,
      sharePct: total > 0 ? (v.spendUsd / total) * 100 : 0,
      avgPerReq: v.requests > 0 ? v.spendUsd / v.requests : 0,
    }))
    .sort((a, b) => b.spendUsd - a.spendUsd);
}

/** Join provider status-page URLs onto endpoint stats (by slug). */
export function attachStatusPages(
  stats: EndpointStat[],
  providers: Provider[],
): EndpointStat[] {
  const bySlug = new Map(providers.map((p) => [p.slug, p.statusPageUrl]));
  return stats.map((s) => ({
    ...s,
    statusPageUrl: bySlug.get(s.providerSlug) ?? null,
  }));
}

/** Provider share of window spend, largest first. */
export function providerShare(
  rows: ActivityRow[],
  windowDays: number,
  today: string,
): ShareSlice[] {
  const from = addDays(today, -(windowDays - 1));
  const inWindow = rows.filter((r) => r.day >= from && r.day <= today);
  const agg = new Map<string, number>();
  let total = 0;
  for (const r of inWindow) {
    const p = providerOf(r.endpoint);
    agg.set(p, (agg.get(p) ?? 0) + r.spendUsd);
    total += r.spendUsd;
  }
  return Array.from(agg.entries())
    .map(([provider, spendUsd]) => ({
      provider,
      spendUsd,
      sharePct: total > 0 ? (spendUsd / total) * 100 : 0,
    }))
    .sort((a, b) => b.spendUsd - a.spendUsd);
}

export interface SpendSummary {
  hasActivity: boolean;
  totalSpend: number;
  totalRequests: number;
  totalTokens: number;
  trend: Array<{ day: string; spendUsd: number; requests: number }>;
  byDay: Array<{ day: string; spendUsd: number; requests: number }>;
  endpoints: EndpointStat[];
  share: ShareSlice[];
}

/** One-stop selector for the Spend tab (spec §8.2). */
export function computeSpendSummary(
  rows: ActivityRow[],
  providers: Provider[],
  today: string,
  windowDays: number = 30,
): SpendSummary {
  const rollups = computeDailyRollups(rows);
  const trend = buildSpendSeries(today, windowDays, rollups);
  const endpoints = attachStatusPages(aggregateEndpoints(rows, windowDays, today), providers);
  const share = providerShare(rows, windowDays, today);
  return {
    hasActivity: endpoints.length > 0,
    totalSpend: endpoints.reduce((s, e) => s + e.spendUsd, 0),
    totalRequests: endpoints.reduce((s, e) => s + e.requests, 0),
    totalTokens: endpoints.reduce((s, e) => s + e.tokens, 0),
    trend,
    byDay: trend.slice(-windowDays).reverse(),
    endpoints,
    share,
  };
}
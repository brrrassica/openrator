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
  /** Provider dimension when rows carry one (M7). */
  provider?: string;
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
  const agg = new Map<
    string,
    { endpoint: string; provider?: string; requests: number; spendUsd: number; tokens: number }
  >();
  for (const r of inWindow) {
    // Keep provider dimensions distinct in aggregate mode; legacy rows without
    // a provider preserve the v0.1 endpoint-only key.
    const key = r.provider ? `${r.provider}\u0001${r.endpoint}` : r.endpoint;
    const cur = agg.get(key) ?? {
      endpoint: r.endpoint,
      provider: r.provider,
      requests: 0,
      spendUsd: 0,
      tokens: 0,
    };
    cur.requests += r.requests;
    cur.spendUsd += r.spendUsd;
    cur.tokens += r.tokens;
    agg.set(key, cur);
  }
  const total = Array.from(agg.values()).reduce((s, v) => s + v.spendUsd, 0);
  return Array.from(agg.entries())
    .map(([, v]) => ({
      endpoint: v.endpoint,
      provider: v.provider,
      providerSlug: providerOf(v.endpoint),
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
  // With several provider dimensions, group by provider id (the aggregate
  // view). A single-provider scope keeps the v0.1 endpoint-tail breakdown.
  const distinctProviders = new Set(
    inWindow.map((r) => r.provider).filter((p): p is string => Boolean(p)),
  );
  const byProviderDimension = distinctProviders.size > 1;
  for (const r of inWindow) {
    const p = byProviderDimension
      ? r.provider ?? providerOf(r.endpoint)
      : providerOf(r.endpoint);
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
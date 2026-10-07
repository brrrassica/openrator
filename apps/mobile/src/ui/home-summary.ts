/**
 * OpenRator — pure Home Pane selector (M2). Maps SQLite rows + sync status
 * into what the UI renders. No RN imports → unit-testable.
 */

import { DailyRollup, KeyRow, Provider } from '../core/types';
import { addDays, buildSpendSeries, topEndpoints } from '../sync/rollups';

export interface Warning {
  kind: 'limit' | 'expiry' | 'spend-spike';
  message: string;
}

export interface TopRow {
  endpoint: string;
  spendUsd: number;
  requests: number;
}

export interface HomeSummary {
  /** OpenRouter account credits (GET /credits). */
  creditsTotal: number;
  creditsUsage: number;
  creditsRemaining: number;
  label: string;
  limit: number;
  limitRemaining: number;
  limitReset: string | null;
  usageDaily: number;
  usageMonthly: number;
  expiresAt: string | null;
  spendToday: number;
  spend7d: number;
  trend: number[]; // last 14 days USD
  top: TopRow[];
  warnings: Warning[];
  providers: Provider[];
  staleCredits: boolean;
}

export interface HomeInputs {
  key: KeyRow | null | undefined;
  rollups: DailyRollup[];
  providers: Provider[];
  /** ISO day string (YYYY-MM-DD) for "today". */
  today: string;
  staleCredits: boolean;
  /** activity analytics locked because no management key */
  activityLocked: boolean;
  /** OpenRouter account credits (GET /credits); undefined when never synced. */
  creditsTotal?: number;
  creditsUsage?: number;
}

const RESET_LABEL: Record<string, string> = {
  daily: 'resets daily',
  weekly: 'resets weekly',
  monthly: 'resets monthly',
};

export function computeHomeSummary(inputs: HomeInputs): HomeSummary {
  const { key, rollups, providers, today, staleCredits } = inputs;
  const creditsTotal = inputs.creditsTotal ?? 0;
  const creditsUsage = inputs.creditsUsage ?? 0;
  const creditsRemaining = creditsTotal - creditsUsage;

  const series = buildSpendSeries(today, 14, rollups);
  const trend = series.map((s) => s.spendUsd);
  const last7 = series.slice(-7);
  const spend7d = last7.reduce((s, x) => s + x.spendUsd, 0);
  const todayRollup = rollups.find((r) => r.day === today);
  const spendToday = todayRollup?.spendUsd ?? 0;

  const weekStart = addDays(today, -7);
  const weekRollups = rollups.filter((r) => r.day >= weekStart);
  const top: TopRow[] = topEndpoints(weekRollups, 6).map((t) => ({
    endpoint: t.endpoint,
    spendUsd: t.spendUsd,
    requests: t.requests,
  }));

  const warnings: Warning[] = [];
  if (key) {
    if (key.limit > 0 && key.limitRemaining / key.limit < 0.1) {
      warnings.push({ kind: 'limit', message: 'Key limit nearly exhausted (<10% remaining)' });
    }
    if (key.expiresAt) {
      const daysToExpiry = Math.ceil(
        (new Date(key.expiresAt).getTime() - Date.now()) / 86_400_000,
      );
      if (daysToExpiry <= 14) {
        warnings.push({
          kind: 'expiry',
          message: `Key expires ${daysToExpiry <= 0 ? 'today' : `in ${daysToExpiry} days`}`,
        });
      }
    }
    const expectedDaily = key.usageMonthly / 30;
    if (key.usageDaily > 0.1 && expectedDaily > 0 && key.usageDaily > expectedDaily * 2) {
      warnings.push({ kind: 'spend-spike', message: 'Spend today is ~2× your daily average' });
    }
  }

  return {
    creditsTotal,
    creditsUsage,
    creditsRemaining,
    label: key?.label ?? 'key',
    limit: key?.limit ?? 0,
    limitRemaining: key?.limitRemaining ?? 0,
    limitReset: key?.limitReset ?? null,
    usageDaily: key?.usageDaily ?? 0,
    usageMonthly: key?.usageMonthly ?? 0,
    expiresAt: key?.expiresAt ?? null,
    spendToday,
    spend7d,
    trend,
    top,
    warnings,
    providers,
    staleCredits,
  };
}

export function resetLabel(reset: string | null | undefined): string {
  return (reset && RESET_LABEL[reset]) || '';
}

/** A provider snapshot older than this is treated as a health problem. */
export const PROVIDER_STALE_MS = 2 * 86_400_000;

/**
 * True when a provider is "showing problems" on the Home health strip.
 * Providers without a status page are never surfaced here, and a provider is
 * only flagged when its health snapshot is not ok, missing, or stale.
 */
export function providerHasProblem(p: Provider, now: number = Date.now()): boolean {
  if (!p.statusPageUrl) return false;
  if (p.state !== 'ok' || !p.lastOkAt) return true;
  return now - new Date(p.lastOkAt).getTime() > PROVIDER_STALE_MS;
}

/** Providers with a status page that are currently showing problems. */
export function problemProviders(providers: Provider[], now: number = Date.now()): Provider[] {
  return providers.filter((p) => providerHasProblem(p, now));
}
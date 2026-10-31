/**
 * OpenRator — shared OpenCode normalization helpers (M8).
 *
 * OpenCode ships two products with different accounting models:
 *  - OpenCode Go: subscription plan, usage measured as a percentage of the
 *    allowance over rolling 5-hour, weekly and monthly windows.
 *  - OpenCode Zen: pay-as-you-go balance reported in microcents.
 *
 * The wire formats are provisional until the M8.1 live spike. These helpers
 * keep the conversion rules in one unit-tested place so adapters and fixtures
 * cannot drift.
 */

/**
 * 1 USD = 100,000,000 microcents (1 microcent = 1e-6 cent = 1e-8 USD).
 * If the live spike shows a different unit, change this constant only.
 */
export const MICROCENTS_PER_USD = 100_000_000;

/** Convert a microcent integer from the Zen API into USD, clamped at 0. */
export function microcentsToUsd(microcents: number | null | undefined): number {
  const n = Number(microcents ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / MICROCENTS_PER_USD;
}

/** Convert USD to microcents (fixtures/tests and round-trip checks). */
export function usdToMicrocents(usd: number | null | undefined): number {
  const n = Number(usd ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * MICROCENTS_PER_USD);
}

/** Plan usage percentages are always rendered in the inclusive 0..100 range. */
export function clampPct(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export const PLAN_WINDOW_LABELS: Record<string, string> = {
  five_hour: 'every 5 hours',
  weekly: 'weekly',
  monthly: 'monthly',
};

/** Order windows for display: shortest first. */
export const PLAN_WINDOW_ORDER = ['five_hour', 'weekly', 'monthly'] as const;

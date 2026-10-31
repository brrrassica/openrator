/**
 * OpenRator — cold/warm start budget harness (M5.4).
 *
 * The device pass records real stopwatch values; this module makes the budget
 * itself executable and testable so CI catches a regression in the thresholds
 * or the selector path before a device run. It is pure (no timers): callers
 * pass already-measured milliseconds.
 *
 * Spec §11 criterion 1: fresh install → key → Home populated < 10 s; warm
 * start < 2 s. The selector itself must stay well under the warm budget.
 */

export interface StartMeasurements {
  /** Cold start: install/onboarding → populated Home. */
  coldMs: number;
  /** Warm start: process alive, cached rollups → populated Home. */
  warmMs: number;
  /** Time spent inside the pure Home selector for one render. */
  selectorMs: number;
}

export interface StartBudgets {
  coldMs: number;
  warmMs: number;
  selectorMs: number;
}

/** Budgets in milliseconds, straight from spec §11 (selector = headroom). */
export const START_BUDGETS: StartBudgets = {
  coldMs: 10_000,
  warmMs: 2_000,
  selectorMs: 100,
};

export interface StartBudgetCheck {
  name: 'cold start' | 'warm start' | 'selector path';
  budgetMs: number;
  actualMs: number;
  ok: boolean;
}

export interface StartBudgetResult {
  ok: boolean;
  checks: StartBudgetCheck[];
}

const isFiniteNonNegative = (n: number): boolean => Number.isFinite(n) && n >= 0;

/**
 * Evaluate measured start timings against the spec budgets.
 *
 * Negative or non-finite measurements are treated as failures so a broken
 * stopwatch can never masquerade as a passing device run.
 */
export function evaluateStartBudget(
  measurements: StartMeasurements,
  budgets: StartBudgets = START_BUDGETS,
): StartBudgetResult {
  const checks: StartBudgetCheck[] = [
    {
      name: 'cold start',
      budgetMs: budgets.coldMs,
      actualMs: measurements.coldMs,
      ok: isFiniteNonNegative(measurements.coldMs) && measurements.coldMs < budgets.coldMs,
    },
    {
      name: 'warm start',
      budgetMs: budgets.warmMs,
      actualMs: measurements.warmMs,
      ok: isFiniteNonNegative(measurements.warmMs) && measurements.warmMs < budgets.warmMs,
    },
    {
      name: 'selector path',
      budgetMs: budgets.selectorMs,
      actualMs: measurements.selectorMs,
      ok: isFiniteNonNegative(measurements.selectorMs) && measurements.selectorMs < budgets.selectorMs,
    },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

/** Sum of the selector budget's slack, useful in reports (never negative). */
export function selectorHeadroomMs(actualMs: number, budgets: StartBudgets = START_BUDGETS): number {
  return Math.max(0, budgets.selectorMs - actualMs);
}

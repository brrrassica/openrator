import { describe, expect, it } from 'vitest';
import {
  START_BUDGETS,
  evaluateStartBudget,
  selectorHeadroomMs,
} from '../src/qa/start-budget';

/** M5.4 — cold/warm start budgets from spec §11. */

describe('start budget harness', () => {
  it('passes when every measurement is under budget', () => {
    const result = evaluateStartBudget({ coldMs: 5_000, warmMs: 900, selectorMs: 12 });
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.name)).toEqual(['cold start', 'warm start', 'selector path']);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it('treats the budget boundary as a failure (strictly under)', () => {
    const result = evaluateStartBudget({
      coldMs: START_BUDGETS.coldMs,
      warmMs: START_BUDGETS.warmMs,
      selectorMs: START_BUDGETS.selectorMs,
    });
    expect(result.ok).toBe(false);
    expect(result.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      'cold start',
      'warm start',
      'selector path',
    ]);
  });

  it('isolates a single over-budget phase', () => {
    const result = evaluateStartBudget({ coldMs: 9_000, warmMs: 2_500, selectorMs: 20 });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'warm start')?.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'cold start')?.ok).toBe(true);
  });

  it('rejects negative and non-finite measurements', () => {
    const result = evaluateStartBudget({ coldMs: -1, warmMs: Number.NaN, selectorMs: Infinity });
    expect(result.ok).toBe(false);
    expect(result.checks.every((c) => !c.ok)).toBe(true);
  });

  it('honours custom budgets', () => {
    const result = evaluateStartBudget(
      { coldMs: 500, warmMs: 200, selectorMs: 5 },
      { coldMs: 1_000, warmMs: 300, selectorMs: 10 },
    );
    expect(result.ok).toBe(true);
  });

  it('reports non-negative selector headroom', () => {
    expect(selectorHeadroomMs(40)).toBe(60);
    expect(selectorHeadroomMs(150)).toBe(0);
  });

  it('exposes the spec budgets', () => {
    expect(START_BUDGETS).toEqual({ coldMs: 10_000, warmMs: 2_000, selectorMs: 100 });
  });
});

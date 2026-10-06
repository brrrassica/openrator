import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildSpendSeries,
  computeDailyRollups,
  fmtDay,
  mergeActivityRows,
  toActivityRow,
  topEndpoints,
} from '../src/sync/rollups';
import { ActivityRow } from '../src/core/types';

const row = (day: string, endpoint: string, requests: number, spendUsd: number, tokens: number): ActivityRow => ({
  day,
  endpoint,
  apiKeyHash: 'h1',
  requests,
  spendUsd,
  tokens,
});

describe('toActivityRow', () => {
  it('normalizes a valid record (provisional shape)', () => {
    const r = toActivityRow({ date: '2026-10-04', endpoint: 'a:b', requests: 3, spend_usd: 0.02, tokens: 1200 });
    expect(r).toEqual({ day: '2026-10-04', endpoint: 'a:b', apiKeyHash: '', requests: 3, spendUsd: 0.02, tokens: 1200 });
  });

  it('defaults missing endpoint to "unknown"', () => {
    const r = toActivityRow({ date: '2026-10-04' });
    expect(r?.endpoint).toBe('unknown');
  });

  it('rejects bad dates and clamps negatives', () => {
    expect(toActivityRow({ date: '10/04/2026' })).toBeNull();
    const r = toActivityRow({ date: '2026-10-04', requests: -5, spend_usd: -1, tokens: -9 });
    expect(r?.requests).toBe(0);
    expect(r?.spendUsd).toBe(0);
    expect(r?.tokens).toBe(0);
  });
});

describe('computeDailyRollups + merge', () => {
  it('aggregates per day and per endpoint', () => {
    const rows = [
      row('2026-10-04', 'a', 2, 0.5, 100),
      row('2026-10-04', 'b', 1, 0.25, 50),
      row('2026-10-05', 'a', 5, 1.0, 200),
    ];
    const rl = computeDailyRollups(rows);
    expect(rl).toHaveLength(2);
    const d4 = rl.find((r) => r.day === '2026-10-04');
    expect(d4?.spendUsd).toBeCloseTo(0.75);
    expect(d4?.requests).toBe(3);
    expect(d4?.tokens).toBe(150);
    expect(d4?.byEndpoint['a']).toEqual({ requests: 2, spendUsd: 0.5, tokens: 100 });
  });

  it('merge is idempotent: same PK incoming wins, new rows appended', () => {
    const existing = [row('2026-10-04', 'a', 2, 0.5, 100)];
    const incoming = [
      row('2026-10-04', 'a', 7, 1.5, 300), // replace
      row('2026-10-06', 'c', 1, 0.1, 10), // new
    ];
    const merged = mergeActivityRows(existing, incoming);
    expect(merged).toHaveLength(2);
    const a = merged.find((r) => r.day === '2026-10-04');
    expect(a?.requests).toBe(7);
  });
});

describe('date math + 30-day series', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28'); // non-leap
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29'); // leap
  });

  it('buildSpendSeries returns `days` zero-filled entries ending at endDay', () => {
    const rollups = computeDailyRollups([row('2026-10-05', 'a', 5, 1.2, 200)]);
    const series = buildSpendSeries('2026-10-05', 30, rollups);
    expect(series).toHaveLength(30);
    expect(series[29]).toEqual({ day: '2026-10-05', spendUsd: 1.2, requests: 5 });
    expect(series[0].spendUsd).toBe(0);
    expect(series[0].day).toBe('2026-09-06');
  });

  it('fmtDay uses UTC', () => {
    expect(fmtDay(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05');
  });
});

describe('topEndpoints', () => {
  it('ranks endpoints by spend across days', () => {
    const rollups = computeDailyRollups([
      row('2026-10-04', 'cheap', 10, 0.2, 100),
      row('2026-10-05', 'pricey', 1, 0.9, 50),
      row('2026-10-05', 'cheap', 5, 0.1, 60),
    ]);
    const top = topEndpoints(rollups, 5);
    expect(top[0].endpoint).toBe('pricey');
    expect(top[0].spendUsd).toBeCloseTo(0.9);
    expect(top[1].endpoint).toBe('cheap');
    expect(top[1].spendUsd).toBeCloseTo(0.3);
    expect(top[1].requests).toBe(15);
  });
});
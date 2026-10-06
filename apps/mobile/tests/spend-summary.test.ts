import { describe, expect, it } from 'vitest';
import { ActivityRow, Provider } from '../src/core/types';
import {
  aggregateEndpoints,
  attachStatusPages,
  computeSpendSummary,
  providerOf,
  providerShare,
} from '../src/ui/spend-summary';

const TODAY = '2026-10-05';

const row = (day: string, endpoint: string, spendUsd: number, requests = 1, tokens = 10): ActivityRow => ({
  day,
  endpoint,
  apiKeyHash: 'h',
  requests,
  spendUsd,
  tokens,
});

const prov = (slug: string, statusPageUrl: string | null = null): Provider => ({
  name: slug,
  slug,
  datacenters: [],
  statusPageUrl,
  privacyPolicyUrl: null,
  termsOfServiceUrl: null,
  headquarters: null,
});

describe('providerOf (endpoint "model:provider" — provisional shape)', () => {
  it('splits at the first colon to the tail', () => {
    expect(providerOf('gpt-4o:openai')).toBe('openai');
    expect(providerOf('deepseek/deepseek-v4:deepseek')).toBe('deepseek');
  });

  it('falls back to the whole string without a colon', () => {
    expect(providerOf('openrouter/auto')).toBe('openrouter/auto');
    expect(providerOf('')).toBe('');
  });
});

describe('aggregateEndpoints', () => {
  it('filters to the window and ranks by spend with share percentages', () => {
    const rows = [
      row('2026-09-20', 'a:openai', 9.0), // outside 14d window
      row('2026-10-04', 'b:openai', 3.0, 10),
      row('2026-10-05', 'c:deepseek', 1.0, 2),
    ];
    const stats = aggregateEndpoints(rows, 14, TODAY);
    expect(stats.map((s) => s.endpoint)).toEqual(['b:openai', 'c:deepseek']);
    expect(stats[0].sharePct).toBeCloseTo(75, 5);
    expect(stats[0].avgPerReq).toBeCloseTo(0.3, 5);
  });

  it('empty window → empty list', () => {
    expect(aggregateEndpoints([row('2026-01-01', 'x:y', 1)], 7, TODAY)).toEqual([]);
  });
});

describe('attachStatusPages', () => {
  it('maps provider slug → status page and leaves unknown providers null', () => {
    const stats = aggregateEndpoints([row('2026-10-05', 'a:openai', 1), row('2026-10-05', 'b:weird', 2)], 7, TODAY);
    const withPages = attachStatusPages(stats, [prov('openai', 'https://status.openai.com')]);
    const byEp = Object.fromEntries(withPages.map((s) => [s.endpoint, s.statusPageUrl]));
    expect(byEp['a:openai']).toBe('https://status.openai.com');
    expect(byEp['b:weird']).toBeNull();
  });
});

describe('providerShare', () => {
  it('groups spend by provider tail, largest first, with percentages', () => {
    const share = providerShare(
      [
        row('2026-10-05', 'm1:openai', 2),
        row('2026-10-05', 'm2:openai', 1),
        row('2026-10-05', 'm3:deepseek', 1),
      ],
      7,
      TODAY,
    );
    expect(share).toHaveLength(2);
    expect(share[0].provider).toBe('openai');
    expect(share[0].spendUsd).toBeCloseTo(3);
    expect(share[0].sharePct).toBeCloseTo(75, 5);
  });

  it('totals 100% across all slices', () => {
    const share = providerShare(
      [row('2026-10-05', 'a:p1', 5), row('2026-10-05', 'a:p2', 3), row('2026-10-05', 'a:p3', 2)],
      7,
      TODAY,
    );
    expect(share.reduce((s, x) => s + x.sharePct, 0)).toBeCloseTo(100, 5);
  });
});

describe('computeSpendSummary', () => {
  it('produces trend, totals, endpoints and share for a window', () => {
    const rows = [
      row('2026-09-01', 'a:openai', 100), // outside 30d
      row('2026-10-03', 'b:openai', 2, 4),
      row('2026-10-04', 'c:deepseek', 1, 2),
      row('2026-10-05', 'd:azure', 1, 1),
    ];
    const s = computeSpendSummary(rows, [prov('openai', 'https://status.openai.com')], TODAY, 30);
    expect(s.hasActivity).toBe(true);
    expect(s.trend).toHaveLength(30);
    expect(s.totalSpend).toBeCloseTo(4);
    expect(s.totalRequests).toBe(7);
    expect(s.endpoints).toHaveLength(3);
    expect(s.share).toHaveLength(3);
    expect(s.endpoints[0].statusPageUrl).toBe('https://status.openai.com');
    expect(s.byDay).toHaveLength(30);
    expect(s.byDay[0].day).toBe('2026-10-05');
  });

  it('empty rows → zeroed summary without throwing', () => {
    const s = computeSpendSummary([], [], TODAY, 30);
    expect(s.hasActivity).toBe(false);
    expect(s.totalSpend).toBe(0);
    expect(s.trend).toHaveLength(30);
    expect(s.byDay).toHaveLength(30);
  });
});
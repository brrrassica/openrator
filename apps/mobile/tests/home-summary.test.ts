import { describe, expect, it } from 'vitest';
import { KeyRow, DailyRollup, Provider } from '../src/core/types';
import {
  computeHomeSummary,
  problemProviders,
  providerHasProblem,
  resetLabel,
} from '../src/ui/home-summary';

const TODAY = '2026-10-05';

const key = (over: Partial<KeyRow> = {}): KeyRow => ({
  hash: 'sk-or-1234567',
  label: 'homelab',
  isManagement: 0,
  limit: 4,
  limitRemaining: 3.2,
  limitReset: 'daily',
  usageMonthly: 40,
  usageDaily: 1.2,
  usageWeekly: 4,
  expiresAt: null,
  updatedAt: TODAY,
  ...over,
});

const provider = (slug: string, over: Partial<Provider> = {}): Provider => ({
  name: slug,
  slug,
  datacenters: [],
  statusPageUrl: null,
  privacyPolicyUrl: null,
  termsOfServiceUrl: null,
  headquarters: null,
  ...over,
});

const rollup = (day: string, spendUsd: number, requests = 1): DailyRollup => ({
  day,
  spendUsd,
  requests,
  tokens: 100,
  byEndpoint: { 'm:p': { requests, spendUsd, tokens: 100 } },
});

describe('computeHomeSummary', () => {
  it('builds the 14-day trend, 7-day spend and top endpoints', () => {
    const rollups = [
      rollup('2026-10-05', 1.0),
      rollup('2026-10-04', 0.5),
      rollup('2026-10-03', 0.25),
      rollup('2026-09-25', 9.0), // outside 7d window but inside 14d
    ];
    const s = computeHomeSummary({
      key: key(),
      rollups,
      providers: [provider('ionstream')],
      today: TODAY,
      staleCredits: false,
      activityLocked: true,
    });
    expect(s.trend).toHaveLength(14);
    expect(s.trend[13]).toBeCloseTo(1.0);
    expect(s.spendToday).toBeCloseTo(1.0);
    expect(s.spend7d).toBeCloseTo(1.75); // 1.0 + 0.5 + 0.25
    expect(s.top[0].endpoint).toBe('m:p');
    expect(s.top[0].spendUsd).toBeCloseTo(1.75);
    expect(s.providers).toHaveLength(1);
  });

  it('warns when remaining < 10% of limit', () => {
    const s = computeHomeSummary({
      key: key({ limit: 4, limitRemaining: 0.3 }),
      rollups: [],
      providers: [],
      today: TODAY,
      staleCredits: false,
      activityLocked: false,
    });
    expect(s.warnings.map((w) => w.kind)).toContain('limit');
  });

  it('warns about imminent expiry', () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const s = computeHomeSummary({
      key: key({ expiresAt: soon }),
      rollups: [],
      providers: [],
      today: TODAY,
      staleCredits: false,
      activityLocked: false,
    });
    expect(s.warnings.map((w) => w.kind)).toContain('expiry');
    expect(s.warnings.find((w) => w.kind === 'expiry')?.message).toMatch(/in 3 days/);
  });

  it('warns on spend spike when today ≫ daily average', () => {
    const s = computeHomeSummary({
      key: key({ usageMonthly: 30, usageDaily: 4 }), // avg 1.0/day → 4× spike
      rollups: [],
      providers: [],
      today: TODAY,
      staleCredits: false,
      activityLocked: false,
    });
    expect(s.warnings.map((w) => w.kind)).toContain('spend-spike');
  });

  it('no key → safe defaults, no warnings', () => {
    const s = computeHomeSummary({
      key: null,
      rollups: [],
      providers: [],
      today: TODAY,
      staleCredits: true,
      activityLocked: false,
    });
    expect(s.limit).toBe(0);
    expect(s.warnings).toEqual([]);
    expect(s.staleCredits).toBe(true);
    expect(s.label).toBe('key');
  });

  it('surfaces OpenRouter account credits and remaining balance', () => {
    const s = computeHomeSummary({
      key: key(),
      rollups: [],
      providers: [],
      today: TODAY,
      staleCredits: false,
      activityLocked: false,
      creditsTotal: 20,
      creditsUsage: 7.5,
    });
    expect(s.creditsTotal).toBe(20);
    expect(s.creditsUsage).toBe(7.5);
    expect(s.creditsRemaining).toBeCloseTo(12.5);
  });

  it('defaults credits to zero when never synced', () => {
    const s = computeHomeSummary({
      key: null,
      rollups: [],
      providers: [],
      today: TODAY,
      staleCredits: false,
      activityLocked: false,
    });
    expect(s.creditsTotal).toBe(0);
    expect(s.creditsUsage).toBe(0);
    expect(s.creditsRemaining).toBe(0);
  });
});

describe('problemProviders', () => {
  const NOW = Date.parse('2026-10-05T12:00:00.000Z');
  const healthy = (slug: string): Provider =>
    provider(slug, {
      statusPageUrl: `https://status.${slug}.com`,
      state: 'ok',
      lastOkAt: new Date(NOW - 60_000).toISOString(),
    });

  it('excludes providers without a status page', () => {
    const p = provider('no-status', { state: 'down', lastOkAt: null });
    expect(providerHasProblem(p, NOW)).toBe(false);
    expect(problemProviders([p], NOW)).toHaveLength(0);
  });

  it('excludes healthy providers with a fresh status page', () => {
    expect(providerHasProblem(healthy('ionstream'), NOW)).toBe(false);
  });

  it('flags providers whose state is not ok', () => {
    const p = provider('degraded', {
      statusPageUrl: 'https://status.degraded.com',
      state: 'degraded',
      lastOkAt: new Date(NOW - 60_000).toISOString(),
    });
    expect(providerHasProblem(p, NOW)).toBe(true);
  });

  it('flags providers with a missing health stamp', () => {
    const p = provider('unknown', {
      statusPageUrl: 'https://status.unknown.com',
      state: 'ok',
      lastOkAt: null,
    });
    expect(providerHasProblem(p, NOW)).toBe(true);
  });

  it('flags providers whose snapshot is stale (>2 days)', () => {
    const p = provider('stale', {
      statusPageUrl: 'https://status.stale.com',
      state: 'ok',
      lastOkAt: new Date(NOW - 3 * 86_400_000).toISOString(),
    });
    expect(providerHasProblem(p, NOW)).toBe(true);
  });

  it('returns only the problematic providers with status pages', () => {
    const list = [
      healthy('ok-one'),
      provider('no-status', { state: 'down' }),
      provider('bad', {
        statusPageUrl: 'https://status.bad.com',
        state: 'down',
        lastOkAt: new Date(NOW - 60_000).toISOString(),
      }),
    ];
    const result = problemProviders(list, NOW);
    expect(result.map((p) => p.slug)).toEqual(['bad']);
  });
});

describe('resetLabel', () => {
  it('maps windows and unknown values', () => {
    expect(resetLabel('daily')).toBe('resets daily');
    expect(resetLabel('weekly')).toBe('resets weekly');
    expect(resetLabel('monthly')).toBe('resets monthly');
    expect(resetLabel(null)).toBe('');
    expect(resetLabel(undefined)).toBe('');
  });
});
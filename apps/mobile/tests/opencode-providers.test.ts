import { describe, expect, it } from 'vitest';
import {
  buildPlanInfo,
  planInfoSettingEntries,
  planSettingSuffix,
  planWindowSettingEntries,
} from '../src/core/plan';
import { CredentialService, MemoryKeyValueStore } from '../src/core/credentials';
import {
  getManualUsage,
  getProviderSetting,
  listManualUsage,
  migrate,
  upsertManualUsage,
} from '../src/store/daos';
import { OpenCodeGoAdapter } from '../src/providers/opencode-go/adapter';
import { OpenCodeZenAdapter } from '../src/providers/opencode-zen/adapter';
import {
  MICROCENTS_PER_USD,
  clampPct,
  microcentsToUsd,
  usdToMicrocents,
} from '../src/providers/opencode/common';
import { SyncEngine } from '../src/sync/sync-engine';
import { NodeSqlite } from './helpers/sqlite-node';

describe('OpenCode Go adapter (M8)', () => {
  it('maps subscription percentage windows and clamps out-of-range values', async () => {
    const adapter = new OpenCodeGoAdapter({
      account: { label: 'Go Pro' },
      plan: {
        name: 'OpenCode Go Pro',
        status: 'active',
        amountUsd: 20,
        windows: [
          { window: 'five_hour', usedPct: 150, resetsAt: '2026-10-31T18:00:00Z' },
          { window: 'weekly', usedPct: 42 },
          { window: 'monthly', usedPct: -3 },
        ],
      },
    });

    expect(adapter.capabilities.subscriptionPlan).toBe(true);
    expect(adapter.capabilities.planWindows).toBe(true);
    expect(adapter.capabilities.activityHistory).toBe(false);

    const account = await adapter.getAccount({
      provider: 'opencode-go',
      key: 'go-fixture-key-0123456789',
      isManagement: false,
    });
    expect(account.provider).toBe('opencode-go');
    expect(account.label).toBe('Go Pro');
    expect(account.plan?.name).toBe('OpenCode Go Pro');
    expect(account.planWindows).toEqual([
      { window: 'five_hour', usedPct: 100, resetsAt: '2026-10-31T18:00:00Z' },
      { window: 'weekly', usedPct: 42, resetsAt: null },
      { window: 'monthly', usedPct: 0, resetsAt: null },
    ]);
  });

  it('refuses to fabricate an account when no fixture is present', async () => {
    const adapter = new OpenCodeGoAdapter();
    await expect(
      adapter.getAccount({
        provider: 'opencode-go',
        key: 'go-fixture-key-0123456789',
        isManagement: false,
      }),
    ).rejects.toThrow(/not verified/);
  });
});

describe('OpenCode Zen adapter (M8)', () => {
  it('converts microcent wire values to USD', async () => {
    expect(MICROCENTS_PER_USD).toBe(100_000_000);
    expect(microcentsToUsd(1_234_567_890)).toBeCloseTo(12.3456789, 7);
    expect(usdToMicrocents(12.3456789)).toBe(1_234_567_890);
    expect(microcentsToUsd(-5)).toBe(0);

    const adapter = new OpenCodeZenAdapter({
      account: {
        label: 'Zen wallet',
        balanceMicrocents: 2_000_000_000, // $20.00
        usageMicrocents: 500_000_000, // $5.00
        usageMonthlyMicrocents: 500_000_000,
      },
    });
    const account = await adapter.getAccount({
      provider: 'opencode-zen',
      key: 'zen-fixture-key-0123456789',
      isManagement: false,
    });
    expect(account.balanceTotal).toBe(20);
    expect(account.balanceUsage).toBe(5);
    expect(account.usageMonthly).toBe(5);
    expect(account.provider).toBe('opencode-zen');
    expect(adapter.capabilities.accountBalance).toBe(true);
    expect(adapter.capabilities.activityHistory).toBe(false);
  });

  it('prefers explicit USD fields when a fixture supplies both units', async () => {
    const adapter = new OpenCodeZenAdapter({
      account: { balanceTotal: 3, balanceMicrocents: 999_000_000_000 },
    });
    const account = await adapter.getAccount({
      provider: 'opencode-zen',
      key: 'zen-fixture-key-0123456789',
      isManagement: false,
    });
    expect(account.balanceTotal).toBe(3);
  });
});

describe('plan settings round-trip (M8)', () => {
  it('serializes and rebuilds plan windows', () => {
    const plan = {
      name: 'OpenCode Go',
      status: 'active',
      amountUsd: 20,
      renewsAt: '2026-11-30',
      windows: [
        { window: 'five_hour' as const, usedPct: 10, resetsAt: null },
        { window: 'weekly' as const, usedPct: 55, resetsAt: '2026-11-03' },
      ],
    };
    const entries = [...planInfoSettingEntries(plan), ...planWindowSettingEntries(plan.windows)];
    const settings = Object.fromEntries(entries.map((e) => [e.key, e.value]));

    const rebuilt = buildPlanInfo(settings);
    expect(rebuilt?.name).toBe('OpenCode Go');
    expect(rebuilt?.amountUsd).toBe(20);
    expect(rebuilt?.windows).toHaveLength(2);
    expect(rebuilt?.windows?.find((w) => w.window === 'weekly')?.usedPct).toBe(55);
    expect(settings[planSettingSuffix('monthly', 'used_pct')]).toBeUndefined();
    expect(clampPct(Number.NaN)).toBe(0);
  });

  it('returns null when no plan has ever been reported', () => {
    expect(buildPlanInfo({})).toBeNull();
  });
});

describe('manual usage DAO (M8.5)', () => {
  it('upserts, reads and lists manual amounts per provider/month', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    await upsertManualUsage(db, {
      provider: 'opencode-zen',
      month: '2026-10',
      amountUsd: 12.5,
      note: 'manual',
      updatedAt: '2026-10-31T00:00:00Z',
    });
    await upsertManualUsage(db, {
      provider: 'opencode-go',
      month: '2026-10',
      amountUsd: 20,
      note: null,
      updatedAt: '2026-10-31T00:00:00Z',
    });

    expect((await getManualUsage(db, 'opencode-zen', '2026-10'))?.amountUsd).toBe(12.5);
    expect(await listManualUsage(db, 'opencode-zen')).toHaveLength(1);
    expect(await listManualUsage(db)).toHaveLength(2);
  });
});

describe('sync engine persists OpenCode Go plan windows (M8)', () => {
  it('writes percent windows into provider-scoped settings', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    const creds = new CredentialService(new MemoryKeyValueStore());
    await creds.saveKey('go-fixture-key-0123456789', false, 'opencode-go');

    const go = new OpenCodeGoAdapter({
      account: { label: 'Go fixture' },
      plan: {
        name: 'OpenCode Go Pro',
        status: 'active',
        windows: [{ window: 'five_hour', usedPct: 33.3 }],
      },
    });
    const engine = new SyncEngine([go], creds, db, {});
    await engine.refreshAll();

    expect(await getProviderSetting(db, 'opencode-go', 'account.plan_name')).toBe(
      'OpenCode Go Pro',
    );
    expect(
      await getProviderSetting(db, 'opencode-go', 'plan.window.five_hour.used_pct'),
    ).toBe('33.3');
    expect(engine.getStatus('opencode-go').credits?.error).toBeUndefined();
  });
});

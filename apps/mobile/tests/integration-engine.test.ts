import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqlDb } from '../src/store/db';
import {
  clearAllData,
  getActivityRows,
  getDailyRollups,
  getKeyRow,
  getSetting,
  listProvidersFromDb,
  migrate,
  pruneActivityOlderThan,
} from '../src/store/daos';
import { SyncEngine } from '../src/sync/sync-engine';
import { CredentialService, MemoryKeyValueStore } from '../src/core/credentials';
import { OpenRouterClient } from '../src/core/client';
import { ActivityRow, Provider } from '../src/core/types';
import { computeSpendSummary } from '../src/ui/spend-summary';

/**
 * Fixture-driven engine E2E (M5.4): real SQLite (node:sqlite) + a scripted
 * OpenRouter client. Runs the whole refresh pipeline and asserts what lands
 * in the on-device cache + what the spend selectors derive from it.
 */

class NodeSqlite implements SqlDb {
  private db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(':memory:');
  }
  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }
  async runAsync(sql: string, ...params: (string | number | null)[]): Promise<{
    lastInsertRowId?: number;
    changes?: number;
  }> {
    const st = this.db.prepare(sql);
    const r = st.run(...params.map((p) => (p === undefined ? null : p)));
    return { lastInsertRowId: r.lastInsertRowid as number | undefined, changes: r.changes as number };
  }
  async getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null> {
    const row = this.db.prepare(sql).get(...params);
    return row === undefined ? null : (row as T);
  }
  async closeAsync(): Promise<void> {
    this.db.close();
  }
}

interface FakeRes {
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
}
const res = (body: unknown): FakeRes => ({
  status: 200,
  headers: { get: () => null },
  json: async () => body,
});

const FIXTURE_KEY = 'sk-or-v1-mgmt-fixture-0123456789abcdef';

const ACTIVITY = [
  { date: '2026-10-04', endpoint: 'openai/gpt-4o-mini', api_key_hash: 'h1', requests: 12, spend_usd: 1.0, tokens: 4000 },
  { date: '2026-10-04', endpoint: 'anthropic/claude-3.5-sonnet', api_key_hash: 'h1', requests: 3, spend_usd: 2.5, tokens: 9000 },
  { date: '2026-10-05', endpoint: 'openai/gpt-4o-mini', api_key_hash: 'h1', requests: 5, spend_usd: 0.75, tokens: 2100 },
];

const PROVIDERS: Provider[] = [
  {
    slug: 'openai',
    name: 'OpenAI',
    datacenters: ['us'],
    statusPageUrl: 'https://status.openai.com',
    privacyPolicyUrl: 'https://openai.com/policies/privacy-policy',
    termsOfServiceUrl: 'https://openai.com/policies/terms-of-use',
    headquarters: 'San Francisco',
  },
  {
    slug: 'anthropic',
    name: 'Anthropic',
    datacenters: ['us'],
    statusPageUrl: 'https://status.anthropic.com',
    privacyPolicyUrl: 'https://www.anthropic.com/legal/privacy',
    termsOfServiceUrl: 'https://www.anthropic.com/legal/terms',
    headquarters: 'San Francisco',
  },
];

function makeClient() {
  return new OpenRouterClient({
    apiKey: FIXTURE_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    fetchFn: async (input: string) => {
      if (input.includes('/key'))
        return res({
          data: {
            label: 'mgmt-fixture',
            is_management_key: true,
            limit: 10,
            limit_remaining: 3.2,
            limit_reset: 'monthly',
            usage: 6.8,
            usage_daily: 1.75,
            usage_weekly: 4.2,
            usage_monthly: 6.8,
            free_model_daily_requests: { used: 0, limit: 1000, remaining: 1000 },
          },
        });
      if (input.includes('/credits')) return res({ data: { total_credits: 65, total_usage: 48.54 } });
      if (input.includes('/activity')) return res({ data: ACTIVITY, total_count: 3 });
      if (input.includes('/providers')) return res({ data: PROVIDERS });
      if (input.includes('/models/user'))
        return res({
          data: [{ id: 'openai/gpt-4o-mini' }, { id: 'anthropic/claude-3.5-sonnet' }],
          total_count: 2,
        });
      return res({ data: [] });
    },
  });
}

async function makeEngine() {
  const db = new NodeSqlite();
  await migrate(db);
  const creds = new CredentialService(new MemoryKeyValueStore());
  await creds.saveKey(FIXTURE_KEY, true);
  const engine = new SyncEngine(makeClient(), creds, db, {});
  return { db, engine };
}

describe('engine E2E over real SQLite (M5.4)', () => {
  it('refreshAll populates keys/activity/rollups/providers/models from fixtures', async () => {
    const { db, engine } = await makeEngine();
    await engine.refreshAll();

    // current key card source
    const keyRow = await getKeyRow(db, (await getSetting(db, 'credential.key_hash')) as string);
    expect(keyRow).not.toBeNull();
    expect(keyRow?.label).toBe('mgmt-fixture');
    expect(keyRow?.isManagement).toBe(1);
    expect(keyRow?.usageWeekly).toBe(4.2);
    expect(keyRow?.limitRemaining).toBe(3.2);
    expect(keyRow?.usageDaily).toBe(1.75);

    // account card
    expect(await getSetting(db, 'account.total_credits')).toBe('65');
    expect(await getSetting(db, 'account.total_usage')).toBe('48.54');

    // activity rows persisted verbatim
    const rows: ActivityRow[] = await getActivityRows(db);
    expect(rows).toHaveLength(3);

    // daily rollups: 2 days, correct aggregates
    const rollups = await getDailyRollups(db);
    expect(rollups).toHaveLength(2);
    const idx = Object.fromEntries(rollups.map((r) => [r.day, r]));
    expect(idx['2026-10-04']?.spendUsd).toBeCloseTo(3.5);
    expect(idx['2026-10-04']?.requests).toBe(15);
    expect(idx['2026-10-04']?.tokens).toBe(13000);
    expect(idx['2026-10-05']?.spendUsd).toBeCloseTo(0.75);
    expect(idx['2026-10-05']?.tokens).toBe(2100);

    // spend selectors agree with the activity rows (30d window)
    const s = computeSpendSummary(rows, PROVIDERS, '2026-10-06', 30);
    expect(s.totalSpend).toBeCloseTo(4.25);
    expect(s.totalRequests).toBe(20);
    expect(s.totalTokens).toBe(15100);
    expect(s.endpoints.length).toBe(2);
    expect(s.share.length).toBe(2);

    // provider snapshot
    const providers = await listProvidersFromDb(db);
    expect(providers).toHaveLength(2);
    expect(providers.find((p) => p.slug === 'openai')?.datacenters).toEqual(['us']);
    expect(providers.find((p) => p.slug === 'anthropic')?.statusPageUrl).toBe(
      'https://status.anthropic.com',
    );

    // /models/user reflection
    expect(await getSetting(db, 'models_user_count')).toBe('2');
  });

  it('prune removes rows older than the retention window', async () => {
    const { db } = await makeEngine();
    await db.runAsync(
      `INSERT INTO endpoint_activity (day, endpoint, api_key_hash, requests, spend_usd, tokens)
       VALUES ('2020-01-01', 'openai/gpt-4o-mini', 'h1', 1, 1.0, 100)`,
    );
    await pruneActivityOlderThan(db, '2021-01-01');
    const left = await getActivityRows(db);
    expect(left).toHaveLength(0);
  });

  it('refreshActivity persists every page of a paginated /activity response', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    const creds = new CredentialService(new MemoryKeyValueStore());
    await creds.saveKey(FIXTURE_KEY, true);
    const client = new OpenRouterClient({
      apiKey: FIXTURE_KEY,
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchFn: async (input: string) => {
        if (input.includes('cursor=page2')) {
          return res({
            data: [
              { date: '2026-10-05', endpoint: 'openai/gpt-4o-mini', api_key_hash: 'h1', requests: 5, spend_usd: 0.75, tokens: 2100 },
            ],
            total_count: 2,
            links: { next: null },
          });
        }
        return res({
          data: [
            { date: '2026-10-04', endpoint: 'openai/gpt-4o-mini', api_key_hash: 'h1', requests: 12, spend_usd: 1.0, tokens: 4000 },
          ],
          total_count: 2,
          links: { next: 'page2' },
        });
      },
    });
    const engine = new SyncEngine(client, creds, db, {});
    await engine.refreshActivity();
    const rows = await getActivityRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.day).sort()).toEqual(['2026-10-04', '2026-10-05']);
  });

  it('refreshAll is failure-isolated: a credits failure still syncs other sources', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    const creds = new CredentialService(new MemoryKeyValueStore());
    await creds.saveKey(FIXTURE_KEY, true);
    const client = new OpenRouterClient({
      apiKey: FIXTURE_KEY,
      baseUrl: 'https://openrouter.ai/api/v1',
      maxRetries: 0,
      fetchFn: async (input: string) => {
        if (input.includes('/key')) {
          return {
            status: 500,
            headers: { get: () => null },
            json: async () => ({ error: { message: 'boom' } }),
          };
        }
        if (input.includes('/credits')) return res({ data: { total_credits: 1, total_usage: 0 } });
        if (input.includes('/activity')) return res({ data: ACTIVITY, total_count: 3 });
        if (input.includes('/providers')) return res({ data: PROVIDERS });
        if (input.includes('/models/user'))
          return res({ data: [{ id: 'openai/gpt-4o-mini' }], total_count: 1 });
        return res({ data: [] });
      },
    });
    const engine = new SyncEngine(client, creds, db, {});
    await expect(engine.refreshAll()).resolves.toBeUndefined();
    expect(await getActivityRows(db)).toHaveLength(3);
    expect(await listProvidersFromDb(db)).toHaveLength(2);
    expect(await getSetting(db, 'models_user_count')).toBe('1');
  });

  it('clearAllData wipes cached usage data on sign-out', async () => {
    const { db, engine } = await makeEngine();
    await engine.refreshAll();
    expect((await getActivityRows(db)).length).toBeGreaterThan(0);
    expect((await getDailyRollups(db)).length).toBeGreaterThan(0);
    expect((await listProvidersFromDb(db)).length).toBeGreaterThan(0);

    await clearAllData(db);

    expect(await getActivityRows(db)).toHaveLength(0);
    expect(await getDailyRollups(db)).toHaveLength(0);
    expect(await listProvidersFromDb(db)).toHaveLength(0);
    expect(await db.getAllAsync('SELECT hash FROM keys')).toHaveLength(0);
    // non-credential settings gone; credential settings preserved for the caller
    expect(await getSetting(db, 'account.total_credits')).toBeNull();
    expect(await getSetting(db, 'credential.key_hash')).not.toBeNull();
  });
});
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqlDb } from '../src/store/db';
import {
  clearAllData,
  getActivityRows,
  getDailyRollups,
  getKeyRow,
  getKeyRows,
  getProviderSetting,
  getSetting,
  listProvidersFromDb,
  migrate,
  pruneActivityOlderThan,
  replaceDailyRollups,
  SCHEMA_VERSION,
  setProviderSetting,
  setSetting,
  upsertActivityRows,
  upsertKeyRow,
  withTransaction,
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

/** Wraps a SqlDb and fails the Nth runAsync — for atomicity tests (WS2-2). */
class FlakyDb implements SqlDb {
  private n = 0;
  constructor(private readonly inner: SqlDb, private readonly failOn: number) {}
  execAsync(sql: string): Promise<void> {
    return this.inner.execAsync(sql);
  }
  runAsync(sql: string, ...params: (string | number | null)[]) {
    this.n++;
    if (this.n === this.failOn) return Promise.reject(new Error('disk full'));
    return this.inner.runAsync(sql, ...params);
  }
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]> {
    return this.inner.getAllAsync<T>(sql, ...params);
  }
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null> {
    return this.inner.getFirstAsync<T>(sql, ...params);
  }
  closeAsync(): Promise<void> {
    return this.inner.closeAsync();
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

function makeClient(gate?: Promise<void>) {
  return new OpenRouterClient({
    apiKey: FIXTURE_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    fetchFn: async (input: string) => {
      if (gate) await gate;
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
  return { db, creds, engine };
}

describe('engine E2E over real SQLite (M5.4)', () => {
  // The fixtures below are anchored on 2026-10-04/05 and the engine keeps only
  // activity inside a rolling ACTIVITY_WINDOW_DAYS window (30d). Pin the clock
  // just past the fixtures so they stay inside the window: with a real clock
  // the fixtures age out and the rollup assertions see zero rows.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('stop waits for in-flight refresh writes before sign-out wipes the cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = new NodeSqlite();
    await migrate(db);
    const creds = new CredentialService(new MemoryKeyValueStore());
    await creds.saveKey(FIXTURE_KEY, true);
    const engine = new SyncEngine(makeClient(gate), creds, db, {});

    const refresh = engine.refreshAll();
    let stopResolved = false;
    const stopped = engine.stop().then(() => {
      stopResolved = true;
    });
    await Promise.resolve();
    expect(stopResolved).toBe(false); // the blocked network read is still tracked

    release();
    await stopped;
    await refresh;
    expect(await getSetting(db, 'credential.key_hash')).not.toBeNull();

    // This mirrors App.onSignOut: once stop() resolves, the wipe must be final.
    await clearAllData(db);
    await setSetting(db, 'credential.key_hash', '');
    await setSetting(db, 'credential.key_prefix', '');
    expect(await getKeyRows(db)).toHaveLength(0);
    expect(await getSetting(db, 'credential.key_hash')).toBe('');
    expect(await getSetting(db, 'credential.key_prefix')).toBe('');
  });

  it('refreshAll prefers a locally saved label over the provider key label', async () => {
    const { db, creds, engine } = await makeEngine();
    await creds.saveLabel('My main key', 'openrouter');
    await engine.refreshAll();
    const rows = await getKeyRows(db, 'openrouter');
    expect(rows[0]?.label).toBe('My main key');
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

  it('upsertActivityRows is atomic: a mid-batch failure rolls back (WS2-2)', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    const flaky = new FlakyDb(db, 2);
    const rows: ActivityRow[] = [
      { day: '2026-10-04', endpoint: 'a', apiKeyHash: 'h1', requests: 1, spendUsd: 0.1, tokens: 10 },
      { day: '2026-10-04', endpoint: 'b', apiKeyHash: 'h1', requests: 2, spendUsd: 0.2, tokens: 20 },
      { day: '2026-10-04', endpoint: 'c', apiKeyHash: 'h1', requests: 3, spendUsd: 0.3, tokens: 30 },
    ];
    await expect(upsertActivityRows(flaky, rows)).rejects.toThrow('disk full');
    // the first insert was rolled back with the rest
    expect(await getActivityRows(db)).toHaveLength(0);
  });

  it('serialises concurrent transactions on the same connection', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    const order: string[] = [];
    const write = async (name: string) => {
      order.push(`${name}-start`);
      await db.runAsync(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        `tx.${name}`,
        name,
      );
      order.push(`${name}-end`);
    };
    // Both callers would issue BEGIN at the same time without the queue.
    await Promise.all([
      withTransaction(db, () => write('a')),
      withTransaction(db, () => write('b')),
    ]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    expect(await getSetting(db, 'tx.a')).toBe('a');
    expect(await getSetting(db, 'tx.b')).toBe('b');
  });

  it('replacing a key purges stale rows for that provider only', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    const key = (provider: string, hash: string) => ({
      provider,
      hash,
      label: hash,
      isManagement: 0,
      limit: 10,
      limitRemaining: 4,
      limitReset: null,
      usageMonthly: 6,
      usageDaily: 0,
      usageWeekly: 0,
      expiresAt: null,
      updatedAt: '2026-10-05',
    });
    await upsertKeyRow(db, key('openrouter', 'old'));
    await upsertKeyRow(db, key('opencode-zen', 'zen'));
    await upsertKeyRow(db, key('openrouter', 'new'));

    expect((await getKeyRows(db, 'openrouter')).map((r) => r.hash)).toEqual(['new']);
    expect((await getKeyRows(db, 'opencode-zen')).map((r) => r.hash)).toEqual(['zen']);
  });

  it('replacing a key clears the old key activity, rollups, and account cache', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    const key = (provider: string, hash: string) => ({
      provider,
      hash,
      label: hash,
      isManagement: 0,
      limit: 10,
      limitRemaining: 4,
      limitReset: null,
      usageMonthly: 6,
      usageDaily: 0,
      usageWeekly: 0,
      expiresAt: null,
      updatedAt: '2026-10-05',
    });
    const activity = (provider: string, apiKeyHash: string): ActivityRow => ({
      provider,
      day: '2026-10-04',
      endpoint: 'openai/gpt-4o-mini',
      apiKeyHash,
      requests: 1,
      spendUsd: 1,
      tokens: 10,
    });
    await upsertKeyRow(db, key('openrouter', 'old'));
    await upsertKeyRow(db, key('opencode-zen', 'zen'));
    await upsertActivityRows(db, [activity('openrouter', 'old'), activity('opencode-zen', 'zen')]);
    await replaceDailyRollups(
      db,
      [
        {
          provider: 'openrouter',
          day: '2026-10-04',
          spendUsd: 1,
          requests: 1,
          tokens: 10,
          byEndpoint: {},
        },
      ],
      'openrouter',
    );
    await replaceDailyRollups(
      db,
      [
        {
          provider: 'opencode-zen',
          day: '2026-10-04',
          spendUsd: 1,
          requests: 1,
          tokens: 10,
          byEndpoint: {},
        },
      ],
      'opencode-zen',
    );
    await setProviderSetting(db, 'openrouter', 'account.total_credits', '65');
    await setProviderSetting(db, 'openrouter', 'plan.window.monthly.used_pct', '100');
    await setSetting(db, 'account.total_credits', '65');
    await setSetting(db, 'credential.key_hash', 'old');

    // A same-key refresh must not throw away the cache.
    await upsertKeyRow(db, key('openrouter', 'old'));
    expect(await getActivityRows(db, { provider: 'openrouter' })).toHaveLength(1);

    await upsertKeyRow(db, key('openrouter', 'new'));

    expect(await getActivityRows(db, { provider: 'openrouter' })).toHaveLength(0);
    expect(await getActivityRows(db, { provider: 'opencode-zen' })).toHaveLength(1);
    expect(await getDailyRollups(db, undefined, undefined, 'openrouter')).toHaveLength(0);
    expect(await getDailyRollups(db, undefined, undefined, 'opencode-zen')).toHaveLength(1);
    expect(await getProviderSetting(db, 'openrouter', 'account.total_credits')).toBeNull();
    expect(
      await getProviderSetting(db, 'openrouter', 'plan.window.monthly.used_pct'),
    ).toBeNull();
    expect(await getSetting(db, 'account.total_credits')).toBeNull();
    expect(await getSetting(db, 'credential.key_hash')).toBeNull();
  });

  it('migrate upgrades a v1 database to the latest schema (WS2-3)', async () => {
    const db = new NodeSqlite();
    // Simulate a v1 DB: full base schema, but keys lacks usage_weekly and
    // provider_snapshot lacks state; user_version = 1.
    await db.execAsync(
      `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE keys (
         hash TEXT PRIMARY KEY, label TEXT NOT NULL,
         is_management INTEGER NOT NULL DEFAULT 0,
         "limit" REAL NOT NULL DEFAULT 0,
         limit_remaining REAL NOT NULL DEFAULT 0,
         limit_reset TEXT,
         usage_monthly REAL NOT NULL DEFAULT 0,
         usage_daily REAL NOT NULL DEFAULT 0,
         expires_at TEXT, updated_at TEXT NOT NULL
       );
       CREATE TABLE endpoint_activity (
         day TEXT NOT NULL, endpoint TEXT NOT NULL,
         api_key_hash TEXT NOT NULL DEFAULT '', requests INTEGER NOT NULL DEFAULT 0,
         spend_usd REAL NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (day, endpoint, api_key_hash)
       );
       CREATE TABLE daily_rollups (
         day TEXT PRIMARY KEY, spend_usd REAL NOT NULL DEFAULT 0,
         requests INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0,
         by_endpoint TEXT NOT NULL DEFAULT '{}'
       );
       CREATE TABLE provider_snapshot (
         slug TEXT PRIMARY KEY, name TEXT NOT NULL,
         regions TEXT NOT NULL DEFAULT '[]', status_page TEXT,
         last_ok_at TEXT, policy TEXT NOT NULL DEFAULT '{}'
       );`,
    );
    await db.execAsync('PRAGMA user_version = 1');
    await migrate(db);
    const keyCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(keys)');
    expect(keyCols.some((c) => c.name === 'usage_weekly')).toBe(true);
    const provCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(provider_snapshot)');
    expect(provCols.some((c) => c.name === 'state')).toBe(true);
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(Number(v?.user_version)).toBe(SCHEMA_VERSION);
  });

  it('refreshProviders stamps provider health state (WS2-9)', async () => {
    const { db, engine } = await makeEngine();
    await engine.refreshProviders();
    const providers = await listProvidersFromDb(db);
    expect(providers).toHaveLength(2);
    expect(providers.every((p) => p.state === 'ok')).toBe(true);
    expect(providers.every((p) => typeof p.lastOkAt === 'string')).toBe(true);
  });

  it('provider-scoped clear also removes legacy OpenRouter globals', async () => {
    const { db, engine } = await makeEngine();
    await engine.refreshAll();
    expect(await getSetting(db, 'account.total_credits')).not.toBeNull();
    expect(await getSetting(db, 'models_user_count')).not.toBeNull();
    expect(await getSetting(db, 'credential.key_hash')).not.toBeNull();

    await clearAllData(db, 'openrouter');

    expect(await getKeyRows(db, 'openrouter')).toHaveLength(0);
    expect(await getActivityRows(db, { provider: 'openrouter' })).toHaveLength(0);
    expect(await getDailyRollups(db, undefined, undefined, 'openrouter')).toHaveLength(0);
    expect(await getSetting(db, 'account.total_credits')).toBeNull();
    expect(await getSetting(db, 'account.total_usage')).toBeNull();
    expect(await getSetting(db, 'models_user_count')).toBeNull();
    expect(await getSetting(db, 'credential.key_hash')).toBeNull();
    expect(await getSetting(db, 'credential.key_prefix')).toBeNull();
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
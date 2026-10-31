import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqlDb } from '../src/store/db';
import {
  getActivityRows,
  getDailyRollups,
  getKeyRow,
  listProvidersFromDb,
  migrate,
  SCHEMA_VERSION,
} from '../src/store/daos';
import { ActivityRow, KeyRow } from '../src/core/types';
import { CredentialService, MemoryKeyValueStore } from '../src/core/credentials';
import { shortHash } from '../src/core/fingerprint';
import { OpenRouterClient } from '../src/core/client';
import { fixedOpenRouterAdapter } from '../src/providers/openrouter/adapter';
import { OpenCodeZenAdapter } from '../src/providers/opencode-zen/adapter';
import { getDescriptor, listDescriptors } from '../src/providers/registry';
import { SyncEngine } from '../src/sync/sync-engine';
import { dedupeUsageRows, combineKeyRows, sumCredits } from '../src/ui/aggregate';

class NodeSqlite implements SqlDb {
  private db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(':memory:');
  }
  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }
  async runAsync(sql: string, ...params: (string | number | null)[]) {
    const r = this.db.prepare(sql).run(...params.map((p) => (p === undefined ? null : p)));
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

const V3_SCHEMA = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE keys (
  hash TEXT PRIMARY KEY, label TEXT NOT NULL,
  is_management INTEGER NOT NULL DEFAULT 0,
  "limit" REAL NOT NULL DEFAULT 0,
  limit_remaining REAL NOT NULL DEFAULT 0,
  limit_reset TEXT,
  usage_monthly REAL NOT NULL DEFAULT 0,
  usage_daily REAL NOT NULL DEFAULT 0,
  usage_weekly REAL NOT NULL DEFAULT 0,
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
  last_ok_at TEXT, state TEXT NOT NULL DEFAULT 'unknown',
  policy TEXT NOT NULL DEFAULT '{}'
);
`;

describe('provider registry (M7.2)', () => {
  it('registers OpenRouter as enabled and Zen as capability-gated', () => {
    const openrouter = getDescriptor('openrouter');
    expect(openrouter.enabled).toBe(true);
    expect(openrouter.capabilities.activityHistory).toBe(true);
    expect(openrouter.supportsManagementKey).toBe(true);

    const zen = getDescriptor('opencode-zen');
    expect(zen.enabled).toBe(false);
    expect(zen.capabilities.manualBudget).toBe(true);
    expect(zen.capabilities.activityHistory).toBe(false);
    expect(listDescriptors().map((d) => d.id)).toEqual(['openrouter']);
  });
});

describe('credential namespacing and legacy migration (M7.4)', () => {
  it('migrates the v0.1 legacy key exactly once', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('openrator.openrouter.key', 'sk-or-v1-legacy-key-0123456789abcdef');
    await store.set('openrator.openrouter.is_management', '1');
    const creds = new CredentialService(store);

    await creds.migrateLegacy();

    expect(await creds.getKey('openrouter')).toBe(
      'sk-or-v1-legacy-key-0123456789abcdef',
    );
    expect(await creds.isManagementKey('openrouter')).toBe(true);
    expect(await creds.getManagementKey('openrouter')).toBe(
      'sk-or-v1-legacy-key-0123456789abcdef',
    );
    expect(await store.get('openrator.openrouter.key')).toBeNull();

    // idempotent re-run
    await creds.migrateLegacy();
    expect(await creds.getKey('openrouter')).toBe(
      'sk-or-v1-legacy-key-0123456789abcdef',
    );
  });

  it('keeps providers in separate secure-store namespaces', async () => {
    const creds = new CredentialService(new MemoryKeyValueStore());
    await creds.saveKey('sk-or-v1-primary-key-0123456789abcdef', false, 'openrouter');
    await creds.saveKey('zen-primary-key-0123456789', false, 'opencode-zen');
    await creds.saveManagementKey('sk-or-v1-mgmt-key-0123456789abcdef', 'openrouter');

    expect(await creds.providersWithKeys()).toEqual(['openrouter', 'opencode-zen']);
    expect(await creds.getManagementKey('openrouter')).toBe(
      'sk-or-v1-mgmt-key-0123456789abcdef',
    );

    await creds.clearProvider('opencode-zen');
    expect(await creds.hasKey('opencode-zen')).toBe(false);
    expect(await creds.hasKey('openrouter')).toBe(true);
  });
});

describe('SQLite migration v3 → v4 (M7.5)', () => {
  it('copies legacy rows as openrouter and makes provider part of every key', async () => {
    const db = new NodeSqlite();
    await db.execAsync(V3_SCHEMA);
    await db.execAsync(`
      INSERT INTO keys (hash, label, is_management, "limit", limit_remaining, limit_reset,
        usage_monthly, usage_daily, usage_weekly, expires_at, updated_at)
      VALUES ('h1', 'legacy', 1, 10, 7, 'monthly', 3, 1, 2, NULL, '2026-10-05');
      INSERT INTO endpoint_activity (day, endpoint, api_key_hash, requests, spend_usd, tokens)
      VALUES ('2026-10-04', 'a:b', 'h1', 2, 0.5, 100);
      INSERT INTO daily_rollups (day, spend_usd, requests, tokens, by_endpoint)
      VALUES ('2026-10-04', 0.5, 2, 100, '{"a:b":{"requests":2,"spendUsd":0.5,"tokens":100}}');
      INSERT INTO provider_snapshot (slug, name, regions, status_page, last_ok_at, state, policy)
      VALUES ('openai', 'OpenAI', '["us"]', NULL, NULL, 'ok', '{}');
      PRAGMA user_version = 3;
    `);

    await migrate(db);
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(Number(v?.user_version)).toBe(SCHEMA_VERSION);

    expect((await getKeyRow(db, 'h1', 'openrouter'))?.label).toBe('legacy');
    const activity = await getActivityRows(db, { provider: 'openrouter' });
    expect(activity).toHaveLength(1);
    expect(activity[0].provider).toBe('openrouter');
    expect(await getDailyRollups(db, undefined, undefined, 'openrouter')).toHaveLength(1);
    expect(await listProvidersFromDb(db, 'openrouter')).toHaveLength(1);

    const usageManual = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='usage_manual'",
    );
    expect(usageManual).toHaveLength(1);

    // A second migration run is a no-op.
    await migrate(db);
  });
});

describe('provider adapters (M7.3/M7.9)', () => {
  const fakeRes = (status: number, body: unknown) => ({
    status,
    headers: { get: () => null },
    json: async () => body,
  });

  it('OpenRouter adapter normalizes account and usage rows', async () => {
    const client = new OpenRouterClient({
      apiKey: 'sk-or-v1-adapter-test-0123456789',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchFn: async (input: string) => {
        if (input.includes('/key')) {
          return fakeRes(200, {
            data: {
              label: 'adapter',
              is_management_key: true,
              limit: 10,
              limit_remaining: 4,
              limit_reset: 'monthly',
              usage: 6,
              usage_daily: 1,
              usage_weekly: 2,
              usage_monthly: 6,
              free_model_daily_requests: { used: 0, limit: 0, remaining: 0 },
            },
          });
        }
        if (input.includes('/credits')) {
          return fakeRes(200, { data: { total_credits: 20, total_usage: 6 } });
        }
        if (input.includes('/activity')) {
          return fakeRes(200, {
            data: [
              {
                date: '2026-10-04',
                endpoint: 'openai/gpt-4o-mini',
                api_key_hash: 'h',
                requests: 2,
                spend_usd: 0.5,
                tokens: 100,
              },
            ],
          });
        }
        return fakeRes(200, { data: [] });
      },
    });
    const adapter = fixedOpenRouterAdapter(client);
    const credential = {
      provider: 'openrouter' as const,
      key: 'sk-or-v1-adapter-test-0123456789',
      isManagement: true,
    };

    const account = await adapter.getAccount(credential);
    expect(account.provider).toBe('openrouter');
    expect(account.label).toBe('adapter');
    expect(account.balanceTotal).toBe(20);
    expect(account.fingerprint).toBe(shortHash(credential.key));

    const usage = await adapter.getUsage(credential, {
      fromDay: '2026-10-01',
      toDay: '2026-10-05',
    });
    expect(usage).toHaveLength(1);
    expect(usage[0].provider).toBe('openrouter');
    expect(usage[0].spendUsd).toBe(0.5);
  });

  it('Zen fixture adapter maps only advertised capabilities', async () => {
    const adapter = new OpenCodeZenAdapter({
      account: { label: 'Zen fixture', balanceTotal: 12, balanceUsage: 2 },
      usage: [
        {
          provider: 'opencode-zen',
          day: '2026-10-04',
          endpoint: 'zen/model',
          apiKeyHash: 'h',
          requests: 1,
          spendUsd: 0.1,
          tokens: 10,
        },
      ],
    });
    expect(adapter.capabilities.accountBalance).toBe(true);
    expect(adapter.capabilities.activityHistory).toBe(true);
    expect(adapter.capabilities.keyManagement).toBe(false);

    const account = await adapter.getAccount({
      provider: 'opencode-zen',
      key: 'zen-fixture-key-0123456789',
      isManagement: false,
    });
    expect(account.provider).toBe('opencode-zen');
    expect(account.label).toBe('Zen fixture');
    expect(account.balanceTotal).toBe(12);
  });
});

describe('multi-provider orchestrator (M7.6)', () => {
  it('isolates a failing OpenRouter provider from a healthy Zen adapter', async () => {
    const db = new NodeSqlite();
    await migrate(db);
    const creds = new CredentialService(new MemoryKeyValueStore());
    await creds.saveKey('sk-or-v1-broken-key-0123456789abcdef', true, 'openrouter');
    await creds.saveKey('zen-fixture-key-0123456789', false, 'opencode-zen');

    const brokenClient = new OpenRouterClient({
      apiKey: 'sk-or-v1-broken-key-0123456789abcdef',
      baseUrl: 'https://openrouter.ai/api/v1',
      maxRetries: 0,
      fetchFn: async () => ({
        status: 500,
        headers: { get: () => null },
        json: async () => ({ error: { message: 'boom' } }),
      }),
    });
    const zen = new OpenCodeZenAdapter({
      account: { label: 'zen fixture', balanceTotal: 5, usageMonthly: 1 },
    });

    const engine = new SyncEngine(
      [fixedOpenRouterAdapter(brokenClient), zen],
      creds,
      db,
      {},
    );
    await expect(engine.refreshAll()).resolves.toBeUndefined();

    expect(engine.getStatus('openrouter').credits?.error).toBeTruthy();
    expect(engine.getStatus('opencode-zen').credits?.error).toBeUndefined();
    expect(
      await getKeyRow(
        db,
        shortHash('zen-fixture-key-0123456789'),
        'opencode-zen',
      ),
    ).not.toBeNull();
  });
});

describe('aggregate math (M7.8)', () => {
  const row = (
    provider: string,
    day: string,
    endpoint: string,
    spendUsd: number,
  ): ActivityRow => ({
    provider,
    day,
    endpoint,
    apiKeyHash: 'h',
    requests: 1,
    spendUsd,
    tokens: 10,
  });

  it('dedupes only within the same provider/day/endpoint key', () => {
    const rows = dedupeUsageRows([
      row('openrouter', '2026-10-04', 'a', 1),
      row('openrouter', '2026-10-04', 'a', 2),
      row('opencode-zen', '2026-10-04', 'a', 3),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.provider === 'openrouter')?.spendUsd).toBe(2);
    expect(rows.find((r) => r.provider === 'opencode-zen')?.spendUsd).toBe(3);
  });

  it('sums credits and key rows for the All providers scope', () => {
    expect(sumCredits([{ total: 20, usage: 5 }, { total: 10, usage: 2 }])).toEqual({
      total: 30,
      usage: 7,
      remaining: 23,
    });

    const key = (provider: string, limit: number, remaining: number): KeyRow => ({
      provider,
      hash: provider,
      label: provider,
      isManagement: 0,
      limit,
      limitRemaining: remaining,
      limitReset: 'monthly',
      usageMonthly: limit - remaining,
      usageDaily: 0,
      usageWeekly: 0,
      expiresAt: null,
      updatedAt: '2026-10-05',
    });
    const combined = combineKeyRows([
      key('openrouter', 10, 4),
      key('opencode-zen', 5, 2),
    ]);
    expect(combined?.label).toBe('All providers');
    expect(combined?.limit).toBe(15);
    expect(combined?.limitRemaining).toBe(6);
    expect(combined?.usageMonthly).toBe(9);
  });
});

/**
 * OpenRator — DAOs for the on-device cache (spec §9, M7.5).
 *
 * v0.2 keys every cache table by provider. Legacy v0.1 rows are copied as
 * `openrouter` during migration v4. The raw API key is NEVER written here.
 */

import { ActivityRow, DailyRollup, KeyRow, Provider, Setting } from '../core/types';
import { ProviderId } from '../providers/types';
import { SqlDb } from './db';

export const DEFAULT_PROVIDER = 'openrouter';

// ---- schema --------------------------------------------------------------

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS keys (
  hash TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_management INTEGER NOT NULL DEFAULT 0,
  "limit" REAL NOT NULL DEFAULT 0,
  limit_remaining REAL NOT NULL DEFAULT 0,
  limit_reset TEXT,
  usage_monthly REAL NOT NULL DEFAULT 0,
  usage_daily REAL NOT NULL DEFAULT 0,
  usage_weekly REAL NOT NULL DEFAULT 0,
  expires_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS endpoint_activity (
  day TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  api_key_hash TEXT NOT NULL DEFAULT '',
  requests INTEGER NOT NULL DEFAULT 0,
  spend_usd REAL NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, endpoint, api_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_activity_day ON endpoint_activity(day);
CREATE TABLE IF NOT EXISTS daily_rollups (
  day TEXT PRIMARY KEY,
  spend_usd REAL NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  by_endpoint TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS provider_snapshot (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  regions TEXT NOT NULL DEFAULT '[]',
  status_page TEXT,
  last_ok_at TEXT,
  state TEXT NOT NULL DEFAULT 'unknown',
  policy TEXT NOT NULL DEFAULT '{}'
);
`;

/**
 * Ordered migrations. Index `i` upgrades `user_version` from `i` to `i + 1`.
 * Never reorder or delete an entry — append only (WS2-3).
 */
const MIGRATIONS: Array<(db: SqlDb) => Promise<void>> = [
  // 1 — base schema (idempotent CREATE IF NOT EXISTS).
  async (db) => {
    await db.execAsync(SCHEMA_V1);
  },
  // 2 — usage_weekly for pre-existing DBs (idempotent column add).
  async (db) => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(keys)');
    if (!cols.some((c) => c.name === 'usage_weekly')) {
      await db.runAsync('ALTER TABLE keys ADD COLUMN usage_weekly REAL NOT NULL DEFAULT 0');
    }
  },
  // 3 — provider health state (WS2-9).
  async (db) => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(provider_snapshot)');
    if (!cols.some((c) => c.name === 'state')) {
      await db.runAsync(
        "ALTER TABLE provider_snapshot ADD COLUMN state TEXT NOT NULL DEFAULT 'unknown'",
      );
    }
  },
  // 4 — provider-keyed cache (M7.5). Rebuild-with-copy keeps v0.1 rows.
  async (db) => {
    await db.execAsync(`
      BEGIN;
      CREATE TABLE keys_v4 (
        provider TEXT NOT NULL DEFAULT '${DEFAULT_PROVIDER}',
        hash TEXT NOT NULL,
        label TEXT NOT NULL,
        is_management INTEGER NOT NULL DEFAULT 0,
        "limit" REAL NOT NULL DEFAULT 0,
        limit_remaining REAL NOT NULL DEFAULT 0,
        limit_reset TEXT,
        usage_monthly REAL NOT NULL DEFAULT 0,
        usage_daily REAL NOT NULL DEFAULT 0,
        usage_weekly REAL NOT NULL DEFAULT 0,
        expires_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, hash)
      );
      INSERT OR IGNORE INTO keys_v4
        (provider, hash, label, is_management, "limit", limit_remaining, limit_reset,
         usage_monthly, usage_daily, usage_weekly, expires_at, updated_at)
      SELECT '${DEFAULT_PROVIDER}', hash, label, is_management, "limit", limit_remaining,
             limit_reset, usage_monthly, usage_daily, usage_weekly, expires_at, updated_at
        FROM keys;
      DROP TABLE keys;
      ALTER TABLE keys_v4 RENAME TO keys;

      CREATE TABLE endpoint_activity_v4 (
        provider TEXT NOT NULL DEFAULT '${DEFAULT_PROVIDER}',
        day TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        api_key_hash TEXT NOT NULL DEFAULT '',
        requests INTEGER NOT NULL DEFAULT 0,
        spend_usd REAL NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider, day, endpoint, api_key_hash)
      );
      INSERT OR IGNORE INTO endpoint_activity_v4
        (provider, day, endpoint, api_key_hash, requests, spend_usd, tokens)
      SELECT '${DEFAULT_PROVIDER}', day, endpoint, api_key_hash, requests, spend_usd, tokens
        FROM endpoint_activity;
      DROP TABLE endpoint_activity;
      ALTER TABLE endpoint_activity_v4 RENAME TO endpoint_activity;
      CREATE INDEX IF NOT EXISTS idx_activity_day ON endpoint_activity(day);
      CREATE INDEX IF NOT EXISTS idx_activity_provider_day ON endpoint_activity(provider, day);

      CREATE TABLE daily_rollups_v4 (
        provider TEXT NOT NULL DEFAULT '${DEFAULT_PROVIDER}',
        day TEXT NOT NULL,
        spend_usd REAL NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        by_endpoint TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider, day)
      );
      INSERT OR IGNORE INTO daily_rollups_v4
        (provider, day, spend_usd, requests, tokens, by_endpoint)
      SELECT '${DEFAULT_PROVIDER}', day, spend_usd, requests, tokens, by_endpoint
        FROM daily_rollups;
      DROP TABLE daily_rollups;
      ALTER TABLE daily_rollups_v4 RENAME TO daily_rollups;

      CREATE TABLE provider_snapshot_v4 (
        provider TEXT NOT NULL DEFAULT '${DEFAULT_PROVIDER}',
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        regions TEXT NOT NULL DEFAULT '[]',
        status_page TEXT,
        last_ok_at TEXT,
        state TEXT NOT NULL DEFAULT 'unknown',
        policy TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (provider, slug)
      );
      INSERT OR IGNORE INTO provider_snapshot_v4
        (provider, slug, name, regions, status_page, last_ok_at, state, policy)
      SELECT '${DEFAULT_PROVIDER}', slug, name, regions, status_page, last_ok_at, state, policy
        FROM provider_snapshot;
      DROP TABLE provider_snapshot;
      ALTER TABLE provider_snapshot_v4 RENAME TO provider_snapshot;

      CREATE TABLE IF NOT EXISTS usage_manual (
        provider TEXT NOT NULL,
        month TEXT NOT NULL,
        amount_usd REAL NOT NULL DEFAULT 0,
        note TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, month)
      );
      COMMIT;
    `);
  },
];

/** Current schema version = number of migrations. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Deterministic, versioned migration runner (WS2-3). Reads `PRAGMA
 * user_version`, applies every pending migration in order, and bumps the
 * version after each one so a crash mid-upgrade resumes cleanly.
 */
export async function migrate(db: SqlDb): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = Number(row?.user_version ?? 0);
  for (let i = version; i < MIGRATIONS.length; i++) {
    await MIGRATIONS[i](db);
    version = i + 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

/**
 * Per-connection transaction queue. SQLite permits only one transaction per
 * connection, so concurrent calls on the same `SqlDb` are chained rather than
 * allowed to interleave their BEGIN/COMMIT pairs.
 */
const transactionQueues = new WeakMap<SqlDb, Promise<unknown>>();

async function runTransaction<T>(db: SqlDb, fn: () => Promise<T>): Promise<T> {
  let begun = false;
  try {
    await db.execAsync('BEGIN');
    begun = true;
    const result = await fn();
    await db.execAsync('COMMIT');
    return result;
  } catch (e) {
    if (begun) {
      try {
        await db.execAsync('ROLLBACK');
      } catch {
        // ignore rollback failure — surface the original error
      }
    }
    throw e;
  }
}

/**
 * Runs `fn` inside a single SQLite transaction (WS2-2). Commits on success,
 * rolls back on any throw so batched writes are all-or-nothing. Concurrent
 * callers on the same connection are serialised through a promise queue.
 */
export async function withTransaction<T>(db: SqlDb, fn: () => Promise<T>): Promise<T> {
  const previous = transactionQueues.get(db) ?? Promise.resolve();
  const run = previous.then(
    () => runTransaction(db, fn),
    () => runTransaction(db, fn),
  );
  // Keep the chain alive after a failure without poisoning later callers.
  transactionQueues.set(db, run.then(
    () => undefined,
    () => undefined,
  ));
  return run;
}

/**
 * Wipe cached usage data on sign-out (spec §6.2). With a provider argument
 * only that provider's rows are removed (plus the v0.1 global OpenRouter
 * settings it used); without one every provider is wiped. Credential settings
 * are cleared separately after the secure store empties.
 */
export async function clearAllData(db: SqlDb, provider?: ProviderId): Promise<void> {
  const where = provider ? ' WHERE provider = ?' : '';
  const params = provider ? [provider] : [];
  for (const table of ['endpoint_activity', 'daily_rollups', 'provider_snapshot', 'keys', 'usage_manual']) {
    await db.runAsync(`DELETE FROM ${table}${where}`, ...params);
  }
  if (provider) {
    await db.runAsync('DELETE FROM settings WHERE key LIKE ?', `provider.${provider}.%`);
    // v0.1 only persisted OpenRouter account/cache settings globally and Home
    // still reads them as a fallback. Remove them with the provider so a
    // re-added account cannot display the previous key or balance.
    if (provider === 'openrouter') {
      await db.runAsync(
        `DELETE FROM settings WHERE key IN (
           'account.total_credits', 'account.total_usage', 'models_user_count',
           'credential.key_hash', 'credential.key_prefix'
         )`,
      );
    }
  } else {
    await db.runAsync("DELETE FROM settings WHERE key NOT LIKE 'credential.%'");
  }
}

// ---- settings ------------------------------------------------------------

export async function getSetting(db: SqlDb, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<Setting>('SELECT key, value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}

async function writeSetting(db: SqlDb, key: string, value: string): Promise<void> {
  // Route every write through the shared transaction queue so it can never
  // land inside another source's open transaction (and be rolled back with it).
  await withTransaction(db, async () => {
    await db.runAsync(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      key,
      value,
    );
  });
}

export async function setSetting(db: SqlDb, key: string, value: string): Promise<void> {
  await writeSetting(db, key, value);
}

/** Namespaced operational setting key (`provider.<id>.<key>`). */
export function providerSettingKey(provider: ProviderId, key: string): string {
  return `provider.${provider}.${key}`;
}

export async function getProviderSetting(
  db: SqlDb,
  provider: ProviderId,
  key: string,
): Promise<string | null> {
  return getSetting(db, providerSettingKey(provider, key));
}

export async function setProviderSetting(
  db: SqlDb,
  provider: ProviderId,
  key: string,
  value: string,
): Promise<void> {
  await writeSetting(db, providerSettingKey(provider, key), value);
}

async function deleteProviderSettingsInTransaction(
  db: SqlDb,
  provider: ProviderId,
  keyPrefix = '',
): Promise<void> {
  await db.runAsync(
    'DELETE FROM settings WHERE key LIKE ?',
    `${providerSettingKey(provider, keyPrefix)}%`,
  );
}

/**
 * Deletes the provider's namespaced settings (or only those under
 * `keyPrefix`). Used to invalidate cached account/plan values when their
 * source snapshot no longer contains them.
 */
export async function deleteProviderSettings(
  db: SqlDb,
  provider: ProviderId,
  keyPrefix = '',
): Promise<void> {
  await withTransaction(db, async () => {
    await deleteProviderSettingsInTransaction(db, provider, keyPrefix);
  });
}

// ---- manual usage (capability-limited providers, M8.5) -------------------

export interface ManualUsageRow {
  provider: string;
  /** Calendar month, `YYYY-MM`. */
  month: string;
  amountUsd: number;
  note: string | null;
  updatedAt: string;
}

/** Insert or replace one provider's manual amount for a month. */
export async function upsertManualUsage(db: SqlDb, row: ManualUsageRow): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO usage_manual
       (provider, month, amount_usd, note, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    row.provider,
    row.month,
    row.amountUsd,
    row.note ?? null,
    row.updatedAt,
  );
}

export async function getManualUsage(
  db: SqlDb,
  provider: string,
  month: string,
): Promise<ManualUsageRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT provider, month, amount_usd, note, updated_at FROM usage_manual WHERE provider = ? AND month = ?',
    provider,
    month,
  );
  return r ? rowToManualUsage(r) : null;
}

export async function listManualUsage(
  db: SqlDb,
  provider?: string,
): Promise<ManualUsageRow[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT provider, month, amount_usd, note, updated_at FROM usage_manual' +
      (provider ? ' WHERE provider = ?' : '') +
      ' ORDER BY month DESC',
    ...(provider ? [provider] : []),
  );
  return rows.map(rowToManualUsage);
}

export async function deleteManualUsage(
  db: SqlDb,
  provider: string,
  month?: string,
): Promise<void> {
  if (month) {
    await db.runAsync(
      'DELETE FROM usage_manual WHERE provider = ? AND month = ?',
      provider,
      month,
    );
    return;
  }
  await db.runAsync('DELETE FROM usage_manual WHERE provider = ?', provider);
}

function rowToManualUsage(r: Record<string, unknown>): ManualUsageRow {
  return {
    provider: String(r.provider),
    month: String(r.month),
    amountUsd: Number(r.amount_usd ?? 0),
    note: (r.note as string | null) ?? null,
    updatedAt: String(r.updated_at ?? ''),
  };
}

// ---- keys ----------------------------------------------------------------

/**
 * Persists the provider's current credential snapshot. The keys table holds a
 * single active key per provider, so any rows left over from a replaced key
 * are purged in the same transaction — otherwise aggregate totals would keep
 * counting the abandoned key. A key change also invalidates the provider's
 * cached activity/rollups/settings, since those were derived from the old
 * credential and cannot be attributed to the new one.
 */
export async function upsertKeyRow(db: SqlDb, row: KeyRow): Promise<void> {
  const provider = (row.provider ?? DEFAULT_PROVIDER) as ProviderId;
  await withTransaction(db, async () => {
    const stale = await db.getFirstAsync<{ hash: string }>(
      'SELECT hash FROM keys WHERE provider = ? AND hash <> ? LIMIT 1',
      provider,
      row.hash,
    );
    if (stale) {
      await db.runAsync(
        'DELETE FROM endpoint_activity WHERE provider = ? AND api_key_hash <> ?',
        provider,
        row.hash,
      );
      await db.runAsync('DELETE FROM daily_rollups WHERE provider = ?', provider);
      await deleteProviderSettingsInTransaction(db, provider);
      // v0.1 kept OpenRouter account/cache settings globally; Home still reads
      // them as a fallback, so they must not resurrect the old key's totals.
      if (provider === 'openrouter') {
        await db.runAsync(
          `DELETE FROM settings WHERE key IN (
             'account.total_credits', 'account.total_usage', 'models_user_count',
             'credential.key_hash', 'credential.key_prefix'
           )`,
        );
      }
    }
    await db.runAsync(
      'DELETE FROM keys WHERE provider = ? AND hash <> ?',
      provider,
      row.hash,
    );
    await db.runAsync(
      `INSERT OR REPLACE INTO keys
        (provider, hash, label, is_management, "limit", limit_remaining, limit_reset,
         usage_monthly, usage_daily, usage_weekly, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      provider,
      row.hash,
      row.label,
      row.isManagement,
      row.limit,
      row.limitRemaining,
      row.limitReset ?? null,
      row.usageMonthly,
      row.usageDaily,
      row.usageWeekly,
      row.expiresAt ?? null,
      row.updatedAt,
    );
  });
}

export async function getKeyRow(
  db: SqlDb,
  hash: string,
  provider: string = DEFAULT_PROVIDER,
): Promise<KeyRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT provider, hash, label, is_management, "limit" AS k_limit, limit_remaining, limit_reset,
            usage_monthly, usage_daily, usage_weekly, expires_at, updated_at
       FROM keys WHERE provider = ? AND hash = ?`,
    provider,
    hash,
  );
  if (!r) return null;
  return {
    provider: String(r.provider ?? provider),
    hash: String(r.hash),
    label: String(r.label),
    isManagement: Number(r.is_management),
    limit: Number(r.k_limit),
    limitRemaining: Number(r.limit_remaining),
    limitReset: r.limit_reset as string | null,
    usageMonthly: Number(r.usage_monthly),
    usageDaily: Number(r.usage_daily),
    usageWeekly: Number(r.usage_weekly ?? 0),
    expiresAt: r.expires_at as string | null,
    updatedAt: String(r.updated_at),
  };
}

export async function getKeyRows(db: SqlDb, provider?: string): Promise<KeyRow[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT provider, hash, label, is_management, "limit" AS k_limit, limit_remaining, limit_reset,
            usage_monthly, usage_daily, usage_weekly, expires_at, updated_at
       FROM keys` + (provider ? ' WHERE provider = ?' : '') + ' ORDER BY updated_at DESC',
    ...(provider ? [provider] : []),
  );
  return rows.map((r) => ({
    provider: String(r.provider ?? DEFAULT_PROVIDER),
    hash: String(r.hash),
    label: String(r.label),
    isManagement: Number(r.is_management),
    limit: Number(r.k_limit),
    limitRemaining: Number(r.limit_remaining),
    limitReset: r.limit_reset as string | null,
    usageMonthly: Number(r.usage_monthly),
    usageDaily: Number(r.usage_daily),
    usageWeekly: Number(r.usage_weekly ?? 0),
    expiresAt: r.expires_at as string | null,
    updatedAt: String(r.updated_at),
  }));
}

// ---- endpoint activity ---------------------------------------------------

const ACTIVITY_COLS = 'provider, day, endpoint, api_key_hash, requests, spend_usd, tokens';

function rowToActivity(r: Record<string, unknown>): ActivityRow {
  return {
    provider: String(r.provider ?? DEFAULT_PROVIDER),
    day: String(r.day),
    endpoint: String(r.endpoint),
    apiKeyHash: String(r.api_key_hash ?? ''),
    requests: Number(r.requests ?? 0),
    spendUsd: Number(r.spend_usd ?? 0),
    tokens: Number(r.tokens ?? 0),
  };
}

/**
 * Idempotent by (provider, day, endpoint, api_key_hash) — re-sync replaces
 * rows. Batched in a single transaction so a mid-batch failure leaves the
 * table untouched (WS2-2).
 */
export async function upsertActivityRows(db: SqlDb, rows: ActivityRow[]): Promise<void> {
  if (rows.length === 0) return;
  await withTransaction(db, async () => {
    for (const r of rows) {
      await db.runAsync(
        `INSERT OR REPLACE INTO endpoint_activity (${ACTIVITY_COLS})
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        r.provider ?? DEFAULT_PROVIDER,
        r.day,
        r.endpoint,
        r.apiKeyHash,
        r.requests,
        r.spendUsd,
        r.tokens,
      );
    }
  });
}

export async function getActivityRows(
  db: SqlDb,
  opts: {
    provider?: string;
    fromDay?: string;
    toDay?: string;
    endpoint?: string;
    limit?: number;
  } = {},
): Promise<ActivityRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.provider) {
    where.push('provider = ?');
    params.push(opts.provider);
  }
  if (opts.fromDay) {
    where.push('day >= ?');
    params.push(opts.fromDay);
  }
  if (opts.toDay) {
    where.push('day <= ?');
    params.push(opts.toDay);
  }
  if (opts.endpoint) {
    where.push('endpoint = ?');
    params.push(opts.endpoint);
  }
  const sql =
    `SELECT ${ACTIVITY_COLS} FROM endpoint_activity` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY day DESC` +
    (opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '');
  const rows = await db.getAllAsync<Record<string, unknown>>(sql, ...params);
  return rows.map(rowToActivity);
}

export async function pruneActivityOlderThan(
  db: SqlDb,
  dayExclusive: string,
  provider?: string,
): Promise<void> {
  await withTransaction(db, async () => {
    if (provider) {
      await db.runAsync(
        'DELETE FROM endpoint_activity WHERE provider = ? AND day < ?',
        provider,
        dayExclusive,
      );
      return;
    }
    await db.runAsync('DELETE FROM endpoint_activity WHERE day < ?', dayExclusive);
  });
}

// ---- daily rollups -------------------------------------------------------

/**
 * Replaces the rollup set atomically (WS2-2). When `provider` is passed the
 * provider's existing rows are deleted first, so days pruned out of
 * `endpoint_activity` never linger in `daily_rollups` (M5.4). An empty
 * `rollups` array therefore clears that provider's rollups.
 */
export async function replaceDailyRollups(
  db: SqlDb,
  rollups: DailyRollup[],
  provider?: string,
): Promise<void> {
  if (rollups.length === 0 && !provider) return;
  await withTransaction(db, async () => {
    if (provider) {
      await db.runAsync('DELETE FROM daily_rollups WHERE provider = ?', provider);
    }
    for (const r of rollups) {
      await db.runAsync(
        `INSERT OR REPLACE INTO daily_rollups
           (provider, day, spend_usd, requests, tokens, by_endpoint)
         VALUES (?, ?, ?, ?, ?, ?)`,
        r.provider ?? DEFAULT_PROVIDER,
        r.day,
        r.spendUsd,
        r.requests,
        r.tokens,
        JSON.stringify(r.byEndpoint),
      );
    }
  });
}

export async function getDailyRollups(
  db: SqlDb,
  fromDay?: string,
  toDay?: string,
  provider?: string,
): Promise<DailyRollup[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (provider) {
    where.push('provider = ?');
    params.push(provider);
  }
  if (fromDay) {
    where.push('day >= ?');
    params.push(fromDay);
  }
  if (toDay) {
    where.push('day <= ?');
    params.push(toDay);
  }
  const sql =
    `SELECT provider, day, spend_usd, requests, tokens, by_endpoint FROM daily_rollups` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY day ASC`;
  const rows = await db.getAllAsync<Record<string, unknown>>(sql, ...params);
  return rows.map((r) => ({
    provider: String(r.provider ?? DEFAULT_PROVIDER),
    day: String(r.day),
    spendUsd: Number(r.spend_usd),
    requests: Number(r.requests),
    tokens: Number(r.tokens),
    byEndpoint: JSON.parse(String(r.by_endpoint ?? '{}')) as DailyRollup['byEndpoint'],
  }));
}

// ---- provider snapshot ---------------------------------------------------

/**
 * Upserts one upstream provider and stamps its health (WS2-9): a successful
 * catalog sync marks the provider `ok` with `last_ok_at = now`.
 */
export async function upsertProviderRow(
  db: SqlDb,
  p: Provider,
  nowIso: string = new Date().toISOString(),
  provider: string = DEFAULT_PROVIDER,
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO provider_snapshot
       (provider, slug, name, regions, status_page, last_ok_at, state, policy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    provider,
    p.slug,
    p.name,
    JSON.stringify(Array.isArray(p.datacenters) ? p.datacenters : []),
    p.statusPageUrl,
    nowIso,
    'ok',
    '{}',
  );
}

/** Batched provider upsert in one transaction (WS2-2). */
export async function upsertProviderRows(
  db: SqlDb,
  providers: Provider[],
  nowIso: string = new Date().toISOString(),
  provider: string = DEFAULT_PROVIDER,
): Promise<void> {
  if (providers.length === 0) return;
  await withTransaction(db, async () => {
    for (const p of providers) await upsertProviderRow(db, p, nowIso, provider);
  });
}

/**
 * Parses the stored `regions` JSON into a string array. The API may return
 * `datacenters: null`, which round-trips through JSON as the string "null";
 * normalize anything that isn't an array to `[]` so callers can safely use
 * `.length`/`.slice` (WS2-9).
 */
function parseRegions(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export async function listProvidersFromDb(
  db: SqlDb,
  provider?: string,
): Promise<Provider[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT provider, slug, name, regions, status_page, last_ok_at, state FROM provider_snapshot' +
      (provider ? ' WHERE provider = ?' : '') +
      ' ORDER BY name',
    ...(provider ? [provider] : []),
  );
  return rows.map((r) => ({
    provider: String(r.provider ?? DEFAULT_PROVIDER),
    slug: String(r.slug),
    name: String(r.name),
    datacenters: parseRegions(r.regions),
    statusPageUrl: r.status_page as string | null,
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
    headquarters: null,
    lastOkAt: (r.last_ok_at as string | null) ?? null,
    state: (r.state as string | null) ?? null,
  }));
}

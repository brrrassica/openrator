/**
 * OpenRator — DAOs for the on-device cache (spec §9).
 * Tables: keys, endpoint_activity, daily_rollups, provider_snapshot, settings.
 * Key/value store must be consulted for the raw API key — never this module.
 */

import { ActivityRow, DailyRollup, KeyRow, Provider, Setting } from '../core/types';
import { SqlDb } from './db';

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
  policy TEXT NOT NULL DEFAULT '{}'
);
`;

export async function migrate(db: SqlDb): Promise<void> {
  await db.execAsync(SCHEMA_V1);
  // idempotent column add for pre-existing DBs
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(keys)');
  if (!cols.some((c) => c.name === 'usage_weekly')) {
    await db.runAsync('ALTER TABLE keys ADD COLUMN usage_weekly REAL NOT NULL DEFAULT 0');
  }
}

/**
 * Wipe all cached usage data on sign-out (spec §6.2). Removes activity,
 * rollups, provider snapshots, key rows, and non-credential settings so no
 * usage data survives. Credential settings are cleared separately by the
 * caller after the secure store is emptied.
 */
export async function clearAllData(db: SqlDb): Promise<void> {
  await db.runAsync('DELETE FROM endpoint_activity');
  await db.runAsync('DELETE FROM daily_rollups');
  await db.runAsync('DELETE FROM provider_snapshot');
  await db.runAsync('DELETE FROM keys');
  await db.runAsync("DELETE FROM settings WHERE key NOT LIKE 'credential.%'");
}

// ---- settings ------------------------------------------------------------

export async function getSetting(db: SqlDb, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<Setting>('SELECT key, value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}

export async function setSetting(db: SqlDb, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    key,
    value,
  );
}

// ---- keys ----------------------------------------------------------------

export async function upsertKeyRow(db: SqlDb, row: KeyRow): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO keys
      (hash, label, is_management, "limit", limit_remaining, limit_reset,
       usage_monthly, usage_daily, usage_weekly, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
}

export async function getKeyRow(db: SqlDb, hash: string): Promise<KeyRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT hash, label, is_management, "limit" AS k_limit, limit_remaining, limit_reset,
            usage_monthly, usage_daily, usage_weekly, expires_at, updated_at
       FROM keys WHERE hash = ?`,
    hash,
  );
  if (!r) return null;
  return {
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

// ---- endpoint activity ---------------------------------------------------

const ACTIVITY_COLS = 'day, endpoint, api_key_hash, requests, spend_usd, tokens';

function rowToActivity(r: Record<string, unknown>): ActivityRow {
  return {
    day: String(r.day),
    endpoint: String(r.endpoint),
    apiKeyHash: String(r.api_key_hash ?? ''),
    requests: Number(r.requests ?? 0),
    spendUsd: Number(r.spend_usd ?? 0),
    tokens: Number(r.tokens ?? 0),
  };
}

/** Idempotent by (day, endpoint, api_key_hash) — re-sync replaces rows. */
export async function upsertActivityRows(db: SqlDb, rows: ActivityRow[]): Promise<void> {
  for (const r of rows) {
    await db.runAsync(
      `INSERT OR REPLACE INTO endpoint_activity (${ACTIVITY_COLS})
       VALUES (?, ?, ?, ?, ?, ?)`,
      r.day,
      r.endpoint,
      r.apiKeyHash,
      r.requests,
      r.spendUsd,
      r.tokens,
    );
  }
}

export async function getActivityRows(
  db: SqlDb,
  opts: { fromDay?: string; toDay?: string; endpoint?: string; limit?: number } = {},
): Promise<ActivityRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
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

export async function pruneActivityOlderThan(db: SqlDb, dayExclusive: string): Promise<void> {
  await db.runAsync('DELETE FROM endpoint_activity WHERE day < ?', dayExclusive);
}

// ---- daily rollups -------------------------------------------------------

export async function replaceDailyRollups(db: SqlDb, rollups: DailyRollup[]): Promise<void> {
  for (const r of rollups) {
    await db.runAsync(
      `INSERT OR REPLACE INTO daily_rollups (day, spend_usd, requests, tokens, by_endpoint)
       VALUES (?, ?, ?, ?, ?)`,
      r.day,
      r.spendUsd,
      r.requests,
      r.tokens,
      JSON.stringify(r.byEndpoint),
    );
  }
}

export async function getDailyRollups(
  db: SqlDb,
  fromDay?: string,
  toDay?: string,
): Promise<DailyRollup[]> {
  const where: string[] = [];
  const params: (string)[] = [];
  if (fromDay) {
    where.push('day >= ?');
    params.push(fromDay);
  }
  if (toDay) {
    where.push('day <= ?');
    params.push(toDay);
  }
  const sql =
    `SELECT day, spend_usd, requests, tokens, by_endpoint FROM daily_rollups` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY day ASC`;
  const rows = await db.getAllAsync<Record<string, unknown>>(sql, ...params);
  return rows.map((r) => ({
    day: String(r.day),
    spendUsd: Number(r.spend_usd),
    requests: Number(r.requests),
    tokens: Number(r.tokens),
    byEndpoint: JSON.parse(String(r.by_endpoint ?? '{}')) as DailyRollup['byEndpoint'],
  }));
}

// ---- provider snapshot ---------------------------------------------------

export async function upsertProviderRow(db: SqlDb, p: Provider): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO provider_snapshot (slug, name, regions, status_page, policy)
     VALUES (?, ?, ?, ?, ?)`,
    p.slug,
    p.name,
    JSON.stringify(p.datacenters),
    p.statusPageUrl,
    '{}',
  );
}

export async function listProvidersFromDb(db: SqlDb): Promise<Provider[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT slug, name, regions, status_page FROM provider_snapshot ORDER BY name',
  );
  return rows.map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    datacenters: JSON.parse(String(r.regions ?? '[]')) as string[],
    statusPageUrl: r.status_page as string | null,
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
    headquarters: null,
  }));
}
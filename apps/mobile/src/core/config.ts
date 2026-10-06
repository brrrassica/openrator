/** OpenRator — static configuration & poll cadence (spec §7). */

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const POLL = {
  /** Credits (/key + /credits) refresh cadence. */
  CREDITS_FOREGROUND_MS: 60_000,
  CREDITS_BACKGROUND_MS: 15 * 60_000,
  /** Activity (/activity) pull cadence — on open + every 15 min (mgmt key). */
  ACTIVITY_FOREGROUND_MS: 15 * 60_000,
  ACTIVITY_BACKGROUND_MS: 15 * 60_000,
  /** Provider snapshot + /models/user cache (daily). */
  SNAPSHOT_DAILY_MS: 24 * 60 * 60_000,
  /** Client request timeout. */
  REQUEST_TIMEOUT_MS: 20_000,
  /** Retries for retriable failures (429/5xx/network). */
  MAX_RETRIES: 2,
  /** On-device cache retention for activity rows. */
  ACTIVITY_RETENTION_DAYS: 35,
} as const;

/** API exposes a 30-day activity window. */
export const ACTIVITY_WINDOW_DAYS = 30;

/** DB file name inside the app storage dir. */
export const SQLITE_DB_NAME = 'openrator.db';
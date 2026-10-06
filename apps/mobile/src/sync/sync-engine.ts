/**
 * OpenRator — SyncEngine (spec §7): poll schedules, deltas, staleness.
 * Timers are setTimeout-based (works on RN without extra deps); start/stop
 * switch foreground ↔ background cadence per spec.
 */

import { ACTIVITY_WINDOW_DAYS, POLL } from '../core/config';
import { OpenRouterClient } from '../core/client';
import { CredentialService } from '../core/credentials';
import { addDays, computeDailyRollups, fmtDay, toActivityRow } from './rollups';
import { SqlDb } from '../store/db';
import {
  getActivityRows,
  pruneActivityOlderThan,
  replaceDailyRollups,
  setSetting,
  upsertActivityRows,
  upsertKeyRow,
  upsertProviderRow,
} from '../store/daos';
import { ActivityRow, KeyStatus, Provider } from '../core/types';

export type SourceName = 'credits' | 'activity' | 'providers' | 'models';

export interface SyncStatus {
  [source: string]: { lastOkAt?: number; error?: string; stalenessMs: number };
}

export interface SyncCallbacks {
  onStatus?: (status: SyncStatus) => void;
  onKey?: (key: KeyStatus) => void;
  onActivity?: (rows: ActivityRow[]) => void;
  onProviders?: (providers: Provider[]) => void;
  onError?: (source: SourceName, err: Error) => void;
}

const HASH_KEY_SETTING = 'credential.key_hash';
const HASH_PREFIX_SETTING = 'credential.key_prefix';

/** Non-secret short fingerprint for the current key (never the raw key). */
const shortHash = (key: string): string => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  return `${key.slice(0, 7)}${h.toString(16)}`;
};

interface Timer {
  stop: () => void;
}

function every(intervalMs: number, fn: () => void): Timer {
  const cancelled = { value: false };
  const handle: { current?: ReturnType<typeof setTimeout> } = {};
  const loop = (): void => {
    if (cancelled.value) return;
    fn();
    handle.current = setTimeout(loop, intervalMs);
  };
  handle.current = setTimeout(loop, intervalMs);
  return {
    stop: () => {
      cancelled.value = true;
      if (handle.current) clearTimeout(handle.current);
    },
  };
}

export class SyncEngine {
  private status: SyncStatus = {};
  private timers: Timer[] = [];
  private foreground = true;
  private running = false;
  private listeners = new Set<() => void>();

  constructor(
    private readonly client: OpenRouterClient,
    private readonly creds: CredentialService,
    private readonly db: SqlDb,
    private readonly cb: SyncCallbacks = {},
  ) {}

  /** Subscribe to refresh cycles (UI re-reads its data from SQLite). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private touch(source: SourceName, err?: string) {
    const prev = this.status[source];
    this.status[source] = {
      lastOkAt: err ? prev?.lastOkAt : Date.now(),
      error: err,
      stalenessMs: err ? (prev?.lastOkAt ? Date.now() - prev.lastOkAt : Infinity) : 0,
    };
    this.cb.onStatus?.({ ...this.status });
    this.emit();
  }

  // ---- refreshers ---------------------------------------------------------

  /** /key + /credits (balance) → keys row + settings. */
  async refreshCredits(): Promise<KeyStatus> {
    try {
      const key = await this.client.getKeyStatus();
      const raw = (await this.creds.getKey()) ?? '';
      await upsertKeyRow(this.db, {
        hash: shortHash(raw),
        label: key.label,
        isManagement: key.isManagementKey ? 1 : 0,
        limit: key.limit,
        limitRemaining: key.limitRemaining,
        limitReset: key.limitReset,
        usageMonthly: key.usageMonthly,
        usageDaily: key.usageDaily,
        expiresAt: key.expiresAt,
        updatedAt: new Date().toISOString(),
      });
      await setSetting(this.db, HASH_KEY_SETTING, shortHash(raw));
      await setSetting(this.db, HASH_PREFIX_SETTING, raw.slice(0, 9));
      // account balance is a benefit (verified 200 on standard keys);
      // degrade silently if OpenRouter ever restricts it (403).
      try {
        const credits = await this.client.getCredits();
        await setSetting(this.db, 'account.total_credits', String(credits.totalCredits));
        await setSetting(this.db, 'account.total_usage', String(credits.totalUsage));
      } catch {
        // balanced card simply hides the account row (spec §5.1 note)
      }
      this.touch('credits');
      this.cb.onKey?.(key);
      return key;
    } catch (e) {
      this.touch('credits', String(e instanceof Error ? e.message : e));
      this.cb.onError?.('credits', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  /** No-op without a management key (403 otherwise; spec §5.3). */
  async refreshActivity(): Promise<ActivityRow[] | null> {
    if (!(await this.creds.isManagementKey())) {
      this.touch('activity', 'management key required');
      return null;
    }
    try {
      const page = await this.client.getActivity();
      const rows = page.data.map(toActivityRow).filter((r) => r !== null) as ActivityRow[];
      if (rows.length) await upsertActivityRows(this.db, rows);

      const today = fmtDay(new Date());
      await pruneActivityOlderThan(this.db, addDays(today, -POLL.ACTIVITY_RETENTION_DAYS));
      const keep = await getActivityRows(this.db, { fromDay: addDays(today, -ACTIVITY_WINDOW_DAYS) });
      if (keep.length) await replaceDailyRollups(this.db, computeDailyRollups(keep));

      this.touch('activity');
      const all = await getActivityRows(this.db, {
        fromDay: addDays(today, -ACTIVITY_WINDOW_DAYS),
        limit: 2000,
      });
      this.cb.onActivity?.(all);
      return all;
    } catch (e) {
      this.touch('activity', String(e instanceof Error ? e.message : e));
      this.cb.onError?.('activity', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  async refreshProviders(): Promise<Provider[]> {
    try {
      const providers = await this.client.listProviders();
      for (const p of providers) await upsertProviderRow(this.db, p);
      this.touch('providers');
      this.cb.onProviders?.(providers);
      return providers;
    } catch (e) {
      this.touch('providers', String(e instanceof Error ? e.message : e));
      this.cb.onError?.('providers', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  async refreshModels(): Promise<void> {
    try {
      const { models } = await this.client.listModelsUser();
      await setSetting(this.db, 'models_user_count', String(models.length));
      await setSetting(this.db, 'models_user_cache_at', String(Date.now()));
      this.touch('models');
    } catch (e) {
      this.touch('models', String(e instanceof Error ? e.message : e));
      this.cb.onError?.('models', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  /** One full pass — used at onboarding and on manual refresh. */
  async refreshAll(): Promise<void> {
    await this.refreshCredits();
    await this.refreshActivity();
    await this.refreshProviders();
    await this.refreshModels();
  }

  // ---- scheduler ----------------------------------------------------------

  start(foreground = true): void {
    this.foreground = foreground;
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  setMode(foreground: boolean): void {
    if (!this.running || this.foreground === foreground) return;
    this.foreground = foreground;
    this.stopTimers();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.stopTimers();
  }

  private stopTimers(): void {
    for (const t of this.timers) t.stop();
    this.timers = [];
  }

  private schedule(): void {
    const creditsEvery = this.foreground ? POLL.CREDITS_FOREGROUND_MS : POLL.CREDITS_BACKGROUND_MS;
    this.timers = [
      every(creditsEvery, () => {
        void this.refreshCredits().catch(() => undefined);
      }),
      every(POLL.ACTIVITY_FOREGROUND_MS, () => {
        void this.refreshActivity().catch(() => undefined);
      }),
      every(POLL.SNAPSHOT_DAILY_MS, () => {
        void this.refreshProviders().catch(() => undefined);
        void this.refreshModels().catch(() => undefined);
      }),
    ];
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }
}

/** Cache freshness helpers for the UI ("stale" badge, spec §7). */
export function isStale(lastOkAt: number | undefined, maxMs: number): boolean {
  return lastOkAt === undefined || Date.now() - lastOkAt > maxMs;
}
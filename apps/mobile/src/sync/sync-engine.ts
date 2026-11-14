/**
 * OpenRator — provider sync engine / orchestrator (M7.6).
 *
 * One adapter per configured provider. Each provider refreshes independently:
 * a failure in one provider or one source never prevents the others from
 * completing. Timers are setTimeout-based (works on RN without extra deps).
 */

import { ACTIVITY_WINDOW_DAYS, POLL } from '../core/config';
import { OpenRouterClient } from '../core/client';
import { CredentialService } from '../core/credentials';
import { planInfoSettingEntries, planWindowSettingEntries } from '../core/plan';
import { addDays, computeDailyRollups, fmtDay } from './rollups';
import { SqlDb } from '../store/db';
import {
  getActivityRows,
  pruneActivityOlderThan,
  replaceDailyRollups,
  setProviderSetting,
  setSetting,
  upsertActivityRows,
  upsertKeyRow,
  upsertProviderRows,
} from '../store/daos';
import { ActivityRow, Provider } from '../core/types';
import {
  AccountSnapshot,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderId,
  ProviderManagement,
} from '../providers/types';
import { fixedOpenRouterAdapter } from '../providers/openrouter/adapter';

export type SourceName = 'credits' | 'balance' | 'activity' | 'providers' | 'models';

export interface SyncStatus {
  [source: string]: { lastOkAt?: number; error?: string; stalenessMs: number };
}

export interface SyncCallbacks {
  onStatus?: (status: SyncStatus) => void;
  onKey?: (snapshot: AccountSnapshot) => void;
  onActivity?: (rows: ActivityRow[]) => void;
  onProviders?: (providers: Provider[]) => void;
  onError?: (source: SourceName, err: Error) => void;
}

type EngineSource = OpenRouterClient | ProviderAdapter | ProviderAdapter[];

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

const isAdapter = (value: EngineSource): value is ProviderAdapter =>
  typeof value === 'object' && value !== null && 'capabilities' in value && 'id' in value;

export class SyncEngine {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();
  private readonly statuses = new Map<ProviderId, SyncStatus>();
  private timers: Timer[] = [];
  private foreground = true;
  private running = false;
  private listeners = new Set<() => void>();
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    source: EngineSource,
    private readonly creds: CredentialService,
    private readonly db: SqlDb,
    private readonly cb: SyncCallbacks = {},
  ) {
    if (source instanceof OpenRouterClient) {
      this.adapters.set('openrouter', fixedOpenRouterAdapter(source));
    } else if (Array.isArray(source)) {
      for (const adapter of source) this.adapters.set(adapter.id, adapter);
    } else if (isAdapter(source)) {
      this.adapters.set(source.id, source);
    }
    for (const id of this.adapters.keys()) this.statuses.set(id, {});
  }

  // ---- provider registry ---------------------------------------------------

  getProviders(): ProviderId[] {
    return Array.from(this.adapters.keys());
  }

  hasProvider(provider: ProviderId): boolean {
    return this.adapters.has(provider);
  }

  addAdapter(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
    if (!this.statuses.has(adapter.id)) this.statuses.set(adapter.id, {});
    this.emit();
  }

  getAdapter(provider: ProviderId): ProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  getCapabilities(provider: ProviderId) {
    return this.adapters.get(provider)?.capabilities;
  }

  /**
   * Backwards-compatible management façade. Only providers that expose
   * management operations (OpenRouter today) return a usable object.
   */
  get management(): ProviderManagement {
    for (const adapter of this.adapters.values()) {
      if (adapter.management) return adapter.management;
    }
    throw new Error('This provider does not expose management operations');
  }

  /** @deprecated use `management`; kept so v0.1 panes keep compiling. */
  get client(): ProviderManagement {
    return this.management;
  }

  // ---- subscriptions -------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private statusFor(provider: ProviderId): SyncStatus {
    let status = this.statuses.get(provider);
    if (!status) {
      status = {};
      this.statuses.set(provider, status);
    }
    return status;
  }

  private touch(provider: ProviderId, source: SourceName, err?: string) {
    const status = this.statusFor(provider);
    const prev = status[source];
    status[source] = {
      lastOkAt: err ? prev?.lastOkAt : Date.now(),
      error: err,
      stalenessMs: err ? (prev?.lastOkAt ? Date.now() - prev.lastOkAt : Infinity) : 0,
    };
    this.cb.onStatus?.({ ...status });
    this.emit();
  }

  // ---- refreshers ---------------------------------------------------------

  private requireAdapter(provider: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`Provider ${provider} is not configured`);
    return adapter;
  }

  private async credential(provider: ProviderId) {
    return this.creds.getCredential(provider);
  }

  /**
   * Keeps a handle on every refresh so `stop()` can wait for network reads
   * whose writes may still be pending.
   */
  private track<T>(work: Promise<T>): Promise<T> {
    this.inFlight.add(work);
    const done = () => {
      this.inFlight.delete(work);
    };
    void work.then(done, done);
    return work;
  }

  /** Account + key windows + balance → keys row + settings. */
  async refreshCredits(provider: ProviderId = 'openrouter'): Promise<AccountSnapshot> {
    return this.track(this.runRefreshCredits(provider));
  }

  private async runRefreshCredits(provider: ProviderId): Promise<AccountSnapshot> {
    const adapter = this.requireAdapter(provider);
    try {
      const credential = await this.credential(provider);
      if (!credential) throw new Error('No credential saved for this provider');
      const snapshot = await adapter.getAccount(credential);
      // A user-entered onboarding label wins over the provider's key label.
      const localLabel = await this.creds.getLabel(provider);

      await upsertKeyRow(this.db, {
        provider,
        hash: snapshot.fingerprint,
        label: localLabel ?? snapshot.label,
        isManagement: snapshot.isManagement ? 1 : 0,
        limit: snapshot.limit,
        limitRemaining: snapshot.limitRemaining,
        limitReset: snapshot.limitReset,
        usageMonthly: snapshot.usageMonthly,
        usageDaily: snapshot.usageDaily,
        usageWeekly: snapshot.usageWeekly,
        expiresAt: snapshot.expiresAt,
        updatedAt: snapshot.updatedAt,
      });

      const hasBalance = snapshot.balanceTotal !== undefined;
      if (hasBalance) {
        await setProviderSetting(
          this.db,
          provider,
          'account.total_credits',
          String(snapshot.balanceTotal),
        );
        await setProviderSetting(
          this.db,
          provider,
          'account.total_usage',
          String(snapshot.balanceUsage ?? 0),
        );
      }
      await setProviderSetting(this.db, provider, 'credential.key_hash', snapshot.fingerprint);
      await setProviderSetting(this.db, provider, 'account.label', snapshot.label);

      // M8: subscription plans (OpenCode Go) persist percent windows so the
      // Home pane can render them after an app restart / offline.
      if (snapshot.plan) {
        for (const entry of planInfoSettingEntries(snapshot.plan)) {
          await setProviderSetting(this.db, provider, entry.key, entry.value);
        }
        const windows = snapshot.planWindows ?? snapshot.plan.windows ?? [];
        for (const entry of planWindowSettingEntries(windows)) {
          await setProviderSetting(this.db, provider, entry.key, entry.value);
        }
      }

      // Preserve v0.1 global settings for the primary provider and legacy UI.
      if (provider === 'openrouter') {
        await setSetting(this.db, 'credential.key_hash', snapshot.fingerprint);
        await setSetting(this.db, 'credential.key_prefix', snapshot.fingerprint.slice(0, 9));
        if (hasBalance) {
          await setSetting(this.db, 'account.total_credits', String(snapshot.balanceTotal));
          await setSetting(this.db, 'account.total_usage', String(snapshot.balanceUsage ?? 0));
        }
      }

      // /key and /credits are separate benefits: a successful key refresh
      // must not make an unavailable or failed balance look fresh. Cached
      // values stay in SQLite and are marked stale until /credits succeeds.
      if (hasBalance) {
        this.touch(provider, 'balance');
      } else if (adapter.capabilities.accountBalance) {
        this.touch(provider, 'balance', 'balance unavailable');
      }

      this.touch(provider, 'credits');
      this.cb.onKey?.(snapshot);
      return snapshot;
    } catch (e) {
      this.touch(provider, 'credits', String(e instanceof Error ? e.message : e));
      this.cb.onError?.('credits', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  /** No-op without a management credential or capability (spec §5.3). */
  async refreshActivity(provider: ProviderId = 'openrouter'): Promise<ActivityRow[] | null> {
    return this.track(this.runRefreshActivity(provider));
  }

  private async runRefreshActivity(provider: ProviderId): Promise<ActivityRow[] | null> {
    const adapter = this.requireAdapter(provider);
    if (!adapter.capabilities.activityHistory || !adapter.getUsage) {
      this.touch(provider, 'activity', 'not supported');
      return null;
    }
    const credential = await this.credential(provider);
    // OpenRouter gates /activity behind a management key. Providers that
    // expose activity with the normal key are governed only by capabilities.
    const needsManagement =
      provider === 'openrouter' && !credential?.isManagement && !credential?.managementKey;
    if (!credential || needsManagement) {
      this.touch(provider, 'activity', 'management key required');
      return null;
    }
    try {
      const today = fmtDay(new Date());
      const usage = await adapter.getUsage!(credential, {
        fromDay: addDays(today, -ACTIVITY_WINDOW_DAYS),
        toDay: today,
      });
      const rows: ActivityRow[] = usage.map((u) => ({
        provider: u.provider,
        day: u.day,
        endpoint: u.endpoint,
        apiKeyHash: u.apiKeyHash,
        requests: u.requests,
        spendUsd: u.spendUsd,
        tokens: u.tokens,
      }));
      if (rows.length) await upsertActivityRows(this.db, rows);

      await pruneActivityOlderThan(
        this.db,
        addDays(today, -POLL.ACTIVITY_RETENTION_DAYS),
        provider,
      );
      const keep = await getActivityRows(this.db, {
        provider,
        fromDay: addDays(today, -ACTIVITY_WINDOW_DAYS),
      });
      // Provider-scoped replace drops rollups for days pruned out of activity.
      await replaceDailyRollups(this.db, computeDailyRollups(keep), provider);

      this.touch(provider, 'activity');
      const all = await getActivityRows(this.db, {
        provider,
        fromDay: addDays(today, -ACTIVITY_WINDOW_DAYS),
        limit: 2000,
      });
      this.cb.onActivity?.(all);
      return all;
    } catch (e) {
      this.touch(provider, 'activity', String(e instanceof Error ? e.message : e));
      this.cb.onError?.('activity', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  async refreshProviders(provider: ProviderId = 'openrouter'): Promise<Provider[]> {
    return this.track(this.runRefreshProviders(provider));
  }

  private async runRefreshProviders(provider: ProviderId): Promise<Provider[]> {
    const adapter = this.requireAdapter(provider);
    if (!adapter.capabilities.providerCatalog || !adapter.getCatalog) {
      this.touch(provider, 'providers', 'not supported');
      return [];
    }
    try {
      const credential = await this.credential(provider);
      if (!credential) throw new Error('No credential saved for this provider');
      const entries = await adapter.getCatalog(credential);
      const providers: Provider[] = entries.map((p) => ({
        provider,
        slug: p.slug,
        name: p.name,
        datacenters: p.datacenters,
        statusPageUrl: p.statusPageUrl,
        privacyPolicyUrl: p.privacyPolicyUrl ?? null,
        termsOfServiceUrl: p.termsOfServiceUrl ?? null,
        headquarters: p.headquarters ?? null,
      }));
      await upsertProviderRows(this.db, providers, undefined, provider);
      this.touch(provider, 'providers');
      this.cb.onProviders?.(providers);
      return providers;
    } catch (e) {
      this.touch(provider, 'providers', String(e instanceof Error ? e.message : e));
      this.cb.onError?.('providers', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  async refreshModels(provider: ProviderId = 'openrouter'): Promise<void> {
    return this.track(this.runRefreshModels(provider));
  }

  private async runRefreshModels(provider: ProviderId): Promise<void> {
    const adapter = this.requireAdapter(provider);
    if (!adapter.getModelCount) {
      this.touch(provider, 'models', 'not supported');
      return;
    }
    try {
      const credential = await this.credential(provider);
      if (!credential) throw new Error('No credential saved for this provider');
      const count = await adapter.getModelCount(credential);
      await setProviderSetting(this.db, provider, 'models_user_count', String(count));
      await setProviderSetting(this.db, provider, 'models_user_cache_at', String(Date.now()));
      if (provider === 'openrouter') {
        await setSetting(this.db, 'models_user_count', String(count));
      }
      this.touch(provider, 'models');
    } catch (e) {
      this.touch(provider, 'models', String(e instanceof Error ? e.message : e));
      this.cb.onError?.('models', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  /** One full pass for a single provider, failure-isolated per source. */
  async refreshProvider(provider: ProviderId): Promise<void> {
    return this.track(this.runRefreshProvider(provider));
  }

  private async runRefreshProvider(provider: ProviderId): Promise<void> {
    await this.refreshCredits(provider).catch(() => undefined);
    await Promise.allSettled([
      this.refreshActivity(provider),
      this.refreshProviders(provider),
      this.refreshModels(provider),
    ]);
  }

  /** One full pass across every configured provider. */
  async refreshAll(provider?: ProviderId): Promise<void> {
    return this.track(this.runRefreshAll(provider));
  }

  private async runRefreshAll(provider?: ProviderId): Promise<void> {
    if (provider) {
      await this.refreshProvider(provider);
      return;
    }
    await Promise.allSettled(
      this.getProviders().map((id) => this.refreshProvider(id)),
    );
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

  /**
   * Stops scheduling and waits for refreshes already in flight. Sign-out
   * must not wipe SQLite until those writes have landed.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.stopTimers();
    // A running refresh can start its next source after an await, so drain
    // until no tracked work remains instead of snapshotting once.
    while (this.inFlight.size > 0) {
      await Promise.allSettled(Array.from(this.inFlight));
    }
  }

  private stopTimers(): void {
    for (const t of this.timers) t.stop();
    this.timers = [];
  }

  private schedule(): void {
    const creditsEvery = this.foreground
      ? POLL.CREDITS_FOREGROUND_MS
      : POLL.CREDITS_BACKGROUND_MS;
    this.timers = [];
    for (const provider of this.getProviders()) {
      this.timers.push(
        every(creditsEvery, () => {
          void this.refreshCredits(provider).catch(() => undefined);
        }),
        every(POLL.ACTIVITY_FOREGROUND_MS, () => {
          void this.refreshActivity(provider).catch(() => undefined);
        }),
        every(POLL.SNAPSHOT_DAILY_MS, () => {
          void this.refreshProviders(provider).catch(() => undefined);
          void this.refreshModels(provider).catch(() => undefined);
        }),
      );
    }
  }

  /** Any key value sanity check (create-flow test, M4.5). */
  isManagementKey(provider: ProviderId = 'openrouter'): Promise<boolean> {
    return this.creds.isManagementKey(provider);
  }

  /** Status for one provider (defaults to OpenRouter for v0.1 panes). */
  getStatus(provider: ProviderId = 'openrouter'): SyncStatus {
    return { ...this.statusFor(provider) };
  }

  getAllStatus(): Record<string, SyncStatus> {
    const out: Record<string, SyncStatus> = {};
    for (const [id, status] of this.statuses) out[id] = { ...status };
    return out;
  }
}

/** Cache freshness helpers for the UI ("stale" badge, spec §7). */
export function isStale(lastOkAt: number | undefined, maxMs: number): boolean {
  return lastOkAt === undefined || Date.now() - lastOkAt > maxMs;
}

/**
 * Staleness across a provider scope, ignoring providers that do not support
 * the source at all (their `lastOkAt` is intentionally never set).
 */
export function isScopeStale(
  engine: Pick<SyncEngine, 'getCapabilities' | 'getStatus'>,
  providers: ProviderId[],
  source: SourceName,
  capability: keyof ProviderCapabilities,
  maxMs: number,
): boolean {
  return providers
    .filter((id) => engine.getCapabilities(id)?.[capability])
    .some((id) => isStale(engine.getStatus(id)[source]?.lastOkAt, maxMs));
}

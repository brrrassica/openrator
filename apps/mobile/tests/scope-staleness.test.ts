import { describe, expect, it } from 'vitest';
import { ProviderCapabilities, ProviderId } from '../src/providers/types';
import { isScopeStale, SyncEngine, SyncStatus } from '../src/sync/sync-engine';

const caps = (activityHistory: boolean): ProviderCapabilities => ({
  accountBalance: false,
  spendWindows: false,
  activityHistory,
  keyManagement: false,
  providerCatalog: false,
  routingPolicy: false,
  subscriptionPlan: false,
  planWindows: false,
  manualBudget: false,
});

const fakeEngine = (
  capabilities: Partial<Record<ProviderId, ProviderCapabilities>>,
  statuses: Partial<Record<ProviderId, SyncStatus>>,
): Pick<SyncEngine, 'getCapabilities' | 'getStatus'> => ({
  getCapabilities: (id: ProviderId) => capabilities[id],
  getStatus: (id: ProviderId) => statuses[id] ?? {},
});

describe('isScopeStale', () => {
  const maxMs = 60_000;
  const fresh = { activity: { lastOkAt: Date.now(), stalenessMs: 0 } };

  it('ignores providers that do not support the source', () => {
    const engine = fakeEngine(
      { openrouter: caps(true), 'opencode-go': caps(false) },
      { openrouter: fresh },
    );
    expect(isScopeStale(engine, ['openrouter', 'opencode-go'], 'activity', 'activityHistory', maxMs)).toBe(
      false,
    );
  });

  it('reports stale when a supported provider has no successful sync', () => {
    const engine = fakeEngine(
      { openrouter: caps(true), 'opencode-go': caps(false) },
      {},
    );
    expect(isScopeStale(engine, ['openrouter', 'opencode-go'], 'activity', 'activityHistory', maxMs)).toBe(
      true,
    );
  });

  it('reports fresh when no provider in scope supports the source', () => {
    const engine = fakeEngine({ 'opencode-go': caps(false) }, {});
    expect(isScopeStale(engine, ['opencode-go'], 'activity', 'activityHistory', maxMs)).toBe(false);
  });
});

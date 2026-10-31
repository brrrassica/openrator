/**
 * OpenRator — OpenCode Zen adapter (fixture-backed, M7.8 / M8).
 *
 * OpenCode Zen is the pay-as-you-go product. The API reports balances in
 * microcents; this adapter normalizes everything to USD so screens and the
 * store never see provider-specific units. Live transport stays gated until
 * M8.1 verifies the endpoints.
 */

import { shortHash } from '../../core/fingerprint';
import { getDescriptor } from '../registry';
import {
  AccountSnapshot,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderCatalogEntry,
  ProviderCredential,
  ProviderDescriptor,
  ProviderId,
  UsageRange,
  UsageRecord,
} from '../types';
import { microcentsToUsd } from '../opencode/common';

export interface ZenFixture {
  account?: Partial<AccountSnapshot> & {
    key?: string;
    /** Raw Zen wire values; converted to USD below. */
    balanceMicrocents?: number;
    usageMicrocents?: number;
    usageDailyMicrocents?: number;
    usageWeeklyMicrocents?: number;
    usageMonthlyMicrocents?: number;
  };
  usage?: UsageRecord[];
  catalog?: ProviderCatalogEntry[];
}

/** Prefer an explicit USD field, otherwise convert the microcent wire value. */
function usd(
  explicit: number | undefined,
  microcents: number | undefined,
): number | undefined {
  if (explicit !== undefined) return explicit;
  if (microcents !== undefined) return microcentsToUsd(microcents);
  return undefined;
}

export class OpenCodeZenAdapter implements ProviderAdapter {
  readonly id: ProviderId = 'opencode-zen';
  readonly descriptor: ProviderDescriptor = getDescriptor('opencode-zen');
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly fixture: ZenFixture = {}) {
    // Fixtures may explicitly advertise extra capabilities for contract tests.
    this.capabilities = {
      ...this.descriptor.capabilities,
      accountBalance: Boolean(fixture.account),
      activityHistory: Array.isArray(fixture.usage),
      providerCatalog: Array.isArray(fixture.catalog),
    };
  }

  validateCredential(key: string): boolean {
    return this.descriptor.keyPattern.test(key.trim());
  }

  async testCredential(key: string): Promise<AccountSnapshot> {
    return this.getAccount({ provider: this.id, key, isManagement: false });
  }

  async getAccount(credential: ProviderCredential): Promise<AccountSnapshot> {
    const account = this.fixture.account;
    if (!account) {
      throw new Error('OpenCode Zen API is not verified yet (M8.1)');
    }
    const balanceTotal = usd(account.balanceTotal, account.balanceMicrocents);
    const balanceUsage = usd(account.balanceUsage, account.usageMicrocents);
    return {
      provider: this.id,
      label: account.label ?? 'OpenCode Zen',
      isManagement: false,
      limit: account.limit ?? 0,
      limitRemaining: account.limitRemaining ?? 0,
      limitReset: account.limitReset ?? null,
      usage: account.usage ?? balanceUsage ?? 0,
      usageDaily: usd(account.usageDaily, account.usageDailyMicrocents) ?? 0,
      usageWeekly: usd(account.usageWeekly, account.usageWeeklyMicrocents) ?? 0,
      usageMonthly: usd(account.usageMonthly, account.usageMonthlyMicrocents) ?? 0,
      expiresAt: account.expiresAt ?? null,
      balanceTotal,
      balanceUsage,
      plan: account.plan ?? null,
      fingerprint: shortHash(credential.key),
      updatedAt: new Date().toISOString(),
    };
  }

  async getUsage(
    _credential: ProviderCredential,
    _range: UsageRange,
  ): Promise<UsageRecord[]> {
    return (this.fixture.usage ?? []).map((u) => ({ ...u, provider: this.id }));
  }

  async getCatalog(_credential: ProviderCredential): Promise<ProviderCatalogEntry[]> {
    return (this.fixture.catalog ?? []).map((c) => ({ ...c, provider: this.id }));
  }

  async getModelCount(): Promise<number> {
    return this.fixture.catalog?.length ?? 0;
  }
}

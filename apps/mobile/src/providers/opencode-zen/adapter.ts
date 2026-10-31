/**
 * OpenRator — OpenCode Zen adapter (fixture-backed, M7.8).
 *
 * Live transport is intentionally gated until M8.1 verifies the API. The
 * adapter already speaks the normalized contract so the orchestrator and UI
 * can be exercised against fixtures without pretending a metric exists.
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

export interface ZenFixture {
  account?: Partial<AccountSnapshot> & { key?: string };
  usage?: UsageRecord[];
  catalog?: ProviderCatalogEntry[];
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
    return {
      provider: this.id,
      label: account.label ?? 'OpenCode Zen',
      isManagement: false,
      limit: account.limit ?? 0,
      limitRemaining: account.limitRemaining ?? 0,
      limitReset: account.limitReset ?? null,
      usage: account.usage ?? 0,
      usageDaily: account.usageDaily ?? 0,
      usageWeekly: account.usageWeekly ?? 0,
      usageMonthly: account.usageMonthly ?? 0,
      expiresAt: account.expiresAt ?? null,
      balanceTotal: account.balanceTotal,
      balanceUsage: account.balanceUsage,
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

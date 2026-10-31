/**
 * OpenRator — OpenCode Go adapter (fixture-backed, M8).
 *
 * OpenCode Go is the subscription product: usage is reported as a percentage
 * of the allowance for rolling 5-hour, weekly and monthly windows. The live
 * API is intentionally gated until M8.1 verifies its transport; the adapter
 * already speaks the normalized contract so the sync engine and UI can be
 * exercised against fixtures without pretending a metric exists.
 */

import { shortHash } from '../../core/fingerprint';
import { getDescriptor } from '../registry';
import {
  AccountSnapshot,
  PlanInfo,
  PlanUsageWindow,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderCredential,
  ProviderDescriptor,
  ProviderId,
} from '../types';
import { clampPct } from '../opencode/common';

export interface GoFixture {
  account?: Partial<AccountSnapshot> & { key?: string };
  plan?: Partial<PlanInfo> & { windows?: PlanUsageWindow[] };
}

function normalizeWindows(windows: PlanUsageWindow[] | undefined): PlanUsageWindow[] {
  return (windows ?? []).map((w) => ({
    window: w.window,
    usedPct: clampPct(w.usedPct),
    resetsAt: w.resetsAt ?? null,
  }));
}

export class OpenCodeGoAdapter implements ProviderAdapter {
  readonly id: ProviderId = 'opencode-go';
  readonly descriptor: ProviderDescriptor = getDescriptor('opencode-go');
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly fixture: GoFixture = {}) {
    // A fixture can advertise an account snapshot for contract tests; the
    // descriptor's plan capabilities are always on because they define Go.
    this.capabilities = {
      ...this.descriptor.capabilities,
      accountBalance: Boolean(fixture.account),
    };
  }

  validateCredential(key: string): boolean {
    return this.descriptor.keyPattern.test(key.trim());
  }

  async testCredential(key: string): Promise<AccountSnapshot> {
    return this.getAccount({ provider: this.id, key, isManagement: false });
  }

  async getAccount(credential: ProviderCredential): Promise<AccountSnapshot> {
    const account = this.fixture.account ?? this.fixture.plan;
    if (!account) {
      throw new Error('OpenCode Go API is not verified yet (M8.1)');
    }
    const plan: PlanInfo | null = this.fixture.plan
      ? {
          name: this.fixture.plan.name ?? 'OpenCode Go',
          status: this.fixture.plan.status ?? 'active',
          renewsAt: this.fixture.plan.renewsAt ?? null,
          amountUsd: this.fixture.plan.amountUsd ?? null,
          windows: normalizeWindows(this.fixture.plan.windows),
        }
      : null;
    return {
      provider: this.id,
      label: this.fixture.account?.label ?? plan?.name ?? 'OpenCode Go',
      isManagement: false,
      // Go has no dollar limit on the key; the plan windows are the limit.
      limit: this.fixture.account?.limit ?? 0,
      limitRemaining: this.fixture.account?.limitRemaining ?? 0,
      limitReset: this.fixture.account?.limitReset ?? null,
      usage: this.fixture.account?.usage ?? 0,
      usageDaily: this.fixture.account?.usageDaily ?? 0,
      usageWeekly: this.fixture.account?.usageWeekly ?? 0,
      usageMonthly: this.fixture.account?.usageMonthly ?? 0,
      expiresAt: this.fixture.account?.expiresAt ?? null,
      balanceTotal: this.fixture.account?.balanceTotal,
      balanceUsage: this.fixture.account?.balanceUsage,
      plan,
      planWindows: plan?.windows ?? [],
      fingerprint: shortHash(credential.key),
      updatedAt: new Date().toISOString(),
    };
  }
}

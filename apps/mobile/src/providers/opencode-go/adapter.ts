/**
 * OpenRator — OpenCode Go adapter (live, M8.1).
 *
 * OpenCode Go is the subscription product: usage is reported as a percentage
 * of the allowance for rolling 5-hour, weekly and monthly windows.
 *
 * Live transport (verified 2026-11-01):
 *   GET https://opencode.ai/zen/go/v1/usage
 *   Authorization: Bearer oc_sk_...
 *
 * Fixtures remain supported for contract tests; when none is supplied the
 * adapter performs the live call and normalizes the response.
 */

import { FetchLike } from '../../core/http';
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
import {
  OpenCodeClient,
  isGoUsageLimited,
  parseGoUsage,
} from '../opencode/client';

export interface GoFixture {
  account?: Partial<AccountSnapshot> & { key?: string };
  plan?: Partial<PlanInfo> & { windows?: PlanUsageWindow[] };
}

export interface OpenCodeGoAdapterOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  /** Inject a client in tests instead of building one per credential. */
  client?: OpenCodeClient;
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

  constructor(
    private readonly fixture: GoFixture = {},
    private readonly opts: OpenCodeGoAdapterOptions = {},
  ) {
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

  private clientFor(credential: ProviderCredential): OpenCodeClient {
    if (this.opts.client) return this.opts.client;
    return new OpenCodeClient({
      apiKey: credential.key,
      baseUrl: this.opts.baseUrl ?? this.descriptor.baseUrl,
      fetchFn: this.opts.fetchFn,
      timeoutMs: this.opts.timeoutMs,
      maxRetries: this.opts.maxRetries,
    });
  }

  async getAccount(credential: ProviderCredential): Promise<AccountSnapshot> {
    // Fixtures are still supported for contract tests; a bare adapter now
    // performs the verified live call instead of throwing.
    if (!this.fixture.account && !this.fixture.plan) {
      return this.liveAccount(credential);
    }
    const account = this.fixture.account ?? this.fixture.plan;
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

  /** Live path: normalize the verified `/zen/go/v1/usage` response. */
  private async liveAccount(credential: ProviderCredential): Promise<AccountSnapshot> {
    const body = await this.clientFor(credential).getGoUsageResponse();
    const windows = parseGoUsage(body);
    const limited = isGoUsageLimited(body);
    const renewsAt = windows.find((w) => w.window === 'monthly')?.resetsAt ?? null;
    const plan: PlanInfo = {
      name: 'OpenCode Go',
      status: limited ? 'limited' : 'active',
      renewsAt,
      amountUsd: null,
      windows,
    };
    return {
      provider: this.id,
      label: 'OpenCode Go',
      isManagement: false,
      limit: 0,
      limitRemaining: 0,
      limitReset: null,
      usage: 0,
      usageDaily: 0,
      usageWeekly: 0,
      usageMonthly: 0,
      expiresAt: null,
      plan,
      planWindows: windows,
      fingerprint: shortHash(credential.key),
      updatedAt: new Date().toISOString(),
    };
  }
}

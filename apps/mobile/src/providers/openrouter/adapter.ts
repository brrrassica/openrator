/**
 * OpenRator — OpenRouter adapter (M7.3).
 *
 * Wraps OpenRouterClient with the normalized ProviderAdapter contract. The
 * existing v0.1 client remains untouched for its endpoint-level tests; this
 * class is the only place screens/sync should reach OpenRouter through.
 */

import { OpenRouterClient } from '../../core/client';
import { shortHash } from '../../core/fingerprint';
import { AdminKey, AdminKeyCreated, Preset, PresetConfig } from '../../core/types';
import { FetchLike } from '../../core/http';
import { getDescriptor } from '../registry';
import {
  AccountSnapshot,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderCatalogEntry,
  ProviderCredential,
  ProviderDescriptor,
  ProviderId,
  ProviderManagement,
  RoutingPolicy,
  UsageRange,
  UsageRecord,
} from '../types';

export interface OpenRouterAdapterOptions {
  /** Fixed client for tests / legacy wiring. */
  client?: OpenRouterClient;
  /** Optional transport overrides for live clients. */
  baseUrl?: string;
  fetchFn?: FetchLike;
  /** Resolves the stored credential for management operations. */
  getCredential?: () => Promise<ProviderCredential | null>;
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id: ProviderId = 'openrouter';
  readonly descriptor: ProviderDescriptor = getDescriptor('openrouter');
  readonly capabilities: ProviderCapabilities = this.descriptor.capabilities;
  readonly management: ProviderManagement;

  constructor(private readonly opts: OpenRouterAdapterOptions = {}) {
    this.management = {
      listKeys: () => this.managementClient().then((c) => c.listAdminKeys()),
      createKey: (body) => this.managementClient().then((c) => c.createAdminKey(body)),
      patchKey: (hash, body) => this.managementClient().then((c) => c.patchAdminKey(hash, body)),
      deleteKey: (hash) => this.managementClient().then((c) => c.deleteAdminKey(hash)),
      listPresets: () => this.managementClient().then((c) => c.listPresets()),
      upsertPreset: (slug, config) =>
        this.managementClient().then((c) => c.upsertPreset(slug, config)),
      testRawKey: async (rawKey) => {
        const status = await this.rawClient(rawKey).getKeyStatus();
        return { label: status.label, isManagementKey: status.isManagementKey };
      },
    };
  }

  private client(credential: ProviderCredential, management = false): OpenRouterClient {
    if (this.opts.client) return this.opts.client;
    const key = management
      ? credential.managementKey || credential.key
      : credential.key;
    return new OpenRouterClient({
      apiKey: key,
      baseUrl: this.opts.baseUrl ?? this.descriptor.baseUrl,
      fetchFn: this.opts.fetchFn,
    });
  }

  private rawClient(rawKey: string): OpenRouterClient {
    return new OpenRouterClient({
      apiKey: rawKey,
      baseUrl: this.opts.baseUrl ?? this.descriptor.baseUrl,
      fetchFn: this.opts.fetchFn,
    });
  }

  private async managementClient(): Promise<OpenRouterClient> {
    const credential = this.opts.getCredential
      ? await this.opts.getCredential()
      : null;
    if (!credential) throw new Error('OpenRouter credential is not available');
    return this.client(credential, true);
  }

  validateCredential(key: string): boolean {
    return this.descriptor.keyPattern.test(key.trim());
  }

  async testCredential(key: string): Promise<AccountSnapshot> {
    const credential: ProviderCredential = {
      provider: this.id,
      key,
      isManagement: false,
    };
    return this.snapshotFrom(this.rawClient(key), credential);
  }

  async getAccount(credential: ProviderCredential): Promise<AccountSnapshot> {
    return this.snapshotFrom(this.client(credential), credential);
  }

  private async snapshotFrom(
    client: OpenRouterClient,
    credential: ProviderCredential,
  ): Promise<AccountSnapshot> {
    const key = await client.getKeyStatus();
    let balanceTotal: number | undefined;
    let balanceUsage: number | undefined;
    try {
      const credits = await client.getCredits();
      balanceTotal = credits.totalCredits;
      balanceUsage = credits.totalUsage;
    } catch {
      // /credits is a benefit; 403 hides the account row (v0.1 behaviour).
    }
    return {
      provider: this.id,
      label: key.label,
      isManagement: key.isManagementKey,
      limit: key.limit,
      limitRemaining: key.limitRemaining,
      limitReset: key.limitReset,
      usage: key.usage,
      usageDaily: key.usageDaily,
      usageWeekly: key.usageWeekly,
      usageMonthly: key.usageMonthly,
      byokUsage: key.byokUsage,
      byokUsageDaily: key.byokUsageDaily,
      byokUsageWeekly: key.byokUsageWeekly,
      byokUsageMonthly: key.byokUsageMonthly,
      expiresAt: key.expiresAt,
      balanceTotal,
      balanceUsage,
      plan: null,
      fingerprint: shortHash(credential.key),
      updatedAt: new Date().toISOString(),
    };
  }

  async getUsage(
    credential: ProviderCredential,
    _range: UsageRange,
  ): Promise<UsageRecord[]> {
    const page = await this.client(credential, true).getActivityAll();
    const out: UsageRecord[] = [];
    for (const rec of page.data) {
      if (!rec.date || !/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) continue;
      out.push({
        provider: this.id,
        day: rec.date,
        endpoint: rec.endpoint && rec.endpoint.length ? rec.endpoint : 'unknown',
        apiKeyHash: String(rec.apiKeyHash ?? ''),
        requests: Math.max(0, Math.round(Number(rec.requests ?? 0))),
        spendUsd: Math.max(0, Number(rec.spendUsd ?? rec.spend_usd ?? 0)),
        tokens: Math.max(0, Math.round(Number(rec.tokens ?? 0))),
      });
    }
    return out;
  }

  async getCatalog(credential: ProviderCredential): Promise<ProviderCatalogEntry[]> {
    const providers = await this.client(credential).listProviders();
    return providers.map((p) => ({
      provider: this.id,
      slug: p.slug,
      name: p.name,
      datacenters: Array.isArray(p.datacenters) ? p.datacenters : [],
      statusPageUrl: p.statusPageUrl ?? null,
      privacyPolicyUrl: p.privacyPolicyUrl ?? null,
      termsOfServiceUrl: p.termsOfServiceUrl ?? null,
      headquarters: p.headquarters ?? null,
    }));
  }

  async getModelCount(credential: ProviderCredential): Promise<number> {
    const { models } = await this.client(credential).listModelsUser();
    return models.length;
  }

  async getRoutingPolicy(credential: ProviderCredential): Promise<RoutingPolicy | null> {
    const presets = await this.client(credential, true).listPresets();
    const wanted = presets.find((p) => p.status !== 'archived') ?? presets[0] ?? null;
    return wanted ? { slug: wanted.slug, config: wanted.designatedVersion?.config ?? {} } : null;
  }
}

/** Create an adapter bound to a fixed client (tests, v0.1 compatibility). */
export function fixedOpenRouterAdapter(client: OpenRouterClient): OpenRouterAdapter {
  return new OpenRouterAdapter({ client });
}

/** Create an adapter that reads the stored credential for every management call. */
export function createOpenRouterAdapter(
  getCredential: () => Promise<ProviderCredential | null>,
  opts: Omit<OpenRouterAdapterOptions, 'getCredential'> = {},
): OpenRouterAdapter {
  return new OpenRouterAdapter({ ...opts, getCredential });
}

/** Re-export useful shapes for adapter tests without leaking the client. */
export type { AdminKey, AdminKeyCreated, Preset, PresetConfig };

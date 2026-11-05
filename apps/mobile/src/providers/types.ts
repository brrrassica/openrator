/**
 * OpenRator — normalized provider domain model (M7.1).
 *
 * Screens and the store consume only these shapes. Provider-specific wire
 * formats stay inside each adapter. Types here deliberately avoid importing
 * React or any provider client so they remain unit-testable.
 */

import { AdminKey, AdminKeyCreated, Preset, PresetConfig } from '../core/types';

export const PROVIDER_IDS = ['openrouter', 'opencode-go', 'opencode-zen'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderCapabilities {
  accountBalance: boolean;
  spendWindows: boolean;
  activityHistory: boolean;
  keyManagement: boolean;
  providerCatalog: boolean;
  routingPolicy: boolean;
  subscriptionPlan: boolean;
  /** Subscription usage measured as a percentage per rolling window (Go). */
  planWindows: boolean;
  /** Provider can only be tracked through user-entered manual amounts. */
  manualBudget: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  shortName: string;
  /** API base URL. Empty until the M8 spike verifies a live endpoint. */
  baseUrl: string;
  /** Dashboard URL for deep links when an API cannot express a metric. */
  dashboardUrl: string;
  docsUrl: string;
  /** Key format gate used by onboarding. */
  keyPattern: RegExp;
  keyHint: string;
  capabilities: ProviderCapabilities;
  /** Whether the workspace supports a separate management credential. */
  supportsManagementKey: boolean;
  /** Provider is offered in v0.2 until its live spike lands (M8). */
  enabled: boolean;
  /** Brand token key (see brand/tokens.json). */
  brandKey: string;
}

export interface ProviderCredential {
  provider: ProviderId;
  /** Primary, least-privilege key. */
  key: string;
  /** Optional management key (OpenRouter only in v0.2). */
  managementKey?: string | null;
  /** True when `key` itself is a management key (legacy v0.1 wiring). */
  isManagement: boolean;
}

export interface AccountSnapshot {
  provider: ProviderId;
  label: string;
  isManagement: boolean;
  /** Key limit in USD (0 = unlimited). */
  limit: number;
  limitRemaining: number;
  limitReset: string | null;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  byokUsage?: number;
  byokUsageDaily?: number;
  byokUsageWeekly?: number;
  byokUsageMonthly?: number;
  expiresAt: string | null;
  /** Account balance when the provider exposes it. */
  balanceTotal?: number;
  balanceUsage?: number;
  /** Subscription/plan card when the provider exposes it. */
  plan?: PlanInfo | null;
  /**
   * Percentage-based plan windows (OpenCode Go). Each window is a share of the
   * plan allowance, not a currency amount.
   */
  planWindows?: PlanUsageWindow[];
  /** Non-secret short fingerprint persisted in SQLite. */
  fingerprint: string;
  updatedAt: string;
}

export type PlanWindowId = 'five_hour' | 'weekly' | 'monthly';

export interface PlanUsageWindow {
  window: PlanWindowId;
  /** Used share of the plan allowance, clamped to 0..100. */
  usedPct: number;
  resetsAt?: string | null;
}

export interface PlanInfo {
  name: string;
  status: string;
  renewsAt?: string | null;
  amountUsd?: number | null;
  /** Percentage windows exposed by subscription plans (OpenCode Go). */
  windows?: PlanUsageWindow[];
}

export interface UsageRange {
  fromDay: string;
  toDay: string;
}

/** One normalized activity row (provider/day/endpoint dimension). */
export interface UsageRecord {
  provider: ProviderId;
  day: string;
  endpoint: string;
  apiKeyHash: string;
  requests: number;
  spendUsd: number;
  tokens: number;
}

export interface KeySummary {
  provider: ProviderId;
  hash: string;
  label: string;
  isManagement: boolean;
  limit: number;
  limitRemaining: number;
  limitReset: string | null;
  usageMonthly: number;
  usageDaily: number;
  usageWeekly: number;
  expiresAt: string | null;
  updatedAt: string;
}

export interface ProviderCatalogEntry {
  provider: ProviderId;
  slug: string;
  name: string;
  datacenters: string[];
  statusPageUrl: string | null;
  privacyPolicyUrl?: string | null;
  termsOfServiceUrl?: string | null;
  headquarters?: string | null;
}

export interface RoutingPolicy {
  slug: string;
  config: PresetConfig;
}

/** Management operations are optional and capability-gated. */
export interface ProviderManagement {
  listKeys(): Promise<AdminKey[]>;
  createKey(body: {
    label?: string;
    limit?: number;
    limitReset?: string;
    includeByokInLimit?: boolean;
    expiresAt?: string;
  }): Promise<AdminKeyCreated>;
  patchKey(
    hash: string,
    body: {
      label?: string;
      limit?: number;
      limitReset?: string | null;
      includeByokInLimit?: boolean;
      expiresAt?: string | null;
    },
  ): Promise<AdminKey>;
  deleteKey(hash: string): Promise<void>;
  listPresets(): Promise<Preset[]>;
  upsertPreset(slug: string, config: PresetConfig): Promise<Preset>;
  testRawKey(rawKey: string): Promise<{ label: string; isManagementKey: boolean }>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly descriptor: ProviderDescriptor;
  readonly capabilities: ProviderCapabilities;
  readonly management?: ProviderManagement;

  validateCredential(key: string): boolean;
  testCredential(key: string): Promise<AccountSnapshot>;
  getAccount(credential: ProviderCredential): Promise<AccountSnapshot>;
  getUsage?(credential: ProviderCredential, range: UsageRange): Promise<UsageRecord[]>;
  getCatalog?(credential: ProviderCredential): Promise<ProviderCatalogEntry[]>;
  getModelCount?(credential: ProviderCredential): Promise<number>;
  getRoutingPolicy?(credential: ProviderCredential): Promise<RoutingPolicy | null>;
}

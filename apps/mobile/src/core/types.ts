/**
 * OpenRator — domain types mapped from the OpenRouter API.
 * Field shapes verified live 2026-10-05 (docs/03-spike-notes.md).
 * Activity types are PROVISIONAL until captured with a management key (M0.5A).
 */

export type ResetWindow = 'daily' | 'weekly' | 'monthly' | null;

/** GET /api/v1/key → data */
export interface KeyStatus {
  label: string;
  isManagementKey: boolean;
  isProvisioningKey: boolean;
  limit: number;
  limitReset: ResetWindow;
  limitRemaining: number;
  includeByokInLimit: boolean;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  byokUsage: number;
  byokUsageDaily: number;
  byokUsageWeekly: number;
  byokUsageMonthly: number;
  isFreeTier: boolean;
  expiresAt: string | null;
  creatorUserId?: string;
  organizationId?: string;
  workspaceId?: string;
  allowedDataRegions?: string[] | null;
  freeModelDailyRequests: { used: number; limit: number; remaining: number };
  rateLimit?: number;
}

/** GET /api/v1/credits → data (works with standard keys as of 2026-10-05). */
export interface Credits {
  totalCredits: number;
  totalUsage: number;
}

/** GET /api/v1/providers → data[] */
export interface Provider {
  name: string;
  slug: string;
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  statusPageUrl: string | null;
  headquarters: string | null;
  datacenters: string[];
  /** Local health stamp (WS2-9) — set from the on-device snapshot, not the API. */
  lastOkAt?: string | null;
  /** Local health state (WS2-9): 'ok' after a successful catalog sync. */
  state?: string | null;
}

/** GET /api/v1/models/user → data[] (filtered by user prefs; read-only). */
export interface ModelRef {
  id: string;
  canonicalSlug: string;
  huggingFaceId: string | null;
  name: string;
  created?: number;
  description?: string;
  contextLength?: number;
  architecture?: unknown;
  pricing?: Record<string, unknown>;
  topProvider?: string | null;
  perRequestLimits?: unknown;
  supportedParameters?: string[];
  defaultParameters?: unknown;
  knowledgeCutoff?: string;
  expirationDate?: string;
}

export interface ModelsUserPage {
  data: ModelRef[];
  totalCount?: number;
  links?: { next?: string | null; prev?: string | null };
}

/** Presets (control surface for provider policy). */
export interface PresetRouting {
  only?: string[];
  order?: string[];
  ignore?: string[];
  sort?: string;
}

export interface PresetConfig {
  model?: string;
  temperature?: number;
  topP?: number;
  system?: string;
  provider?: PresetRouting;
  [k: string]: unknown;
}

export interface PresetVersion {
  id: string;
  presetId: string;
  version: number;
  systemPrompt: string | null;
  config: PresetConfig;
}

export interface Preset {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  designatedVersionId: string;
  createdAt: string;
  updatedAt: string;
  designatedVersion?: PresetVersion;
}

/**
 * PROVISIONAL — GET /api/v1/activity record (M0.5A: capture with a real
 * management key and pin the exact shape; defensive extra fields allowed).
 */
export interface ActivityRecord {
  /** YYYY-MM-DD */
  date: string;
  /** endpoint identifier, e.g. "model-slug:provider-slug" (to pin). */
  endpoint?: string;
  apiKeyHash?: string;
  requests?: number;
  spendUsd?: number;
  tokens?: number;
  [k: string]: unknown;
}

export interface ActivityPage {
  data: ActivityRecord[];
  totalCount?: number;
  links?: { next?: string | null; prev?: string | null };
}

/** Row shape stored in SQLite (normalized, camelCase on read). */
export interface ActivityRow {
  day: string; // YYYY-MM-DD
  endpoint: string;
  apiKeyHash: string;
  requests: number;
  spendUsd: number;
  tokens: number;
}

export interface DailyRollup {
  day: string;
  spendUsd: number;
  requests: number;
  tokens: number;
  byEndpoint: Record<string, { requests: number; spendUsd: number; tokens: number }>;
}

/** settings kv row. */
export interface Setting {
  key: string;
  value: string;
}

/** Current-key card row. */
export interface KeyRow {
  hash: string;
  label: string;
  isManagement: number;
  limit: number;
  limitRemaining: number;
  limitReset: string | null;
  usageMonthly: number;
  usageWeekly: number;
  usageDaily: number;
  expiresAt: string | null;
  updatedAt: string;
}

/**
 * GET /api/v1/keys → data[] (mgmt-key only; 401 for standard keys).
 * The canonical identifier is `hash` — it is what PATCH/DELETE paths use
 * (spec §5.2). `id` is kept optional for responses that also include it.
 */
export interface AdminKey {
  id?: string;
  hash: string;
  label: string;
  created: number;
  limit: number;
  limitRemaining: number;
  limitReset: ResetWindow;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  includeByokInLimit: boolean;
  expiresAt: string | null;
  isManagementKey?: boolean;
  isProvisioningKey?: boolean;
  [k: string]: unknown;
}

/** POST /api/v1/keys → data; `key` holds the one-time full secret. */
export interface AdminKeyCreated extends Partial<AdminKey> {
  hash: string;
  /** Full key value — shown once, never persisted by OpenRator. */
  key: string;
}
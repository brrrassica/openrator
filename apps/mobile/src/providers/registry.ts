/**
 * OpenRator — provider registry and descriptors (M7.2).
 *
 * One place to declare provider identity, transport, credential format and
 * capability gates. Nothing here performs I/O.
 */

import {
  PROVIDER_IDS,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderId,
} from './types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DASHBOARD_URL = 'https://openrouter.ai/settings';

const OPENROUTER_CAPS: ProviderCapabilities = {
  accountBalance: true,
  spendWindows: true,
  activityHistory: true,
  keyManagement: true,
  providerCatalog: true,
  routingPolicy: true,
  subscriptionPlan: false,
  manualBudget: false,
};

/**
 * OpenCode Zen is registered from day one but stays disabled until the M8
 * live spike verifies transport, balance and usage endpoints.
 */
const ZEN_CAPS: ProviderCapabilities = {
  accountBalance: false,
  spendWindows: false,
  activityHistory: false,
  keyManagement: false,
  providerCatalog: false,
  routingPolicy: false,
  subscriptionPlan: false,
  manualBudget: true,
};

export const PROVIDER_DESCRIPTORS: Record<ProviderId, ProviderDescriptor> = {
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    shortName: 'OR',
    baseUrl: OPENROUTER_BASE_URL,
    dashboardUrl: OPENROUTER_DASHBOARD_URL,
    docsUrl: 'https://openrouter.ai/docs',
    keyPattern: /^sk-or-v1-[A-Za-z0-9_-]{20,}$/,
    keyHint: 'Keys start with sk-or-v1- and are at least 20 chars.',
    capabilities: OPENROUTER_CAPS,
    supportsManagementKey: true,
    enabled: true,
    brandKey: 'openrouter',
  },
  'opencode-zen': {
    id: 'opencode-zen',
    displayName: 'OpenCode Zen',
    shortName: 'Zen',
    // Verified in M8.1; intentionally empty until then (no unverified calls).
    baseUrl: '',
    dashboardUrl: '',
    docsUrl: '',
    keyPattern: /^[A-Za-z0-9._-]{16,}$/,
    keyHint: 'Paste the key issued by OpenCode Zen.',
    capabilities: ZEN_CAPS,
    supportsManagementKey: false,
    enabled: false,
    brandKey: 'opencode-zen',
  },
};

export function getDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDER_DESCRIPTORS[id];
}

export function listDescriptors(includeDisabled = false): ProviderDescriptor[] {
  return PROVIDER_IDS.map((id) => PROVIDER_DESCRIPTORS[id]).filter(
    (d) => includeDisabled || d.enabled,
  );
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Small registry wrapper so callers can inject fixtures/tests later. */
export class ProviderRegistry {
  constructor(private readonly descriptors: ProviderDescriptor[] = listDescriptors(true)) {}

  list(includeDisabled = false): ProviderDescriptor[] {
    return this.descriptors.filter((d) => includeDisabled || d.enabled);
  }

  get(id: ProviderId): ProviderDescriptor | undefined {
    return this.descriptors.find((d) => d.id === id);
  }
}

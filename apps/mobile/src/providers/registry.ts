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

/**
 * OpenCode exposes two products under one host. Go's percentage endpoint is
 * verified (M8.1); Zen's balance endpoint is still unverified, so Zen keeps
 * the manual-budget fallback. Both descriptors ship enabled.
 */
const OPENCODE_BASE_URL = 'https://opencode.ai';
const OPENCODE_DASHBOARD_URL = 'https://opencode.ai';

const OPENROUTER_CAPS: ProviderCapabilities = {
  accountBalance: true,
  spendWindows: true,
  activityHistory: true,
  keyManagement: true,
  providerCatalog: true,
  routingPolicy: true,
  subscriptionPlan: false,
  planWindows: false,
  manualBudget: false,
};

/**
 * OpenCode Go — subscription plan. Usage is expressed as a percentage of the
 * allowance over rolling 5-hour, weekly and monthly windows.
 */
const GO_CAPS: ProviderCapabilities = {
  accountBalance: false,
  spendWindows: false,
  activityHistory: false,
  keyManagement: false,
  providerCatalog: false,
  routingPolicy: false,
  subscriptionPlan: true,
  planWindows: true,
  manualBudget: true,
};

/**
 * OpenCode Zen — pay-as-you-go balance reported in microcents. Balance and
 * spend endpoints stay off in the descriptor until their live contract is
 * verified, so the app never renders a fabricated $0.00; the manual-budget
 * fallback covers it.
 */
const ZEN_CAPS: ProviderCapabilities = {
  accountBalance: false,
  spendWindows: false,
  activityHistory: false,
  keyManagement: false,
  providerCatalog: false,
  routingPolicy: false,
  subscriptionPlan: false,
  planWindows: false,
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
  'opencode-go': {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    shortName: 'Go',
    // M8.1 verified: GET /zen/go/v1/usage with a Bearer API key.
    baseUrl: OPENCODE_BASE_URL,
    dashboardUrl: OPENCODE_DASHBOARD_URL,
    docsUrl: 'https://opencode.ai/docs',
    keyPattern: /^[A-Za-z0-9._-]{16,}$/,
    keyHint: 'Keys start with oc_sk_ and are issued by the OpenCode Console.',
    capabilities: GO_CAPS,
    supportsManagementKey: false,
    enabled: true,
    brandKey: 'opencode-go',
  },
  'opencode-zen': {
    id: 'opencode-zen',
    displayName: 'OpenCode Zen',
    shortName: 'Zen',
    // M8.1: base URL/auth are unverified; no live calls are made from this.
    baseUrl: OPENCODE_BASE_URL,
    dashboardUrl: OPENCODE_DASHBOARD_URL,
    docsUrl: 'https://opencode.ai/docs',
    keyPattern: /^[A-Za-z0-9._-]{16,}$/,
    keyHint: 'Paste the key issued by OpenCode Zen.',
    capabilities: ZEN_CAPS,
    supportsManagementKey: false,
    enabled: true,
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

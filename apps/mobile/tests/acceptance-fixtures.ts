/**
 * Fixtures for the M5.5 acceptance checks. They live in the test tree so the
 * `src` secrets guard stays clean (no raw-key literals / third-party URLs).
 */

import { AcceptanceFixtures } from '../src/qa/acceptance';
import { ActivityRow, Provider } from '../src/core/types';

const ACTIVITY: ActivityRow[] = [
  {
    day: '2026-10-04',
    endpoint: 'openai/gpt-4o-mini',
    apiKeyHash: 'h1',
    requests: 12,
    spendUsd: 1,
    tokens: 4000,
  },
  {
    day: '2026-10-04',
    endpoint: 'anthropic/claude-3.5-sonnet',
    apiKeyHash: 'h1',
    requests: 3,
    spendUsd: 2.5,
    tokens: 9000,
  },
  {
    day: '2026-10-05',
    endpoint: 'openai/gpt-4o-mini',
    apiKeyHash: 'h1',
    requests: 5,
    spendUsd: 0.75,
    tokens: 2100,
  },
];

const PROVIDERS: Provider[] = [
  {
    slug: 'openai',
    name: 'OpenAI',
    datacenters: ['us'],
    statusPageUrl: 'https://status.openai.com',
    privacyPolicyUrl: 'https://openai.com/policies/privacy-policy',
    termsOfServiceUrl: 'https://openai.com/policies/terms-of-use',
    headquarters: 'San Francisco',
  },
  {
    slug: 'anthropic',
    name: 'Anthropic',
    datacenters: ['us'],
    statusPageUrl: 'https://status.anthropic.com',
    privacyPolicyUrl: 'https://www.anthropic.com/legal/privacy',
    termsOfServiceUrl: 'https://www.anthropic.com/legal/terms',
    headquarters: 'San Francisco',
  },
];

export const ACCEPTANCE_FIXTURES: AcceptanceFixtures = {
  today: '2026-10-05',
  activity: ACTIVITY,
  reference: { spendUsd: 4.25, requests: 20, tokens: 15100 },
  providers: PROVIDERS,
  keyRow: {
    hash: 'fixture-hash',
    label: 'mgmt-fixture',
    isManagement: 1,
    limit: 10,
    limitRemaining: 3.2,
    limitReset: 'monthly',
    usageMonthly: 6.8,
    usageWeekly: 4.2,
    usageDaily: 1.75,
    expiresAt: null,
    updatedAt: '2026-10-05T00:00:00Z',
  },
  creditsTotal: 65,
  creditsUsage: 48.54,
  managementKey: 'sk-or-v1-acceptance-fixture-0123456789',
};

import { describe, expect, it, vi } from 'vitest';
import { OpenRouterClient } from '../src/core/client';
import { OpenRouterApiError } from '../src/core/errors';

interface FakeRes {
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
}

function res(status: number, body: unknown, headers: Record<string, string> = {}): FakeRes {
  return {
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
  };
}

function makeClient(
  handler: (input: string, init: Record<string, unknown> | undefined) => Promise<FakeRes>,
): {
  client: OpenRouterClient;
  calls: () => Array<{ input: string; init: Record<string, unknown> }>;
  maxInFlight: () => number;
} {
  const calls: Array<{ input: string; init: Record<string, unknown> }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchFn = async (input: string, init?: Record<string, unknown>) => {
    calls.push({ input, init: init ?? {} });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      return await handler(input, init);
    } finally {
      inFlight--;
    }
  };
  const client = new OpenRouterClient({
    apiKey: 'sk-or-v1-test-key-0123456789abcdef',
    baseUrl: 'https://openrouter.ai/api/v1',
    fetchFn,
    maxRetries: 2,
  });
  return { client, calls: () => calls, maxInFlight: () => maxInFlight };
}

describe('OpenRouterClient', () => {
  it('GET /key: sends Bearer auth, parses snake_case + normalizes quota', async () => {
    const { client, calls, maxInFlight } = makeClient(async (input, init) => {
      const auth = (init?.headers as { Authorization?: string } | undefined)?.Authorization;
      expect(auth).toBe('Bearer sk-or-v1-test-key-0123456789abcdef');
      return res(200, {
        data: {
          label: 'homelab',
          is_management_key: false,
          limit: 4,
          limit_remaining: 3.2,
          limit_reset: 'daily',
          usage: 0.8,
          usage_daily: 0.2,
          usage_weekly: 0.5,
          usage_monthly: 1.7,
          byok_usage: 0.1,
          byok_usage_daily: 0,
          byok_usage_weekly: 0.1,
          byok_usage_monthly: 0.1,
          is_free_tier: false,
          expires_at: null,
          free_model_daily_requests: { used: 0, limit: 1000, remaining: 1000 },
        },
      });
    });
    const key = await client.getKeyStatus();
    expect(calls()).toHaveLength(1);
    expect(key.label).toBe('homelab');
    expect(key.isManagementKey).toBe(false);
    expect(key.limitReset).toBe('daily');
    expect(key.freeModelDailyRequests).toEqual({ used: 0, limit: 1000, remaining: 1000 });
    expect(maxInFlight()).toBeLessThanOrEqual(1);
  });

  it('GET /credits: maps total_credits/total_usage', async () => {
    const { client } = makeClient(async () =>
      res(200, { data: { total_credits: 65, total_usage: 48.539975106 } }),
    );
    const c = await client.getCredits();
    expect(c.totalCredits).toBe(65);
    expect(c.totalUsage).toBeCloseTo(48.54, 2);
  });

  it('GET /providers: maps array payload with status_page_url null', async () => {
    const { client } = makeClient(async () =>
      res(200, {
        data: [
          {
            name: 'Ionstream',
            slug: 'ionstream',
            privacy_policy_url: 'https://example.test/p',
            terms_of_service_url: null,
            status_page_url: null,
            headquarters: 'US',
            datacenters: ['US'],
          },
        ],
      }),
    );
    const providers = await client.listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].slug).toBe('ionstream');
    expect(providers[0].statusPageUrl).toBeNull();
  });

  it('GET /activity: provisional shape maps defensively', async () => {
    const { client, calls } = makeClient(async (input) => {
      expect(input).toContain('/activity');
      return res(200, {
        data: [
          { date: '2026-10-04', endpoint: 'deepseek:deepseek', requests: 3, spend_usd: 0.02, tokens: 1200 },
        ],
        total_count: 1,
      });
    });
    const page = await client.getActivity({ date: '2026-10-04' });
    expect(page.totalCount).toBe(1);
    expect(page.data[0].endpoint).toBe('deepseek:deepseek');
    expect(page.data[0].requests).toBe(3);
  });

  it('upsertPreset: POSTs chat-completions body with empty messages (cost-free contract)', async () => {
    const { client, calls } = makeClient(async (input, init) => {
      expect(input).toContain('/presets/my-policy/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body.messages).toEqual([]);
      expect(body.provider.ignore).toContain('moonshotai');
      return res(200, {
        data: {
          id: 'p1',
          slug: 'my-policy',
          name: 'my-policy',
          description: null,
          status: 'active',
          designated_version_id: 'v1',
          created_at: '2026-10-05T00:00:00Z',
          updated_at: '2026-10-05T00:00:00Z',
          designated_version: { id: 'v1', preset_id: 'p1', version: 1, system_prompt: null, config: {} },
        },
      });
    });
    const preset = await client.upsertPreset('my-policy', {
      model: 'openai/gpt-4o-mini',
      provider: { ignore: ['moonshotai'] },
    });
    expect(preset.slug).toBe('my-policy');
    expect(calls()).toHaveLength(1);
  });

  it('retries 429 (honoring Retry-After) then succeeds', async () => {
    let attempts = 0;
    const { client, calls } = makeClient(async () => {
      attempts++;
      if (attempts === 1) return res(429, { error: { message: 'Rate limited', code: 429 } }, { 'Retry-After': '1' });
      return res(200, { data: { total_credits: 1, total_usage: 0 } });
    });
    const credits = await client.getCredits();
    expect(credits.totalCredits).toBe(1);
    expect(calls()).toHaveLength(2);
  });

  it('does NOT retry 401 (auth is not transient)', async () => {
    let attempts = 0;
    const { client, calls } = makeClient(async () => {
      attempts++;
      return res(401, { error: { message: 'Invalid API key', code: 401 } });
    });
    await expect(client.getCredits()).rejects.toBeInstanceOf(OpenRouterApiError);
    expect(attempts).toBe(1);
    expect(calls()).toHaveLength(1);
  });

  it('retries network errors, then succeeds', async () => {
    let attempts = 0;
    const { client, calls } = makeClient(async () => {
      attempts++;
      if (attempts === 1) throw new Error('Network request failed');
      return res(200, { data: { total_credits: 2, total_usage: 0 } });
    });
    const credits = await client.getCredits();
    expect(credits.totalCredits).toBe(2);
    expect(calls()).toHaveLength(2);
  });

  it('serializes concurrent calls (single-flight per key)', async () => {
    let maxConcurrent = 0;
    let concurrent = 0;
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 30));
    const { client } = makeClient(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await gate;
      concurrent--;
      return res(200, { data: { label: 'k', is_management_key: false, limit: 0, limit_remaining: 0, limit_reset: null, usage: 0, usage_daily: 0, usage_weekly: 0, usage_monthly: 0, byok_usage: 0, byok_usage_daily: 0, byok_usage_weekly: 0, byok_usage_monthly: 0, is_free_tier: false, expires_at: null, free_model_daily_requests: { used: 0, limit: 0, remaining: 0 } } });
    });
    await Promise.all([client.getKeyStatus(), client.getKeyStatus(), client.getKeyStatus()]);
    expect(maxConcurrent).toBe(1);
  });
});
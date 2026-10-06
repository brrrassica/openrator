import { describe, expect, it } from 'vitest';
import { OpenRouterClient, testRawKey } from '../src/core/client';

interface FakeRes {
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
}

function res(status: number, body: unknown): FakeRes {
  return {
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function makeAdminClient(
  handler: (input: string, init: Record<string, unknown> | undefined) => Promise<FakeRes>,
): { client: OpenRouterClient; calls: () => Array<{ input: string; init: Record<string, unknown> }> } {
  const calls: Array<{ input: string; init: Record<string, unknown> }> = [];
  const client = new OpenRouterClient({
    apiKey: 'sk-or-v1-mgmt-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    fetchFn: async (input: string, init?: Record<string, unknown>) => {
      calls.push({ input, init: init ?? {} });
      return handler(input, init);
    },
  });
  return { client, calls: () => calls };
}

const ADMIN_KEYS = {
  data: [
    {
      id: 'k1',
      hash: 'sk-or-v1-abc123',
      label: 'prod',
      created: 1699999999,
      limit: 10,
      limit_remaining: 4.2,
      limit_reset: 'monthly',
      usage: 5.8,
      usage_daily: 1,
      usage_weekly: 3,
      usage_monthly: 5.8,
      include_byok_in_limit: false,
      expires_at: '2027-01-01T00:00:00Z',
    },
  ],
};

describe('management-key plane (client)', () => {
  it('lists admin keys with camelCase mapping from /keys', async () => {
    const { client, calls } = makeAdminClient(async (input) => {
      expect(input).toContain('/keys');
      return res(200, ADMIN_KEYS);
    });
    const keys = await client.listAdminKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].id).toBe('k1');
    expect(keys[0].limitReset).toBe('monthly');
    expect(keys[0].includeByokInLimit).toBe(false);
    expect(keys[0].usageMonthly).toBe(5.8);
    expect(calls()).toHaveLength(1);
  });

  it('creates a key with snake_case wire body and returns the onetime secret', async () => {
    const { client, calls } = makeAdminClient(async (_input, init) => {
      const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(sent.name).toBe('t');
      expect(sent.limit).toBe(5);
      expect(sent.limit_reset).toBeUndefined();
      return res(200, { data: { id: 'k2', key: 'sk-or-v1-created-secret', label: 't', limit: 5 } });
    });
    const created = await client.createAdminKey({ name: 't', limit: 5 });
    expect(created.key).toBe('sk-or-v1-created-secret');
    expect(calls()).toHaveLength(1);
  });

  it('patches label/limit with snake_case body', async () => {
    const { client } = makeAdminClient(async (input, init) => {
      expect(input).toContain('/keys/k1');
      const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(sent.label).toBe('renamed');
      expect(sent.limit).toBe(20);
      return res(200, { data: { id: 'k1', label: 'renamed', limit: 20 } });
    });
    const updated = await client.patchAdminKey('k1', { label: 'renamed', limit: 20 });
    expect(updated.label).toBe('renamed');
  });

  it('deletes a key with DELETE verb', async () => {
    const { client, calls } = makeAdminClient(async (input, init) => {
      expect(input).toContain('/keys/k1');
      expect(init?.method).toBe('DELETE');
      return res(200, {});
    });
    await client.deleteAdminKey('k1');
    expect(calls()).toHaveLength(1);
  });

  it('testRawKey proves a created key works via /key', async () => {
    const status = await testRawKey('sk-or-v1-new', {
      fetchFn: async (input: string) => {
        expect(input).toContain('/key');
        return res(200, { data: { label: 'new', is_management_key: false } });
      },
    });
    expect(status.label).toBe('new');
  });
});
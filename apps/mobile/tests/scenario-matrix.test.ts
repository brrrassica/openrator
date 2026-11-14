import { describe, expect, it } from 'vitest';
import { FakeRes, NodeSqlite, jsonRes } from './helpers/sqlite-node';
import {
  clearAllData,
  getActivityRows,
  getDailyRollups,
  getKeyRow,
  getProviderSetting,
  getSetting,
  listProvidersFromDb,
  migrate,
} from '../src/store/daos';
import { SyncEngine } from '../src/sync/sync-engine';
import { CredentialService, MemoryKeyValueStore } from '../src/core/credentials';
import { OpenRouterClient } from '../src/core/client';
import { ActivityRow, PresetConfig, PresetRouting, Provider } from '../src/core/types';
import { computeHomeSummary } from '../src/ui/home-summary';
import { computeSpendSummary } from '../src/ui/spend-summary';
import { ruleFor, setRule, withRouting } from '../src/ui/policy-state';
import { holdsSecret, initialRevealState, revealReducer } from '../src/ui/keys-flow';
import { fmtDay } from '../src/sync/rollups';

/**
 * M5.4 — fixture-driven scenario matrix over real SQLite.
 *
 * Two personas (management key vs standard key) plus offline and paginated
 * variants exercise the request paths behind Home → Spend → Policy → Keys.
 * Every fixture is relative to `today`, so the suite never rots.
 */

const DAY = 86_400_000;
const day = (offset: number): string => fmtDay(new Date(Date.now() + offset * DAY));
const TODAY = day(0);
const YESTERDAY = day(-1);

const DAYS = {
  today: TODAY,
  yesterday: YESTERDAY,
};

const ACTIVITY = [
  { date: DAYS.today, endpoint: 'gpt-4o-mini:openai', api_key_hash: 'h1', requests: 12, spend_usd: 1, tokens: 4000 },
  { date: DAYS.today, endpoint: 'claude-3.5-sonnet:anthropic', api_key_hash: 'h1', requests: 3, spend_usd: 2.5, tokens: 9000 },
  { date: DAYS.yesterday, endpoint: 'gpt-4o-mini:openai', api_key_hash: 'h1', requests: 5, spend_usd: 0.75, tokens: 2100 },
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

const MGMT_KEY = 'sk-or-v1-mgmt-fixture-0123456789abcdef';
const STANDARD_KEY = 'sk-or-v1-standard-fixture-0123456789';

type Persona = 'mgmt' | 'standard';

interface ServerState {
  persona: Persona;
  offline: boolean;
  paginated: boolean;
  presetRouting: PresetRouting;
  /** Force an HTTP status for /key (e.g. 402). */
  keyStatus?: number;
  /** Force an HTTP status for /activity (e.g. 429/500). */
  activityStatus?: number;
  /** Force an HTTP status for /credits (e.g. 403). */
  creditsStatus?: number;
  /** Force the preset write to fail (500). */
  presetWriteFails?: boolean;
  /** Override the /activity payload with malformed fixtures. */
  activityPayload?: unknown[];
}

interface Server {
  state: ServerState;
  log: string[];
  fetchFn: (input: string, init?: Record<string, unknown>) => Promise<FakeRes>;
}

function makeServer(initial: Partial<ServerState> = {}): Server {
  const state: ServerState = {
    persona: 'mgmt',
    offline: false,
    paginated: false,
    presetRouting: {},
    ...initial,
  };
  const log: string[] = [];

  const fetchFn = async (
    input: string,
    init?: Record<string, unknown>,
  ): Promise<FakeRes> => {
    const method = String(init?.method ?? 'GET');
    log.push(`${method} ${input}`);
    if (state.offline) throw new Error('Network request failed');

    const url = new URL(input);
    const path = url.pathname;

    if (path.endsWith('/key')) {
      if (state.keyStatus) {
        return jsonRes(
          {
            error: {
              message: 'Insufficient credits',
              code: state.keyStatus,
              metadata: {
                limit_source: 'openrouter_credits',
                remedy_hint: 'Add credits to your account',
              },
            },
          },
          state.keyStatus,
        );
      }
      return jsonRes({
        data: {
          label: state.persona === 'mgmt' ? 'mgmt-fixture' : 'standard-fixture',
          is_management_key: state.persona === 'mgmt',
          limit: 10,
          limit_remaining: state.persona === 'mgmt' ? 3.2 : 2.7,
          limit_reset: 'monthly',
          usage: 6.8,
          usage_daily: state.persona === 'mgmt' ? 1.75 : 0.42,
          usage_weekly: state.persona === 'mgmt' ? 4.2 : 2.1,
          usage_monthly: state.persona === 'mgmt' ? 6.8 : 7.3,
          free_model_daily_requests: { used: 0, limit: 1000, remaining: 1000 },
        },
      });
    }

    if (path.startsWith('/api/v1/keys')) {
      if (state.persona === 'standard') {
        return jsonRes({ error: { message: 'Invalid API key', code: 401 } }, 401);
      }
      if (method === 'POST') {
        return jsonRes({ data: { hash: 'sk-or-v1-new', key: 'sk-or-v1-created-once' } });
      }
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonRes({ data: { hash: 'sk-or-v1-abc', label: body.label, limit: body.limit } });
      }
      if (method === 'DELETE') return jsonRes({});
      return jsonRes({
        data: [
          {
            hash: 'sk-or-v1-abc',
            label: 'prod',
            created: 1,
            limit: 10,
            limit_remaining: 4,
            limit_reset: 'monthly',
            usage: 6,
            usage_daily: 1,
            usage_weekly: 3,
            usage_monthly: 6,
            include_byok_in_limit: false,
            expires_at: null,
          },
        ],
      });
    }

    if (path.endsWith('/activity')) {
      if (state.persona === 'standard') {
        return jsonRes(
          {
            error: {
              message: 'Only management keys can fetch activity for an account',
              code: 403,
            },
          },
          403,
        );
      }
      if (state.activityStatus) {
        return jsonRes(
          { error: { message: 'Rate limited', code: state.activityStatus } },
          state.activityStatus,
        );
      }
      if (state.activityPayload) {
        return jsonRes({
          data: state.activityPayload,
          total_count: state.activityPayload.length,
        });
      }
      if (state.paginated) {
        const cursor = url.searchParams.get('cursor');
        if (cursor === 'page2') {
          return jsonRes({
            data: [{ ...ACTIVITY[2] }],
            total_count: 2,
            links: { next: null },
          });
        }
        return jsonRes({
          data: [{ ...ACTIVITY[0] }],
          total_count: 2,
          links: { next: 'page2' },
        });
      }
      return jsonRes({ data: ACTIVITY, total_count: ACTIVITY.length });
    }

    if (path.endsWith('/credits')) {
      if (state.creditsStatus) {
        return jsonRes(
          { error: { message: 'Only management keys can fetch credits', code: state.creditsStatus } },
          state.creditsStatus,
        );
      }
      return jsonRes({ data: { total_credits: 65, total_usage: 48.54 } });
    }

    if (path.endsWith('/providers')) return jsonRes({ data: PROVIDERS });

    if (path.endsWith('/models/user')) {
      return jsonRes({
        data: [{ id: 'openai/gpt-4o-mini' }, { id: 'anthropic/claude-3.5-sonnet' }],
        total_count: 2,
      });
    }

    if (path.includes('/presets/')) {
      if (state.presetWriteFails) {
        return jsonRes({ error: { message: 'preset write failed', code: 500 } }, 500);
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as PresetConfig;
      state.presetRouting = body.provider ?? {};
      return jsonRes({ data: { slug: 'p1', id: 'p1', name: 'Prod', status: 'active', ...body } });
    }

    if (path.endsWith('/presets')) {
      return jsonRes({
        data: [
          {
            id: 'p1',
            slug: 'p1',
            name: 'Prod',
            description: null,
            status: 'active',
            designated_version_id: 'v1',
            created_at: '2026-10-05T00:00:00Z',
            updated_at: '2026-10-05T00:00:00Z',
            designated_version: {
              id: 'v1',
              preset_id: 'p1',
              version: 1,
              system_prompt: null,
              config: { provider: state.presetRouting },
            },
          },
        ],
      });
    }

    return jsonRes({ data: [] });
  };

  return { state, log, fetchFn };
}

async function setup(
  server: Server,
  persona: Persona = server.state.persona,
  opts: { maxRetries?: number } = {},
) {
  const db = new NodeSqlite();
  await migrate(db);
  const creds = new CredentialService(new MemoryKeyValueStore());
  await creds.saveKey(persona === 'mgmt' ? MGMT_KEY : STANDARD_KEY, persona === 'mgmt');
  const client = new OpenRouterClient({
    apiKey: persona === 'mgmt' ? MGMT_KEY : STANDARD_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    maxRetries: opts.maxRetries ?? 0,
    fetchFn: server.fetchFn,
  });
  const errors: Array<{ source: string; message: string }> = [];
  const engine = new SyncEngine(client, creds, db, {
    onError: (source, err) => errors.push({ source, message: err.message }),
  });
  return { db, creds, client, engine, errors };
}

describe('scenario matrix — management key persona', () => {
  it('Home, Spend and Keys derive from one full sync', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { db, engine } = await setup(server);

    await engine.refreshAll();

    const hash = await getSetting(db, 'credential.key_hash');
    const keyRow = await getKeyRow(db, hash ?? '');
    expect(keyRow?.isManagement).toBe(1);
    expect(keyRow?.usageWeekly).toBe(4.2);

    const rows = await getActivityRows(db);
    expect(rows).toHaveLength(3);
    expect(await getDailyRollups(db)).toHaveLength(2);
    expect(await listProvidersFromDb(db)).toHaveLength(2);
    expect(await getSetting(db, 'models_user_count')).toBe('2');

    // Home
    const home = computeHomeSummary({
      key: keyRow,
      rollups: await getDailyRollups(db),
      providers: await listProvidersFromDb(db),
      today: TODAY,
      staleCredits: false,
      activityLocked: false,
      creditsTotal: 65,
      creditsUsage: 48.54,
    });
    expect(home.spendToday).toBeCloseTo(3.5);
    expect(home.trend).toHaveLength(14);
    expect(home.top.length).toBe(2);
    expect(home.creditsRemaining).toBeCloseTo(16.46);

    // Spend
    const spend = computeSpendSummary(rows, await listProvidersFromDb(db), TODAY, 30);
    expect(spend.hasActivity).toBe(true);
    expect(spend.totalSpend).toBeCloseTo(4.25);
    expect(spend.totalRequests).toBe(20);
    expect(spend.totalTokens).toBe(15100);
    expect(spend.endpoints[0].providerSlug).toBe('anthropic');
    expect(spend.endpoints[0].statusPageUrl).toBe('https://status.anthropic.com');

    // management plane is reachable with a management key
    expect(server.log.some((l) => l.includes('/activity'))).toBe(true);
  });

  it('403 on /credits keeps /key fresh but leaves the balance unknown', async () => {
    const server = makeServer({ persona: 'mgmt', creditsStatus: 403 });
    const { db, engine } = await setup(server);
    await engine.refreshAll();

    // /key succeeded, so the key card is real data.
    expect(engine.getStatus().credits.lastOkAt).toBeTypeOf('number');
    expect(await getKeyRow(db, (await getSetting(db, 'credential.key_hash')) ?? '')).not.toBeNull();
    expect(engine.getStatus().balance.error).toBeTruthy();
    expect(await getProviderSetting(db, 'openrouter', 'account.total_credits')).toBeNull();
    expect(await getSetting(db, 'account.total_credits')).toBeNull();

    // No balance was ever persisted, so Home hides the credits card.
    const home = computeHomeSummary({
      key: null,
      rollups: [],
      providers: [],
      today: TODAY,
      staleCredits: true,
      activityLocked: false,
    });
    expect(home.creditsKnown).toBe(false);
  });

  it('a failed /credits refresh keeps the cached balance but marks it stale', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { db, engine } = await setup(server);
    await engine.refreshAll();

    const firstOkAt = engine.getStatus().balance.lastOkAt;
    expect(firstOkAt).toBeTypeOf('number');
    expect(await getProviderSetting(db, 'openrouter', 'account.total_credits')).toBe('65');

    server.state.creditsStatus = 403;
    await engine.refreshAll();

    expect(engine.getStatus().credits.lastOkAt).toBeTypeOf('number');
    expect(engine.getStatus().balance.error).toBeTruthy();
    expect(engine.getStatus().balance.lastOkAt).toBe(firstOkAt);
    expect(await getProviderSetting(db, 'openrouter', 'account.total_credits')).toBe('65');
  });

  it('Keys CRUD works and the one-time secret never reaches storage', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { client, db } = await setup(server);

    const created = await client.createAdminKey({ label: 'laptop', limit: 5 });
    expect(created.key).toBe('sk-or-v1-created-once');

    // reveal-later: collapsing drops it from memory
    let reveal = revealReducer(initialRevealState, { type: 'reveal', keyValue: created.key });
    expect(holdsSecret(reveal)).toBe(true);
    reveal = revealReducer(reveal, { type: 'collapse' });
    expect(holdsSecret(reveal)).toBe(false);

    // nothing persisted the raw secret
    const secretRows = await db.getAllAsync<{ value: string }>(
      'SELECT value FROM settings WHERE value LIKE ?',
      '%created-once%',
    );
    expect(secretRows).toHaveLength(0);
    expect(await db.getAllAsync('SELECT hash FROM keys')).toHaveLength(0);

    await client.patchAdminKey('sk-or-v1-abc', { label: 'renamed', limit: 20 });
    await client.deleteAdminKey('sk-or-v1-abc');
    const patch = server.log.find((l) => l.startsWith('PATCH'));
    const del = server.log.find((l) => l.startsWith('DELETE'));
    expect(patch).toContain('/keys/sk-or-v1-abc');
    expect(del).toContain('/keys/sk-or-v1-abc');
  });

  it('Policy toggle writes provider.ignore and reads it back', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { client } = await setup(server);

    const preset = (await client.listPresets())[0];
    const config = preset.designatedVersion?.config ?? {};
    const before = ruleFor(config.provider, 'anthropic');
    expect(before).toBe('default');

    const routing = setRule(config.provider, 'anthropic', 'ignored');
    await client.upsertPreset(preset.slug, withRouting(config, routing));

    const post = server.log.find((l) => l.startsWith('POST'));
    expect(post).toContain('/presets/p1/chat/completions');

    const reread = (await client.listPresets())[0];
    expect(ruleFor(reread.designatedVersion?.config.provider, 'anthropic')).toBe('ignored');

    // rollback to default is a clean write too
    const rolled = setRule(reread.designatedVersion?.config.provider, 'anthropic', 'default');
    expect(ruleFor(rolled, 'anthropic')).toBe('default');
  });
});

describe('scenario matrix — standard key persona', () => {
  it('activity and /keys stay management-gated; Home falls back to key windows', async () => {
    const server = makeServer({ persona: 'standard' });
    const { db, client, engine } = await setup(server);

    await engine.refreshAll();

    // gated before any network call — no /activity request was made
    expect(server.log.some((l) => l.includes('/activity'))).toBe(false);
    expect(await getActivityRows(db)).toHaveLength(0);
    expect(await getDailyRollups(db)).toHaveLength(0);
    expect(engine.getStatus().activity.error).toBe('management key required');

    // key windows still populate the fallback card
    const hash = await getSetting(db, 'credential.key_hash');
    const keyRow = await getKeyRow(db, hash ?? '');
    expect(keyRow?.isManagement).toBe(0);
    expect(keyRow?.usageDaily).toBe(0.42);
    expect(keyRow?.usageWeekly).toBe(2.1);
    expect(keyRow?.usageMonthly).toBe(7.3);

    const home = computeHomeSummary({
      key: keyRow,
      rollups: [],
      providers: await listProvidersFromDb(db),
      today: TODAY,
      staleCredits: false,
      activityLocked: true,
    });
    expect(home.usageMonthly).toBe(7.3);
    expect(home.spendToday).toBe(0);

    // Spend renders the explainer/fallback, not an error
    const spend = computeSpendSummary([], await listProvidersFromDb(db), TODAY, 30);
    expect(spend.hasActivity).toBe(false);
    expect(spend.totalSpend).toBe(0);

    // /keys returns 401 with a standard key (R2 of spec)
    await expect(client.listAdminKeys()).rejects.toThrow(/Invalid API key/);
    expect(server.log.some((l) => l.includes('/keys'))).toBe(true);
  });
});

describe('scenario matrix — offline and pagination', () => {
  it('offline after a good sync keeps cached data and reports staleness', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { db, engine, errors } = await setup(server);

    await engine.refreshAll();
    expect(await getActivityRows(db)).toHaveLength(3);

    server.state.offline = true;
    await expect(engine.refreshAll()).resolves.toBeUndefined();

    // cache intact → Home/Spend still render stale
    const rows = await getActivityRows(db);
    expect(rows).toHaveLength(3);
    expect(await getDailyRollups(db)).toHaveLength(2);

    const home = computeHomeSummary({
      key: null,
      rollups: await getDailyRollups(db),
      providers: await listProvidersFromDb(db),
      today: TODAY,
      staleCredits: true,
      activityLocked: false,
    });
    expect(home.staleCredits).toBe(true);
    expect(home.spendToday).toBeCloseTo(3.5);

    expect(errors.map((e) => e.source).sort()).toEqual(
      ['activity', 'credits', 'models', 'providers'].sort(),
    );
    const status = engine.getStatus();
    expect(status.credits.error).toMatch(/Network request failed/);
    expect(status.activity.lastOkAt).toBeTypeOf('number');
  });

  it('paginated /activity persists every page without duplicating rows', async () => {
    const server = makeServer({ persona: 'mgmt', paginated: true });
    const { db, engine } = await setup(server);

    await engine.refreshActivity();
    const rows: ActivityRow[] = await getActivityRows(db);
    expect(rows.map((r) => r.day).sort()).toEqual([DAYS.today, DAYS.yesterday].sort());
    expect(server.log.filter((l) => l.includes('cursor=page2')).length).toBe(1);
  });

  it('sign-out clears cached usage but keeps credential settings', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { db, engine } = await setup(server);
    await engine.refreshAll();

    await clearAllData(db);
    expect(await getActivityRows(db)).toHaveLength(0);
    expect(await getDailyRollups(db)).toHaveLength(0);
    expect(await listProvidersFromDb(db)).toHaveLength(0);
    expect(await getSetting(db, 'credential.key_hash')).not.toBeNull();
  });
});

describe('scenario matrix — failure modes and malformed payloads', () => {
  it('402 on /key is failure-isolated and keeps the cached key card', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { db, engine } = await setup(server);
    await engine.refreshAll();

    const hash = (await getSetting(db, 'credential.key_hash')) ?? '';
    const beforeKey = await getKeyRow(db, hash);
    const beforeCredits = await getSetting(db, 'account.total_credits');
    const beforeUsage = await getSetting(db, 'account.total_usage');

    server.state.keyStatus = 402;
    await expect(engine.refreshAll()).resolves.toBeUndefined();

    expect(engine.getStatus().credits.error).toMatch(/Insufficient credits/);
    expect(await getKeyRow(db, hash)).toEqual(beforeKey);
    expect(await getSetting(db, 'account.total_credits')).toBe(beforeCredits);
    expect(await getSetting(db, 'account.total_usage')).toBe(beforeUsage);
    // the other sources still refreshed
    expect(await getActivityRows(db)).toHaveLength(3);
    expect(engine.getStatus().activity.error).toBeUndefined();
  });

  it('429 on /activity surfaces after retries and leaves the cache intact', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { db, engine, errors } = await setup(server, 'mgmt', { maxRetries: 1 });
    await engine.refreshActivity();
    expect(await getActivityRows(db)).toHaveLength(3);

    server.state.activityStatus = 429;
    await expect(engine.refreshActivity()).rejects.toMatchObject({ status: 429 });

    expect(await getActivityRows(db)).toHaveLength(3);
    expect(engine.getStatus().activity.error).toMatch(/Rate limited/);
    expect(engine.getStatus().activity.lastOkAt).toBeTypeOf('number');
    expect(errors.at(-1)?.source).toBe('activity');
  });

  it('malformed /activity records are skipped or sanitized, never persisted as NaN', async () => {
    const server = makeServer({ persona: 'mgmt' });
    server.state.activityPayload = [
      { date: 'not-a-day', endpoint: 'bad', requests: 1, spend_usd: 1, tokens: 1 },
      { date: TODAY, endpoint: '', requests: '3', spend_usd: '0.5', tokens: '10' },
      { date: TODAY, endpoint: 'good:openai', requests: -5, spend_usd: -1, tokens: -100 },
      { date: YESTERDAY, endpoint: 'good:openai', spend_usd: 1 },
    ];
    const { db, engine } = await setup(server);

    await engine.refreshActivity();
    const rows = await getActivityRows(db);
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.day === 'not-a-day')).toBe(false);

    const unknown = rows.find((r) => r.endpoint === 'unknown');
    expect(unknown).toMatchObject({ day: TODAY, requests: 3, spendUsd: 0.5, tokens: 10 });

    const clamped = rows.find(
      (r) => r.day === TODAY && r.endpoint === 'good:openai',
    );
    expect(clamped).toMatchObject({ requests: 0, spendUsd: 0, tokens: 0 });

    expect(rows.every((r) => Number.isFinite(r.spendUsd) && Number.isFinite(r.tokens))).toBe(true);
  });

  it('an offline restart reuses the on-device cache from the same SQLite database', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { db, client, creds, engine } = await setup(server);
    await engine.refreshAll();

    server.state.offline = true;
    const restartErrors: string[] = [];
    const restarted = new SyncEngine(client, creds, db, {
      onError: (source) => restartErrors.push(source),
    });
    await expect(restarted.refreshAll()).resolves.toBeUndefined();

    // cache survived the process restart
    expect(await getActivityRows(db)).toHaveLength(3);
    expect(await getDailyRollups(db)).toHaveLength(2);
    expect(restarted.getStatus().credits.error).toMatch(/Network request failed/);
    expect(restartErrors.sort()).toEqual(['activity', 'credits', 'models', 'providers']);
  });

  it('failed preset write does not change the server routing truth', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { client } = await setup(server);

    const preset = (await client.listPresets())[0];
    server.state.presetWriteFails = true;
    await expect(
      client.upsertPreset(preset.slug, {
        ...(preset.designatedVersion?.config ?? {}),
        provider: { ignore: ['anthropic'] },
      }),
    ).rejects.toThrow(/preset write failed/);

    const reread = (await client.listPresets())[0];
    expect(ruleFor(reread.designatedVersion?.config.provider, 'anthropic')).toBe('default');
  });

  it('refreshActivity drops rollups for days pruned out of the activity window', async () => {
    const server = makeServer({ persona: 'mgmt' });
    const { db, engine } = await setup(server);
    await db.runAsync(
      `INSERT INTO daily_rollups (provider, day, spend_usd, requests, tokens, by_endpoint)
       VALUES ('openrouter', '2020-01-01', 9, 9, 9, '{}')`,
    );

    await engine.refreshActivity();
    const days = (await getDailyRollups(db)).map((r) => r.day);
    expect(days).not.toContain('2020-01-01');
    expect(days.sort()).toEqual([DAYS.yesterday, DAYS.today].sort());
  });
});

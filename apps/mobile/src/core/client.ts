/**
 * OpenRator — OpenRouterClient: typed fetch layer over /api/v1.
 * Timeouts, single-flight per key, retry/backoff for retriable failures,
 * and error mapping per docs/03-spike-notes.md §3. The raw key is only ever
 * placed in the Authorization header.
 */

import { OPENROUTER_BASE_URL, POLL } from './config';
import { FetchLike, HttpClient, isSameOriginUrl } from './http';
import {
  ActivityPage,
  ActivityRecord,
  AdminKey,
  AdminKeyCreated,
  Credits,
  KeyStatus,
  ModelRef,
  Preset,
  PresetConfig,
  PresetVersion,
  Provider,
} from './types';

interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
  maxRetries?: number;
}

const toCamel = (s: string): string =>
  s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function mapObject(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) out[toCamel(k)] = v;
  return out;
}

/** mapObject + cast through unknown (models are partial API projections). */
function mapAs<T>(src: Record<string, unknown>): T {
  return mapObject(src) as unknown as T;
}

/**
 * A 2xx response is not a promise that `data` is present (edge proxies and
 * partial outages return `{}`). Normalize anything that is not a plain object
 * to `{}` so typed getters never throw on a malformed success body (M5.4).
 */
function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function pickList(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = (raw as { data?: unknown }).data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Picks snake_case keys from `src` into a camelCase object. */
export function mapKeyStatus(src: Record<string, unknown>): KeyStatus {
  const k = mapObject(asRecord(src));
  const f = (k.freeModelDailyRequests ?? {}) as Record<string, unknown>;
  return {
    ...(k as unknown as KeyStatus),
    freeModelDailyRequests: {
      used: Number(f.used ?? 0),
      limit: Number(f.limit ?? 0),
      remaining: Number(f.remaining ?? 0),
    },
  };
}

/** Shared sanity check for any key value (create-flow test, M4.5). */
export function testRawKey(
  rawKey: string,
  opts?: { baseUrl?: string; fetchFn?: ClientOptions['fetchFn'] },
): Promise<KeyStatus> {
  const client = new OpenRouterClient({
    apiKey: rawKey,
    baseUrl: opts?.baseUrl,
    fetchFn: opts?.fetchFn,
  });
  return client.getKeyStatus();
}

export class OpenRouterClient {
  private readonly http: HttpClient;

  constructor(private readonly opts: ClientOptions) {
    this.http = new HttpClient({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? OPENROUTER_BASE_URL,
      timeoutMs: opts.timeoutMs ?? POLL.REQUEST_TIMEOUT_MS,
      fetchFn: opts.fetchFn,
      maxRetries: opts.maxRetries ?? POLL.MAX_RETRIES,
    });
  }

  /** Serialise all requests: one in-flight OpenRouter call at a time. */
  private singleFlight<T>(fn: () => Promise<T>): Promise<T> {
    return this.http.singleFlight(fn);
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.http.request<T>(method, path, body);
  }

  // ---- typed endpoints -------------------------------------------------

  getKeyStatus(): Promise<KeyStatus> {
    return this.singleFlight(() =>
      this.request<{ data?: unknown }>('GET', '/key').then((r) => mapKeyStatus(asRecord(r?.data))),
    );
  }

  getCredits(): Promise<Credits> {
    return this.singleFlight(() =>
      this.request<{ data?: unknown }>('GET', '/credits').then((r) => {
        const src = mapAs<Credits>(asRecord(r?.data));
        return {
          totalCredits: Number(src.totalCredits ?? 0),
          totalUsage: Number(src.totalUsage ?? 0),
        };
      }),
    );
  }

  /** PROVISIONAL shape (M0.5A). date: YYYY-MM-DD; cursor: links.next value. */
  getActivity(opts?: { date?: string; apiKeyHash?: string; cursor?: string }): Promise<ActivityPage> {
    const q: string[] = [];
    if (opts?.date) q.push(`date=${encodeURIComponent(opts.date)}`);
    if (opts?.apiKeyHash) q.push(`api_key_hash=${encodeURIComponent(opts.apiKeyHash)}`);
    if (opts?.cursor) q.push(`cursor=${encodeURIComponent(opts.cursor)}`);
    const suffix = q.length ? `?${q.join('&')}` : '';
    return this.singleFlight(() =>
      this.request<{ data: unknown[]; total_count?: number; links?: unknown }>(
        'GET',
        `/activity${suffix}`,
      ).then((r) => ({
        data: pickList(r).map((x) => mapAs<ActivityPage['data'][0]>(x)),
        totalCount: r.total_count,
        links: r.links as ActivityPage['links'],
      })),
    );
  }

  /**
   * Follows links.next across every page (bounded) so the full 30-day window
   * is captured. Mirrors listModelsUser's pagination contract.
   */
  async getActivityAll(opts?: { date?: string; apiKeyHash?: string }): Promise<ActivityPage> {
    const MAX_PAGES = 50;
    const MAX_ROWS = 10_000;
    const data: ActivityRecord[] = [];
    let cursor: string | undefined;
    let totalCount: number | undefined;
    let pages = 0;
    do {
      const page = await this.getActivity({ ...opts, cursor });
      data.push(...page.data);
      totalCount = page.totalCount ?? totalCount;
      cursor = page.links?.next ?? undefined;
      pages++;
    } while (cursor && pages < MAX_PAGES && data.length < MAX_ROWS);
    return { data, totalCount, links: { next: cursor ?? null } };
  }

  listProviders(): Promise<Provider[]> {
    return this.singleFlight(() =>
      this.request<{ data: unknown[] }>('GET', '/providers').then((r) =>
        pickList(r).map((x) => mapAs<Provider>(x)),
      ),
    );
  }

  /** Follows links.next automatically when follow=true (default). */
  async listModelsUser(opts?: { cursor?: string; follow?: boolean }): Promise<{
    models: ModelRef[];
    next?: string | null;
  }> {
    const follow = opts?.follow !== false;
    const MAX_PAGES = 50;
    const models: ModelRef[] = [];
    let cursor = opts?.cursor;
    let next: string | null | undefined;
    let pages = 0;
    do {
      const path = cursor ?? '/models/user';
      if (
        path.startsWith('http') &&
        !isSameOriginUrl(path, this.opts.baseUrl ?? OPENROUTER_BASE_URL)
      ) {
        // A hostile/malformed pagination link must not receive the bearer key.
        next = null;
        break;
      }
      const page = await this.singleFlight(() =>
        this.request<{ data: unknown[]; total_count?: number; links?: { next?: string | null } }>(
          'GET',
          path,
        ).then((r) => ({
          models: pickList(r).map((x) => mapAs<ModelRef>(x)),
          next: r.links?.next,
        })),
      );
      models.push(...page.models);
      next = page.next;
      cursor = page.next ?? undefined;
      pages++;
    } while (follow && cursor && pages < MAX_PAGES);
    return { models, next: next ?? null };
  }

  listPresets(): Promise<Preset[]> {
    return this.singleFlight(() =>
      this.request<{ data: unknown[]; total_count?: number }>('GET', '/presets').then((r) =>
        pickList(r).map((x) => mapAs<Preset>(x)),
      ),
    );
  }

  getPreset(slug: string): Promise<Preset> {
    return this.singleFlight(() =>
      this.request<{ data?: unknown }>('GET', `/presets/${encodeURIComponent(slug)}`).then((r) =>
        mapAs<Preset>(asRecord(r?.data)),
      ),
    );
  }

  listPresetVersions(slug: string): Promise<PresetVersion[]> {
    return this.singleFlight(() =>
      this.request<{ data: unknown[] }>('GET', `/presets/${encodeURIComponent(slug)}/versions`).then(
        (r) => pickList(r).map((x) => mapAs<PresetVersion>(x)),
      ),
    );
  }

  /**
   * Create-or-update a preset from a chat-completions body (cost-free;
   * messages are ignored by the API). Fields that overlap the preset config
   * are persisted and versioned.
   */
  upsertPreset(slug: string, config: PresetConfig): Promise<Preset> {
    const body: Record<string, unknown> = { ...config, messages: [] };
    return this.singleFlight(() =>
      this.request<{ data: Record<string, unknown> }>(
        'POST',
        `/presets/${encodeURIComponent(slug)}/chat/completions`,
        body,
      ).then((r) => mapAs<Preset>(r.data)),
    );
  }

  // ---- management-key plane (401/403 with a standard key, R2 of spec) ----

  listAdminKeys(): Promise<AdminKey[]> {
    return this.singleFlight(() =>
      this.request<{ data: unknown[] }>('GET', '/keys').then((r) =>
        pickList(r).map((x) => mapAs<AdminKey>(x)),
      ),
    );
  }

  /**
   * POST /keys — body uses the documented snake_case wire fields. The key's
   * display name is the `label` field (spec §5.2 / spike §4.4), matching the
   * PATCH contract and the `AdminKey` type (WS2-1).
   */
  createAdminKey(body: {
    label?: string;
    limit?: number;
    limitReset?: string;
    includeByokInLimit?: boolean;
    expiresAt?: string;
  }): Promise<AdminKeyCreated> {
    const wire: Record<string, unknown> = {};
    if (body.label !== undefined) wire.label = body.label;
    if (body.limit !== undefined) wire.limit = body.limit;
    if (body.limitReset !== undefined) wire.limit_reset = body.limitReset;
    if (body.includeByokInLimit !== undefined) wire.include_byok_in_limit = body.includeByokInLimit;
    if (body.expiresAt !== undefined) wire.expires_at = body.expiresAt;
    return this.singleFlight(() =>
      this.request<{ data?: unknown }>('POST', '/keys', wire).then((r) =>
        mapAs<AdminKeyCreated>(asRecord(r?.data)),
      ),
    );
  }

  /**
   * PATCH /keys/{hash} — the path identifier is the key `hash` (spec §5.2),
   * not an `id`. Body uses the documented snake_case wire fields (WS2-1).
   */
  patchAdminKey(
    hash: string,
    body: {
      label?: string;
      limit?: number;
      limitReset?: string | null;
      includeByokInLimit?: boolean;
      expiresAt?: string | null;
    },
  ): Promise<AdminKey> {
    const wire: Record<string, unknown> = {};
    if (body.label !== undefined) wire.label = body.label;
    if (body.limit !== undefined) wire.limit = body.limit;
    if (body.limitReset !== undefined) wire.limit_reset = body.limitReset;
    if (body.includeByokInLimit !== undefined) wire.include_byok_in_limit = body.includeByokInLimit;
    if (body.expiresAt !== undefined) wire.expires_at = body.expiresAt;
    return this.singleFlight(() =>
      this.request<{ data?: unknown }>(
        'PATCH',
        `/keys/${encodeURIComponent(hash)}`,
        wire,
      ).then((r) => mapAs<AdminKey>(asRecord(r?.data))),
    );
  }

  /** DELETE /keys/{hash} — destructive; callers double-confirm. */
  async deleteAdminKey(hash: string): Promise<void> {
    await this.singleFlight(() =>
      this.request<unknown>('DELETE', `/keys/${encodeURIComponent(hash)}`),
    );
  }
}
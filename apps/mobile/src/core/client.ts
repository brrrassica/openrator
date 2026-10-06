/**
 * OpenRator — OpenRouterClient: typed fetch layer over /api/v1.
 * Timeouts, single-flight per key, retry/backoff for retriable failures,
 * and error mapping per docs/03-spike-notes.md §3. The raw key is only ever
 * placed in the Authorization header.
 */

import { OPENROUTER_BASE_URL, POLL } from './config';
import {
  OpenRouterApiError,
  OpenRouterNetworkError,
  mapHttpError,
} from './errors';
import {
  ActivityPage,
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

interface FetchLike {
  (input: string, init?: Record<string, unknown>): Promise<{
    status: number;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
  }>;
}

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

function pickList(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = (raw as { data?: unknown }).data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Picks snake_case keys from `src` into a camelCase object. */
export function mapKeyStatus(src: Record<string, unknown>): KeyStatus {
  const k = mapObject(src);
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
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;
  private readonly maxRetries: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ClientOptions) {
    this.baseUrl = (opts.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? POLL.REQUEST_TIMEOUT_MS;
    this.fetchFn = opts.fetchFn ?? (async (url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.maxRetries = opts.maxRetries ?? POLL.MAX_RETRIES;
  }

  /** Serialise all requests: one in-flight OpenRouter call at a time. */
  private singleFlight<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // keep the chain alive regardless of individual failures
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(500 * 2 ** (attempt - 1), 4000) + Math.floor(Math.random() * 150);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
      try {
        const res = await this.fetchFn(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          // RN fetch supports signal via AbortController; keep optional.
        });
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          json = undefined;
        }
        if (res.status >= 200 && res.status < 300) {
          return json as T;
        }
        const err = mapHttpError(res.status, json, res.headers.get('Retry-After'));
        if (!err.retriable) throw err;
        lastErr = err;
      } catch (e) {
        if (e instanceof OpenRouterApiError) throw e;
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr ?? new OpenRouterNetworkError('request failed');
  }

  // ---- typed endpoints -------------------------------------------------

  getKeyStatus(): Promise<KeyStatus> {
    return this.singleFlight(() =>
      this.request<{ data: Record<string, unknown> }>('GET', '/key').then((r) => mapKeyStatus(r.data)),
    );
  }

  getCredits(): Promise<Credits> {
    return this.singleFlight(() =>
      this.request<{ data: Record<string, unknown> }>('GET', '/credits').then((r) =>
        mapAs<Credits>(r.data),
      ),
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
    const path = opts?.cursor ?? '/models/user';
    const page = await this.singleFlight(() =>
      this.request<{ data: unknown[]; total_count?: number; links?: { next?: string | null } }>(
        'GET',
        path,
      ).then((r) => ({
        models: pickList(r).map((x) => mapAs<ModelRef>(x)),
        next: r.links?.next,
      })),
    );
    if (opts?.follow && page.next && !opts.cursor) {
      const rest = await this.listModelsUser({ cursor: page.next, follow: true });
      return { models: [...page.models, ...rest.models], next: rest.next };
    }
    return page;
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
      this.request<{ data: Record<string, unknown> }>('GET', `/presets/${encodeURIComponent(slug)}`).then(
        (r) => mapAs<Preset>(r.data),
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

  /** POST /keys — body uses the documented snake_case wire fields. */
  createAdminKey(body: {
    name?: string;
    limit?: number;
    limitReset?: string;
    expiresAt?: string;
  }): Promise<AdminKeyCreated> {
    const wire: Record<string, unknown> = {};
    if (body.name !== undefined) wire.name = body.name;
    if (body.limit !== undefined) wire.limit = body.limit;
    if (body.limitReset !== undefined) wire.limit_reset = body.limitReset;
    if (body.expiresAt !== undefined) wire.expires_at = body.expiresAt;
    return this.singleFlight(() =>
      this.request<{ data: Record<string, unknown> }>('POST', '/keys', wire).then((r) =>
        mapAs<AdminKeyCreated>(r.data),
      ),
    );
  }

  /** PATCH /keys/{id} — body uses the documented snake_case wire fields. */
  patchAdminKey(
    id: string,
    body: { label?: string; limit?: number; limitReset?: string; expiresAt?: string },
  ): Promise<AdminKey> {
    const wire: Record<string, unknown> = {};
    if (body.label !== undefined) wire.label = body.label;
    if (body.limit !== undefined) wire.limit = body.limit;
    if (body.limitReset !== undefined) wire.limit_reset = body.limitReset;
    if (body.expiresAt !== undefined) wire.expires_at = body.expiresAt;
    return this.singleFlight(() =>
      this.request<{ data: Record<string, unknown> }>('PATCH', `/keys/${encodeURIComponent(id)}`, wire).then(
        (r) => mapAs<AdminKey>(r.data),
      ),
    );
  }

  /** DELETE /keys/{id} — destructive; callers double-confirm. */
  async deleteAdminKey(id: string): Promise<void> {
    await this.singleFlight(() =>
      this.request<unknown>('DELETE', `/keys/${encodeURIComponent(id)}`),
    );
  }
}
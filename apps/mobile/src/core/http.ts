/**
 * OpenRator — shared HTTP transport (M7.3).
 *
 * Extracted from OpenRouterClient so every provider adapter inherits the same
 * timeout, single-flight queue, retry/backoff (idempotent methods only) and
 * error mapping. Raw keys only ever appear in the Authorization header.
 */

import { POLL } from './config';
import {
  OpenRouterApiError,
  OpenRouterNetworkError,
  mapHttpError,
} from './errors';

export interface FetchLike {
  (input: string, init?: Record<string, unknown>): Promise<{
    status: number;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
  }>;
}

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
  maxRetries?: number;
  /** Extra headers (e.g. provider-specific auth experiments in M8). */
  headers?: Record<string, string>;
}

function isAbortError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Only idempotent methods may be replayed. A timeout or 5xx on a write may
 * have already committed server-side (e.g. POST /keys minting a key), so
 * retrying it can duplicate the side effect or lose a one-time secret.
 */
export function isRetryableMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/**
 * True when an absolute URL targets the same origin as the configured API.
 * Malformed candidates are rejected so a bad `links.next` cannot redirect the
 * bearer token to another host.
 */
export function isSameOriginUrl(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;
  private readonly maxRetries: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? POLL.REQUEST_TIMEOUT_MS;
    this.fetchFn =
      opts.fetchFn ??
      (async (url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.maxRetries = opts.maxRetries ?? POLL.MAX_RETRIES;
  }

  /** Serialise all requests: one in-flight call per client at a time. */
  singleFlight<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (path.startsWith('http') && !isSameOriginUrl(path, this.baseUrl)) {
      throw new OpenRouterNetworkError('refusing to send credentials to a different origin');
    }
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const maxAttempts = isRetryableMethod(method) ? this.maxRetries + 1 : 1;
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const retryAfterMs =
          lastErr instanceof OpenRouterApiError ? lastErr.retryAfterMs : undefined;
        const backoffMs = Math.max(
          retryAfterMs ?? 0,
          Math.min(500 * 2 ** (attempt - 1), 4000) + Math.floor(Math.random() * 150),
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new OpenRouterNetworkError('request timed out'));
        }, this.timeoutMs);
      });
      try {
        const res = await Promise.race([
          this.fetchFn(url, {
            method,
            headers: {
              Authorization: `Bearer ${this.opts.apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...(this.opts.headers ?? {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          }),
          timeout,
        ]);
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          json = undefined;
        }
        if (res.status >= 200 && res.status < 300) {
          // A 2xx is not a promise of a JSON body (204s, edge-proxy pages).
          // Normalize a missing/null body to `{}` so typed callers always have
          // a response record to read instead of dereferencing `undefined`.
          return (json ?? {}) as T;
        }
        const err = mapHttpError(res.status, json, res.headers.get('Retry-After'));
        if (!err.retriable) throw err;
        lastErr = err;
      } catch (e) {
        if (e instanceof OpenRouterApiError) throw e;
        if (isAbortError(e)) {
          lastErr = new OpenRouterNetworkError('request aborted');
        } else {
          lastErr = e instanceof Error ? e : new Error(String(e));
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastErr ?? new OpenRouterNetworkError('request failed');
  }
}

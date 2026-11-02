/**
 * OpenRator — shared HTTP transport (M7.3).
 *
 * Extracted from OpenRouterClient so every provider adapter inherits the same
 * timeout, single-flight queue, retry/backoff and error mapping. Raw keys only
 * ever appear in the Authorization header.
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
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
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
          return json as T;
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

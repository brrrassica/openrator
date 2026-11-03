/**
 * OpenRator — live OpenCode transport (M8.1).
 *
 * Verified against the public API on 2026-11-01:
 *
 *   GET https://opencode.ai/zen/go/v1/usage
 *   Authorization: Bearer oc_sk_...
 *
 *   200 {
 *     usage: {
 *       rolling: { status: 'ok' | 'rate-limited', percent: 0..100, resetsAt: ISO-8601 },
 *       weekly:  { ... },
 *       monthly: { ... }
 *     }
 *   }
 *
 * The endpoint authenticates with the API key alone; no workspace header is
 * required. Percent values are already 0..100. Anything unexpected is treated
 * defensively so a schema change degrades to "no data" rather than a crash.
 */

import { FetchLike, HttpClient } from '../../core/http';
import { PlanUsageWindow, PlanWindowId } from '../types';
import { clampPct } from './common';

/** Origin shared by OpenCode Go and Console endpoints. */
export const OPENCODE_ORIGIN = 'https://opencode.ai';

/** OpenCode Go allowance endpoint (rolling 5-hour / weekly / monthly). */
export const GO_USAGE_PATH = '/zen/go/v1/usage';

/** Raw meter as returned by the Go usage endpoint. */
export interface GoUsageMeter {
  status?: string | null;
  percent?: number | string | null;
  resetsAt?: string | number | null;
}

export interface GoUsageResponse {
  usage?: {
    rolling?: GoUsageMeter | null;
    weekly?: GoUsageMeter | null;
    monthly?: GoUsageMeter | null;
  } | null;
}

export interface OpenCodeClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Map the wire's window names to the normalized domain ids. */
const WIRE_WINDOWS: Array<{ key: keyof NonNullable<GoUsageResponse['usage']>; id: PlanWindowId }> = [
  { key: 'rolling', id: 'five_hour' },
  { key: 'weekly', id: 'weekly' },
  { key: 'monthly', id: 'monthly' },
];

/** Normalize a reset timestamp (ISO string or epoch ms) to an ISO string. */
export function normalizeResetsAt(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** True when any meter reports a rate-limited status. */
export function isGoUsageLimited(body: unknown): boolean {
  const usage = (body as GoUsageResponse | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') return false;
  return WIRE_WINDOWS.some(({ key }) => {
    const status = usage[key]?.status;
    return typeof status === 'string' && status !== 'ok';
  });
}

/** Convert the raw Go response into normalized plan windows. */
export function parseGoUsage(body: unknown): PlanUsageWindow[] {
  const usage = (body as GoUsageResponse | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') return [];
  const windows: PlanUsageWindow[] = [];
  for (const { key, id } of WIRE_WINDOWS) {
    const meter = usage[key];
    if (!meter || typeof meter !== 'object') continue;
    windows.push({
      window: id,
      usedPct: clampPct(Number(meter.percent ?? 0)),
      resetsAt: normalizeResetsAt(meter.resetsAt),
    });
  }
  return windows;
}

export class OpenCodeClient {
  private readonly http: HttpClient;

  constructor(opts: OpenCodeClientOptions) {
    this.http = new HttpClient({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? OPENCODE_ORIGIN,
      fetchFn: opts.fetchFn,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      headers: {
        // Identify the client rather than a generic HTTP library (Go docs).
        'User-Agent': 'OpenRator/0.2.2',
      },
    });
  }

  /** Fetch the Go allowance meters from the live API. */
  async getGoUsage(): Promise<PlanUsageWindow[]> {
    const body = await this.http.request<GoUsageResponse>('GET', GO_USAGE_PATH);
    return parseGoUsage(body);
  }

  /** Fetch the raw Go response (used to derive the plan status). */
  async getGoUsageResponse(): Promise<GoUsageResponse> {
    return this.http.request<GoUsageResponse>('GET', GO_USAGE_PATH);
  }
}

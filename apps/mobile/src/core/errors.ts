/**
 * OpenRator — typed API error taxonomy (spike notes §3, spec §5.6/§10).
 * Verified live 2026-10-05: 400/401/403/404 bodies; 402/429 per docs.
 */

export type LimitSource =
  | 'openrouter_key_limit'
  | 'openrouter_credits'
  | 'openrouter_in_flight_budget';

export interface ApiErrorBody {
  error?: {
    message?: string;
    code?: number;
    metadata?: {
      limit_source?: LimitSource;
      remedy_hint?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
}

export const ERROR_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Invalid API key',
  402: 'Insufficient credits / key limit reached',
  403: 'This action needs a management key',
  404: 'Not found',
  429: 'Rate limited',
};

export class OpenRouterApiError extends Error {
  /** HTTP status. */
  readonly status: number;
  /** numeric error.code from the payload when present, else status. */
  readonly code: number;
  /** 402 only: which limit triggered the rejection. */
  readonly limitSource?: LimitSource;
  /** 402 only: dashboard/UI hint from the API. */
  readonly remedyHint?: string;
  /** 429 only: Retry-After seconds when present (already capped). */
  readonly retryAfterMs?: number;
  /** True when the caller may retry the request after backoff. */
  readonly retriable: boolean;

  constructor(opts: {
    status: number;
    code?: number;
    message?: string;
    limitSource?: LimitSource;
    remedyHint?: string;
    retryAfterMs?: number;
    retriable?: boolean;
  }) {
    super(opts.message ?? ERROR_MESSAGES[opts.status] ?? `HTTP ${opts.status}`);
    this.status = opts.status;
    this.code = opts.code ?? opts.status;
    this.limitSource = opts.limitSource;
    this.remedyHint = opts.remedyHint;
    this.retryAfterMs = opts.retryAfterMs;
    this.retriable = opts.retriable ?? (opts.status === 429 || opts.status >= 500);
  }
}

/** Network-level failures (DNS/TLS/timeout/connection reset). */
export class OpenRouterNetworkError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Turn an HTTP response (status + parsed json body) into the right error.
 * Does not touch the raw key; error messages never embed credentials.
 */
export function mapHttpError(
  status: number,
  body: unknown,
  retryAfterHeader?: string | null,
): OpenRouterApiError {
  let apiBody: ApiErrorBody = {};
  if (typeof body === 'object' && body !== null) {
    apiBody = body as ApiErrorBody;
  }
  const err = apiBody.error ?? {};
  const meta = err.metadata ?? {};

  let retryAfterMs: number | undefined;
  if (retryAfterHeader) {
    const secs = Math.min(Number(retryAfterHeader), 60);
    if (secs > 0) retryAfterMs = Math.round(secs * 1000);
  }

  return new OpenRouterApiError({
    status,
    code: typeof err.code === 'number' ? err.code : undefined,
    message: typeof err.message === 'string' ? err.message : undefined,
    limitSource:
      meta.limit_source === 'openrouter_key_limit' ||
      meta.limit_source === 'openrouter_credits' ||
      meta.limit_source === 'openrouter_in_flight_budget'
        ? meta.limit_source
        : undefined,
    remedyHint: typeof meta.remedy_hint === 'string' ? meta.remedy_hint : undefined,
    retryAfterMs,
  });
}
import { describe, expect, it } from 'vitest';
import { mapHttpError, OpenRouterApiError } from '../src/core/errors';

describe('mapHttpError — taxonomy from spike notes §3 (verified live 2026-10-05)', () => {
  it('400: generation list missing id (real payload)', () => {
    const err = mapHttpError(400, {
      error: { message: 'id: Invalid input: expected string, received undefined', code: 400 },
    });
    expect(err).toBeInstanceOf(OpenRouterApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe(400);
    expect(err.message).toContain('Invalid input');
    expect(err.retriable).toBe(false);
  });

  it('401: invalid API key (real payload from /keys)', () => {
    const err = mapHttpError(401, { error: { message: 'Invalid API key', code: 401 } });
    expect(err.status).toBe(401);
    expect(err.retriable).toBe(false);
  });

  it('403: management-key-only (real payload from /activity)', () => {
    const err = mapHttpError(403, {
      error: { message: 'Only management keys can fetch activity for an account', code: 403 },
    });
    expect(err.status).toBe(403);
    expect(err.retriable).toBe(false);
  });

  it('402: credits empty — carries limit_source + remedy_hint', () => {
    const err = mapHttpError(402, {
      error: {
        message: 'Insufficient credits',
        code: 402,
        metadata: { limit_source: 'openrouter_credits', remedy_hint: 'Add credits to your account' },
      },
    });
    expect(err.status).toBe(402);
    expect(err.limitSource).toBe('openrouter_credits');
    expect(err.remedyHint).toBe('Add credits to your account');
    expect(err.retriable).toBe(false);
  });

  it('402: key-limit variant maps to openrouter_key_limit', () => {
    const err = mapHttpError(402, {
      error: {
        code: 402,
        metadata: { limit_source: 'openrouter_key_limit', remedy_hint: 'Increase limit' },
      },
    });
    expect(err.limitSource).toBe('openrouter_key_limit');
    expect(err.remedyHint).toBe('Increase limit');
  });

  it('429: rate limited — retriable, honors Retry-After (capped at 60s)', () => {
    const err = mapHttpError(429, { error: { message: 'Rate limited', code: 429 } }, '120');
    expect(err.retriable).toBe(true);
    expect(err.retryAfterMs).toBe(60_000);
  });

  it('429: no Retry-After header → retriable without delay hint', () => {
    const err = mapHttpError(429, { error: { message: 'Rate limited', code: 429 } }, null);
    expect(err.retriable).toBe(true);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('5xx: server error — retriable', () => {
    const err = mapHttpError(503, { error: { message: 'upstream failed', code: 503 } });
    expect(err.retriable).toBe(true);
  });

  it('404: unknown path', () => {
    const err = mapHttpError(404, { error: { message: 'Not Found', code: 404 } });
    expect(err.status).toBe(404);
    expect(err.retriable).toBe(false);
  });

  it('unknown status falls back to a friendly message', () => {
    const err = mapHttpError(418, {});
    expect(err.message).toBe('HTTP 418');
    expect(err.retriable).toBe(false);
  });
});
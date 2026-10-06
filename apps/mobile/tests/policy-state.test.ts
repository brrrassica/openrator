import { describe, expect, it } from 'vitest';
import { PresetConfig } from '../src/core/types';
import {
  nextRule,
  ruleFor,
  setRule,
  withRouting,
} from '../src/ui/policy-state';

const cfg = (provider?: Record<string, unknown>): PresetConfig => ({
  model: 'openai/gpt-4o-mini',
  ...(provider ? { provider } : {}),
});

describe('ruleFor (state derivation)', () => {
  it('default when no rules apply', () => {
    expect(ruleFor(undefined, 'google')).toBe('default');
    expect(ruleFor({}, 'google')).toBe('default');
  });

  it('included members come first, then order, then ignore', () => {
    const routing = { only: ['openai', 'anthropic'], order: ['deepseek'], ignore: ['google'] };
    expect(ruleFor(routing, 'anthropic')).toBe('included');
    expect(ruleFor(routing, 'deepseek')).toBe('prioritized');
    expect(ruleFor(routing, 'google')).toBe('ignored');
    expect(ruleFor(routing, 'moonshotai')).toBe('excluded');
  });

  it('no only-list → non-listed providers are default', () => {
    expect(ruleFor({ order: ['openai'] }, 'google')).toBe('default');
  });
});

describe('nextRule cycle', () => {
  it('cycles default → prioritized → ignored → included → default', () => {
    expect(nextRule('default')).toBe('prioritized');
    expect(nextRule('prioritized')).toBe('ignored');
    expect(nextRule('ignored')).toBe('included');
    expect(nextRule('included')).toBe('default');
    expect(nextRule('excluded')).toBe('included');
  });
});

describe('setRule (mutation, cross-cleanup)', () => {
  it('prioritize adds to order and cleans ignore/only', () => {
    const r = setRule({ only: ['openai'], ignore: ['deepseek'] }, 'deepseek', 'prioritized');
    expect(r.order).toEqual(['deepseek']);
    expect(r.ignore).toBeUndefined();
    expect(r.only).toEqual(['openai']);
  });

  it('ignore removes from order/only and never duplicates', () => {
    const r = setRule(
      { order: ['deepseek', 'openai'], ignore: ['openai'] },
      'deepseek',
      'ignored',
    );
    expect(r.ignore).toEqual(['openai', 'deepseek']);
    expect(r.order).toEqual(['openai']);
  });

  it('included adds to only and cleans the toggled provider from order', () => {
    const r = setRule({ order: ['google', 'openai'] }, 'google', 'included');
    expect(r.only).toEqual(['google']);
    expect(r.order).toEqual(['openai']); // other providers' rules stay
  });

  it('default removes the provider from every list; empty lists are dropped', () => {
    const r = setRule({ only: ['openai'] }, 'openai', 'default');
    expect(r.only).toBeUndefined();
    expect(Object.keys(r)).toEqual([]);
  });

  it('returns a new object — caller state mutation is safe for optimistic UI', () => {
    const before = { order: ['openai'] };
    const after = setRule(before, 'openai', 'ignored');
    expect(before).toEqual({ order: ['openai'] });
    expect(after.ignore).toEqual(['openai']);
  });
});

describe('withRouting', () => {
  it('empty routing removes provider entirely (back to default routing)', () => {
    const c = cfg({ provider: { ignore: ['x'] } });
    const next = withRouting(c, {});
    expect(next.provider).toBeUndefined();
  });

  it('non-empty routing is applied', () => {
    const c = cfg();
    const real = withRouting(c, { ignore: ['google'] });
    expect(real.provider).toEqual({ ignore: ['google'] });
  });
});
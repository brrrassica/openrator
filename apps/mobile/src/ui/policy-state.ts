/**
 * OpenRator — pure provider-policy logic (M4.2/4.3, spec §8.3).
 * Derives each provider's state from the selected preset's routing rules
 * (provider.only/order/ignore) and mutates the config in place.
 */

import { PresetConfig, PresetRouting } from '../core/types';

export type ProviderRule = 'default' | 'prioritized' | 'ignored' | 'included' | 'excluded';

const inList = (list: string[] | undefined, slug: string): boolean =>
  !!list && list.includes(slug);

/**
 * State of `slug` under `routing`:
 * - included  → in provider.only
 * - prioritized → in provider.order
 * - ignored   → in provider.ignore
 * - excluded  → only-list exists but slug isn't in it
 * - default   → no rule applies
 */
export function ruleFor(routing: PresetRouting | undefined, slug: string): ProviderRule {
  const r = routing ?? {};
  if (inList(r.only, slug)) return 'included';
  if (inList(r.order, slug)) return 'prioritized';
  if (inList(r.ignore, slug)) return 'ignored';
  if (r.only && r.only.length > 0) return 'excluded';
  return 'default';
}

/** Cycle on tap (default → prioritized → ignored → included → default). */
export function nextRule(rule: ProviderRule): ProviderRule {
  switch (rule) {
    case 'default':
      return 'prioritized';
    case 'prioritized':
      return 'ignored';
    case 'ignored':
      return 'included';
    case 'excluded':
      return 'included';
    case 'included':
      return 'default';
  }
}

const without = (list: string[] | undefined, slug: string): string[] | undefined => {
  if (!list) return undefined;
  const next = list.filter((s) => s !== slug);
  return next.length ? next : undefined;
};

const withUnique = (list: string[] | undefined, slug: string): string[] => {
  const next = list ? list.filter((s) => s !== slug) : [];
  next.push(slug);
  return next;
};

/**
 * Return a NEW routing with `slug` moved to `rule`. Cross-cleanup keeps the
 * three lists mutually exclusive so the API never sees contradictory input:
 * - 'only' members are removed from ignore/order (and vice versa).
 */
export function setRule(
  routing: PresetRouting | undefined,
  slug: string,
  rule: ProviderRule,
): PresetRouting {
  const r: PresetRouting = {
    ...(routing ?? {}),
    only: routing?.only ? [...routing.only] : undefined,
    order: routing?.order ? [...routing.order] : undefined,
    ignore: routing?.ignore ? [...routing.ignore] : undefined,
  };
  switch (rule) {
    case 'default':
      r.only = without(r.only, slug);
      r.order = without(r.order, slug);
      r.ignore = without(r.ignore, slug);
      break;
    case 'prioritized':
      r.only = without(r.only, slug);
      r.ignore = without(r.ignore, slug);
      r.order = withUnique(r.order, slug);
      break;
    case 'ignored':
      r.only = without(r.only, slug);
      r.order = without(r.order, slug);
      r.ignore = withUnique(r.ignore, slug);
      break;
    case 'included':
      r.order = without(r.order, slug);
      r.ignore = without(r.ignore, slug);
      r.only = withUnique(r.only, slug);
      break;
    case 'excluded':
      break; // nothing to write — the only-list excludes it implicitly
  }
  // drop empty lists entirely
  if (!r.only || r.only.length === 0) delete r.only;
  if (!r.order || r.order.length === 0) delete r.order;
  if (!r.ignore || r.ignore.length === 0) delete r.ignore;
  return r;
}

/** Clone a preset config with routing replaced (for the upsert body). */
export function withRouting(config: PresetConfig, routing: PresetRouting): PresetConfig {
  const next = { ...config };
  if (Object.keys(routing).length === 0) delete next.provider;
  else next.provider = routing;
  return next;
}

export const RULE_LABEL: Record<ProviderRule, string> = {
  default: 'default',
  prioritized: 'prioritized',
  ignored: 'ignored',
  included: 'included',
  excluded: 'excluded*',
};

export const RULE_TIP: Record<ProviderRule, string> = {
  default: 'no routing rule',
  prioritized: 'preferred (order)',
  ignored: 'never used (ignore)',
  included: 'only-list member',
  excluded: 'blocked by only-list',
};
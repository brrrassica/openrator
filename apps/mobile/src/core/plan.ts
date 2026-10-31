/**
 * OpenRator — pure subscription-plan selectors (M8).
 *
 * OpenCode Go reports usage as a percentage per rolling window. The sync
 * engine writes those values as namespaced provider settings; this module
 * parses them back into a renderable shape and stays free of RN/DB imports so
 * the mapping is unit-testable.
 */

import { PlanInfo, PlanUsageWindow, PlanWindowId } from '../providers/types';
import { clampPct, PLAN_WINDOW_ORDER } from '../providers/opencode/common';

export const PLAN_SETTING_PREFIX = 'plan';

export function planSettingSuffix(window: PlanWindowId, field: 'used_pct' | 'resets_at'): string {
  return `${PLAN_SETTING_PREFIX}.window.${window}.${field}`;
}

/** Setting suffixes written for every plan window (used by the sync engine). */
export function planWindowSettingEntries(
  windows: PlanUsageWindow[],
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const w of windows) {
    out.push({ key: planSettingSuffix(w.window, 'used_pct'), value: String(clampPct(w.usedPct)) });
    out.push({ key: planSettingSuffix(w.window, 'resets_at'), value: w.resetsAt ?? '' });
  }
  return out;
}

export function planInfoSettingEntries(plan: PlanInfo): Array<{ key: string; value: string }> {
  return [
    { key: 'account.plan_name', value: plan.name },
    { key: 'account.plan_status', value: plan.status },
    { key: 'account.plan_renews_at', value: plan.renewsAt ?? '' },
    { key: 'account.plan_amount_usd', value: plan.amountUsd === null || plan.amountUsd === undefined ? '' : String(plan.amountUsd) },
  ];
}

/**
 * Rebuild the plan card from namespaced settings. Returns null when the
 * provider never reported a plan, so the UI can hide the card entirely.
 */
export function buildPlanInfo(settings: Record<string, string | null>): PlanInfo | null {
  const name = settings['account.plan_name'];
  const windows: PlanUsageWindow[] = [];
  for (const window of PLAN_WINDOW_ORDER) {
    const raw = settings[planSettingSuffix(window, 'used_pct')];
    if (raw === null || raw === undefined || raw === '') continue;
    const resetsAt = settings[planSettingSuffix(window, 'resets_at')] || null;
    windows.push({ window, usedPct: clampPct(Number(raw)), resetsAt });
  }
  const status = settings['account.plan_status'];
  if (!name && windows.length === 0) return null;
  const amountRaw = settings['account.plan_amount_usd'];
  return {
    name: name || 'Subscription plan',
    status: status || 'active',
    renewsAt: settings['account.plan_renews_at'] || null,
    amountUsd:
      amountRaw === null || amountRaw === undefined || amountRaw === ''
        ? null
        : Number(amountRaw),
    windows,
  };
}

/** True when the provider advertises percentage windows but none are stored. */
export function planHasNoWindows(plan: PlanInfo | null): boolean {
  return !plan || !plan.windows || plan.windows.length === 0;
}

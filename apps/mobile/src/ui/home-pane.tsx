/**
 * OpenRator — Home Pane (M2, spec §8.1): credits card, 14-day spend trend,
 * top endpoints, warning rows, upstream health strip, stale badge,
 * pull-to-refresh. Data comes from SQLite via the sync engine.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SqlDb } from '../store/db';
import {
  getDailyRollups,
  getKeyRows,
  getProviderSetting,
  getSetting,
  listManualUsage,
  listProvidersFromDb,
} from '../store/daos';
import { SyncEngine, isScopeStale } from '../sync/sync-engine';
import { POLL } from '../core/config';
import { DailyRollup, KeyRow, Provider } from '../core/types';
import { buildPlanInfo, planSettingSuffix } from '../core/plan';
import { PlanInfo, PlanUsageWindow, ProviderId } from '../providers/types';
import { getDescriptor } from '../providers/registry';
import { PLAN_WINDOW_LABELS, PLAN_WINDOW_ORDER } from '../providers/opencode/common';
import { combineKeyRows, sumCredits } from './aggregate';
import { computeHomeSummary, HomeSummary, problemProviders, resetLabel } from './home-summary';
import { fmtCount, fmtUsd, limitLabel, limitRemainingLabel } from './chart-math';
import { BarRows, ResponsiveAreaChart } from './primitives';
import { useTheme } from './theme';

interface Props {
  engine: SyncEngine;
  db: SqlDb;
  provider?: 'all' | ProviderId;
}

interface ScopedPlan {
  provider: ProviderId;
  plan: PlanInfo;
}

interface ManualRow {
  provider: ProviderId;
  amountUsd: number;
}

interface HomeData {
  key: KeyRow | null;
  rollups: DailyRollup[];
  providers: Provider[];
  today: string;
  creditsTotal?: number;
  creditsUsage?: number;
  plans: ScopedPlan[];
  manual: ManualRow[];
}

export default function HomePane({ engine, db, provider = 'all' }: Props) {
  const t = useTheme();
  const [data, setData] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const scopeIds = engine.getProviders();
      const ids: ProviderId[] = provider === 'all' ? scopeIds : [provider];
      const providerFilter = provider === 'all' ? undefined : provider;
      const [keyRows, rollups, providers] = await Promise.all([
        getKeyRows(db, providerFilter),
        getDailyRollups(db, undefined, undefined, providerFilter),
        listProvidersFromDb(db, providerFilter),
      ]);
      const credits = await Promise.all(
        ids.map(async (id) => {
          const total = await getProviderSetting(db, id, 'account.total_credits');
          const usage = await getProviderSetting(db, id, 'account.total_usage');
          // v0.1 rows only had global settings for OpenRouter.
          const legacyTotal =
            id === 'openrouter' && total === null
              ? await getSetting(db, 'account.total_credits')
              : total;
          const legacyUsage =
            id === 'openrouter' && usage === null
              ? await getSetting(db, 'account.total_usage')
              : usage;
          const totalNum = legacyTotal === null ? undefined : Number(legacyTotal);
          const usageNum = legacyUsage === null ? undefined : Number(legacyUsage);
          return {
            total:
              totalNum !== undefined && Number.isFinite(totalNum) ? totalNum : undefined,
            usage: usageNum !== undefined && Number.isFinite(usageNum) ? usageNum : 0,
          };
        }),
      );
      // M8: OpenCode Go percent windows live in provider-scoped settings.
      const plans: ScopedPlan[] = [];
      for (const id of ids) {
        const settings: Record<string, string | null> = {
          'account.plan_name': await getProviderSetting(db, id, 'account.plan_name'),
          'account.plan_status': await getProviderSetting(db, id, 'account.plan_status'),
          'account.plan_renews_at': await getProviderSetting(db, id, 'account.plan_renews_at'),
          'account.plan_amount_usd': await getProviderSetting(db, id, 'account.plan_amount_usd'),
        };
        for (const window of PLAN_WINDOW_ORDER) {
          settings[planSettingSuffix(window, 'used_pct')] = await getProviderSetting(
            db,
            id,
            planSettingSuffix(window, 'used_pct'),
          );
          settings[planSettingSuffix(window, 'resets_at')] = await getProviderSetting(
            db,
            id,
            planSettingSuffix(window, 'resets_at'),
          );
        }
        const plan = buildPlanInfo(settings);
        if (plan && plan.windows && plan.windows.length > 0) plans.push({ provider: id, plan });
      }
      const month = new Date().toISOString().slice(0, 7);
      const manualRows = await listManualUsage(db, providerFilter);
      const manual: ManualRow[] = manualRows
        .filter((r) => r.month === month && ids.includes(r.provider as ProviderId))
        .map((r) => ({ provider: r.provider as ProviderId, amountUsd: r.amountUsd }));
      const key =
        provider === 'all'
          ? combineKeyRows(keyRows, 'All providers')
          : keyRows[0] ?? null;
      const today = new Date().toISOString().slice(0, 10);
      const totals = sumCredits(credits);
      const creditsKnown = credits.some((c) => c.total !== undefined);
      if (mounted.current) {
        setData({
          key,
          rollups,
          providers,
          today,
          creditsTotal: creditsKnown ? totals.total : undefined,
          creditsUsage: creditsKnown ? totals.usage : undefined,
          plans,
          manual,
        });
      }
    } catch {
      // keep last-known data; offline is fine
    }
  }, [db, engine, provider]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const unsub = engine.subscribe(() => void load());
    return () => {
      mounted.current = false;
      unsub();
    };
  }, [engine, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await engine.refreshAll();
    } finally {
      setRefreshing(false);
    }
  }, [engine]);

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ color: t.subtext }}>Loading…</Text>
      </View>
    );
  }

  const scopeIds = provider === 'all' ? engine.getProviders() : [provider];
  const statuses = scopeIds.map((id) => engine.getStatus(id));
  const staleCredits =
    statuses.some((s) => s.balance?.error !== undefined) ||
    isScopeStale(
      engine,
      scopeIds,
      'balance',
      'accountBalance',
      POLL.CREDITS_FOREGROUND_MS * 2,
    );
  const activityLocked =
    scopeIds.length > 0 &&
    statuses.every((s) => s.activity?.error === 'management key required');
  const scopeName = provider === 'all' ? 'All providers' : getDescriptor(provider).displayName;
  const summary: HomeSummary = computeHomeSummary({
    key: data.key,
    rollups: data.rollups,
    providers: data.providers,
    today: data.today,
    staleCredits,
    activityLocked: Boolean(activityLocked),
    creditsTotal: data.creditsTotal,
    creditsUsage: data.creditsUsage,
  });
  // Home health strip: only providers with a status page that are unhealthy.
  const issues = problemProviders(summary.providers);
  const manualProviders = provider === 'all' ? scopeIds : [provider];
  const manualCapable = manualProviders.filter((id) => engine.getCapabilities(id)?.manualBudget);
  const showCredits =
    summary.creditsKnown &&
    (provider === 'all'
      ? scopeIds.some((id) => engine.getCapabilities(id)?.accountBalance)
      : Boolean(engine.getCapabilities(provider)?.accountBalance));
  const showKeyCard =
    provider === 'all' ? true : Boolean(engine.getCapabilities(provider)?.spendWindows);
  const manualTotal = data.manual.reduce((s, m) => s + m.amountUsd, 0);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.accent} />
      }
    >
      {staleCredits ? (
        <View style={[styles.stale, { backgroundColor: t.warn + '22', borderColor: t.warn + '44' }]}>
          <Text style={{ color: t.warn, fontSize: 12 }}>Offline — showing last-known values</Text>
        </View>
      ) : null}

      {/* Account credits — only for providers that expose a balance */}
      {showCredits ? (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: t.text }]}>{scopeName} Credits</Text>
          <View style={[styles.chip, { backgroundColor: t.border }]}>
            <Text style={{ color: t.subtext, fontSize: 11 }}>account balance</Text>
          </View>
        </View>
        <Text style={[styles.balance, { color: t.text }]}>
          {fmtUsd(summary.creditsRemaining)}
        </Text>
        <Text style={{ color: t.subtext, fontSize: 13 }}>
          {fmtUsd(summary.creditsUsage)} used of {fmtUsd(summary.creditsTotal)} purchased
        </Text>
        <View style={[styles.limitTrack, { backgroundColor: t.border }]}>
          <View
            style={{
              width: `${
                summary.creditsTotal > 0
                  ? Math.min(100, (summary.creditsRemaining / summary.creditsTotal) * 100)
                  : 0
              }%`,
              ...styles.limitFill,
              backgroundColor:
                summary.creditsTotal > 0 && summary.creditsRemaining / summary.creditsTotal < 0.1
                  ? t.danger
                  : t.ok,
            }}
          />
        </View>
      </View>
      ) : null}

      {/* Subscription plan windows (OpenCode Go) */}
      {data.plans.length > 0
        ? data.plans.map(({ provider: planProvider, plan }) => (
            <View
              key={planProvider}
              style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: t.text }]}>
                  {getDescriptor(planProvider).displayName} — {plan.name}
                </Text>
                <View style={[styles.chip, { backgroundColor: t.border }]}>
                  <Text style={{ color: t.subtext, fontSize: 11 }}>{plan.status}</Text>
                </View>
              </View>
              <PlanWindowRows windows={plan.windows ?? []} />
            </View>
          ))
        : null}

      {/* Manual fallback for providers without a verified usage API */}
      {manualCapable.length > 0 ? (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: t.text }]}>Manual budget</Text>
            <View style={[styles.chip, { backgroundColor: t.border }]}>
              <Text style={{ color: t.subtext, fontSize: 11 }}>user-entered</Text>
            </View>
          </View>
          <Text style={[styles.balance, { color: t.text }]}>{fmtUsd(manualTotal)}</Text>
          <Text style={{ color: t.subtext, fontSize: 13 }}>
            {manualCapable.map((id) => getDescriptor(id).displayName).join(', ')} — add or edit
            this month’s amount in Accounts.
          </Text>
        </View>
      ) : null}

      {/* API key usage / limits — secondary */}
      {showKeyCard ? (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: t.text }]}>
            API Key — {summary.label || 'key'}
          </Text>
          <View style={[styles.chip, { backgroundColor: t.border }]}>
            <Text style={{ color: t.subtext, fontSize: 11 }}>
              {resetLabel(summary.limitReset) || 'no limit'}
            </Text>
          </View>
        </View>
        <Text style={[styles.balance, { color: t.text }]}>
          {summary.limit > 0 ? limitLabel(summary.limitRemaining, summary.limit) : 'Unlimited'}
        </Text>
        <Text style={{ color: t.subtext, fontSize: 13 }}>
          {limitRemainingLabel(summary.limitRemaining, summary.limit)} ·{' '}
          {fmtUsd(summary.usageDaily)} spent today
        </Text>
        {summary.limit > 0 ? (
          <View style={[styles.limitTrack, { backgroundColor: t.border }]}>
            <View
              style={{
                width: `${Math.min(100, (summary.limitRemaining / summary.limit) * 100)}%`,
                ...styles.limitFill,
                backgroundColor:
                  summary.limitRemaining / summary.limit < 0.1 ? t.danger : t.ok,
              }}
            />
          </View>
        ) : null}
        <View style={styles.windowRow}>
          <WindowStat label="today" value={fmtUsd(summary.usageDaily)} />
          <WindowStat label="this month" value={fmtUsd(summary.usageMonthly)} />
          <WindowStat label="last 7d" value={fmtUsd(summary.spend7d)} />
        </View>
      </View>
      ) : null}

      {/* Warnings */}
      {summary.warnings.map((w) => (
        <View
          key={w.kind}
          style={[styles.warning, { backgroundColor: t.warn + '18', borderColor: t.warn + '44' }]}
        >
          <Text style={{ color: t.warn, fontSize: 13 }}>⚠ {w.message}</Text>
        </View>
      ))}

      {activityLocked ? (
        <View style={[styles.warning, { backgroundColor: t.accent + '18', borderColor: t.accent + '44' }]}>
          <Text style={{ color: t.accent, fontSize: 13 }}>
            Add a management key to unlock 30-day spend analytics (Spend tab).
          </Text>
        </View>
      ) : null}

      {/* Spend trend */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Spend — last 14 days</Text>
        <Text style={{ color: t.subtext, fontSize: 12, marginBottom: 8 }}>
          {fmtUsd(summary.spend7d)} in the last 7 days
        </Text>
        <ResponsiveAreaChart data={summary.trend} height={110} color={t.accent} />
      </View>

      {/* Top endpoints */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Top endpoints — last 7 days</Text>
        {summary.top.length === 0 ? (
          <Text style={{ color: t.subtext, fontSize: 13 }}>No activity yet.</Text>
        ) : (
          <BarRows
            rows={summary.top.map((x) => ({
              label: x.endpoint,
              value: x.spendUsd,
              right: `${fmtUsd(x.spendUsd)} · ${fmtCount(x.requests)} req`,
            }))}
          />
        )}
      </View>

      {/* Health strip — only providers with a status page that are showing problems */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>
          Upstream providers — {issues.length} with issues
        </Text>
        {issues.length === 0 ? (
          <Text style={{ color: t.subtext, fontSize: 13 }}>
            All upstream providers healthy.
          </Text>
        ) : (
          issues.slice(0, 8).map((p) => {
            // WS2-9: health dot from the persisted snapshot state/last_ok_at.
            const ageMs = p.lastOkAt ? Date.now() - new Date(p.lastOkAt).getTime() : Infinity;
            const dotColor =
              p.state !== 'ok' || !p.lastOkAt
                ? t.subtext
                : ageMs > 2 * 86_400_000
                  ? t.warn
                  : t.ok;
            return (
              <Pressable
                key={p.slug}
                style={styles.healthRow}
                onPress={() => p.statusPageUrl && void Linking.openURL(p.statusPageUrl)}
              >
                <View style={[styles.healthDot, { backgroundColor: dotColor }]} />
                <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={{ color: t.accent, fontSize: 11 }}>status page ↗</Text>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function PlanWindowRows({ windows }: { windows: PlanUsageWindow[] }) {
  const t = useTheme();
  if (windows.length === 0) {
    return (
      <Text style={{ color: t.subtext, fontSize: 13 }}>
        No plan usage reported yet — pull to refresh.
      </Text>
    );
  }
  return (
    <View style={{ marginTop: 8 }}>
      {windows.map((w) => {
        const color = w.usedPct >= 90 ? t.danger : w.usedPct >= 75 ? t.warn : t.ok;
        return (
          <View key={w.window} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: t.subtext, fontSize: 12 }}>
                {PLAN_WINDOW_LABELS[w.window] ?? w.window}
              </Text>
              <Text style={{ color, fontSize: 12, fontWeight: '700' }}>
                {w.usedPct.toFixed(0)}% used
              </Text>
            </View>
            <View style={[styles.limitTrack, { backgroundColor: t.border }]}>
              <View
                style={[styles.limitFill, { width: `${w.usedPct}%`, backgroundColor: color }]}
              />
            </View>
            {w.resetsAt ? (
              <Text style={{ color: t.subtext, fontSize: 10, marginTop: 3 }}>
                resets {w.resetsAt}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function WindowStat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.subtext, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  balance: { fontSize: 30, fontWeight: '800', marginVertical: 4 },
  limitTrack: { height: 8, borderRadius: 999, overflow: 'hidden', marginTop: 8, width: '100%' },
  limitFill: { height: 8, borderRadius: 999 },
  windowRow: { flexDirection: 'row', marginTop: 14 },
  warning: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 10,
  },
  stale: { borderRadius: 8, borderWidth: 1, padding: 8, marginBottom: 10 },
  healthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8888',
  },
  healthDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
});
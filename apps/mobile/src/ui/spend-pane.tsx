/**
 * OpenRator — Spend & Endpoint Analytics pane (M3, spec §8.2).
 * Management-key activity → 30-day chart + totals, provider-share donut,
 * endpoint breakdown (rank by spend/requests, status-page links), and a
 * per-day rollups table. No mgmt key → explainer + key spend windows.
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
  getActivityRows,
  getKeyRows,
  listManualUsage,
  listProvidersFromDb,
} from '../store/daos';
import { SyncEngine, isScopeStale } from '../sync/sync-engine';
import { POLL } from '../core/config';
import { addDays } from '../sync/rollups';
import { ActivityRow, KeyRow, Provider } from '../core/types';
import { getDescriptor } from '../providers/registry';
import { ProviderId } from '../providers/types';
import { combineKeyRows } from './aggregate';
import { computeSpendSummary } from './spend-summary';
import { fmtCount, fmtUsd } from './chart-math';
import { BarRows, Donut, ResponsiveAreaChart } from './primitives';
import { useTheme } from './theme';

interface Props {
  engine: SyncEngine;
  db: SqlDb;
  provider?: 'all' | ProviderId;
}

const PERIODS = [7, 14, 30];

export default function SpendPane({ engine, db, provider = 'all' }: Props) {
  const t = useTheme();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [key, setKey] = useState<KeyRow | null>(null);
  const [manualTotal, setManualTotal] = useState(0);
  const [period, setPeriod] = useState(30);
  const [rankBy, setRankBy] = useState<'spend' | 'requests'>('spend');
  const [refreshing, setRefreshing] = useState(false);
  const [donutSize, setDonutSize] = useState(120);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const from = addDays(today, -34); // 35-day retention guard
      const providerFilter = provider === 'all' ? undefined : provider;
      const [act, prov, keys, manualRows] = await Promise.all([
        getActivityRows(db, { fromDay: from, provider: providerFilter }),
        listProvidersFromDb(db, providerFilter),
        getKeyRows(db, providerFilter),
        listManualUsage(db, providerFilter),
      ]);
      const month = today.slice(0, 7);
      setManualTotal(
        manualRows
          .filter((r) => r.month === month)
          .reduce((s, r) => s + r.amountUsd, 0),
      );
      const k =
        provider === 'all'
          ? combineKeyRows(keys, 'All providers')
          : keys[0] ?? null;
      if (mounted.current) {
        setRows(act);
        setProviders(prov);
        setKey(k);
      }
    } catch {
      // offline-safe: keep last-known
    }
  }, [db, provider]);

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

  const scopeIds = provider === 'all' ? engine.getProviders() : [provider];
  const statuses = scopeIds.map((id) => engine.getStatus(id));
  const activityLocked =
    scopeIds.length > 0 &&
    statuses.every((s) => s.activity?.error === 'management key required');
  const summary = computeSpendSummary(rows, providers, new Date().toISOString().slice(0, 10), period);
  const staleActivity = isScopeStale(
    engine,
    scopeIds,
    'activity',
    'activityHistory',
    POLL.ACTIVITY_FOREGROUND_MS * 2,
  );

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.accent} />
      }
    >
      {staleActivity ? (
        <View style={[styles.notice, { backgroundColor: t.warn + '22', borderColor: t.warn + '44' }]}>
          <Text style={{ color: t.warn, fontSize: 12 }}>Offline — showing cached analytics</Text>
        </View>
      ) : null}

      {activityLocked ? (
        <FallbackView keyRow={key} theme={t} manualTotal={manualTotal} />
      ) : summary.hasActivity ? (
        <>
          {/* period + rank toggles */}
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.toggleRow}>
              {PERIODS.map((p) => (
                <Pressable
                  key={p}
                  style={[styles.segment, { borderColor: p === period ? t.accent : t.border }]}
                  onPress={() => setPeriod(p)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: p === period }}
                >
                  <Text style={{ color: p === period ? t.accent : t.subtext, fontSize: 12 }}>
                    {p}d
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* totals */}
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.cardTitle, { color: t.text }]}>
              {period}-day spend & usage
            </Text>
            <View style={styles.totalsRow}>
              <Total label="spend" value={fmtUsd(summary.totalSpend)} />
              <Total label="requests" value={fmtCount(summary.totalRequests)} />
              <Total label="tokens" value={fmtCount(summary.totalTokens)} />
            </View>
            <ResponsiveAreaChart
              data={summary.trend.map((s) => s.spendUsd)}
              height={110}
              color={t.accent}
            />
          </View>

          {/* provider share donut */}
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.cardTitle, { color: t.text }]}>Share by provider</Text>
            {summary.share.length === 0 ? (
              <Text style={{ color: t.subtext, fontSize: 13 }}>No provider spend in this window.</Text>
            ) : (
              <View
                style={styles.donutRow}
                onLayout={(e) => {
                  // WS2-5: size the donut to the available row width.
                  const w = e.nativeEvent.layout.width;
                  const s = Math.max(90, Math.min(140, Math.round(w * 0.38)));
                  if (s !== donutSize) setDonutSize(s);
                }}
              >
                <Donut
                  slices={summary.share.map((s, i) => ({ value: s.spendUsd, color: t.chart[i % t.chart.length] }))}
                  size={donutSize}
                  strokeWidth={16}
                  center={fmtUsd(summary.totalSpend)}
                />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  {summary.share.slice(0, 5).map((s, i) => (
                    <View key={s.provider} style={styles.legendRow}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.chart[i % t.chart.length] }} />
                      <Text style={{ color: t.text, fontSize: 11, flex: 1 }} numberOfLines={1}>
                        {s.provider}
                      </Text>
                      <Text style={{ color: t.subtext, fontSize: 11 }}>{`${s.sharePct.toFixed(0)}%`}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* endpoint breakdown */}
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: t.text }]}>Top endpoints</Text>
              <View style={styles.rankRow}>
                {(['spend', 'requests'] as const).map((r) => (
                  <Pressable
                    key={r}
                    style={[styles.segment, { borderColor: r === rankBy ? t.accent : t.border }]}
                    onPress={() => setRankBy(r)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: r === rankBy }}
                  >
                    <Text style={{ color: r === rankBy ? t.accent : t.subtext, fontSize: 11 }}>
                      {r}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {summary.endpoints.length === 0 ? (
              <Text style={{ color: t.subtext, fontSize: 13 }}>No endpoint activity yet.</Text>
            ) : (
              <EndpointRows
                endpoints={summary.endpoints}
                rankBy={rankBy}
                theme={t}
              />
            )}
          </View>

          {/* rollups by day */}
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.cardTitle, { color: t.text }]}>By day — last {period}</Text>
            {summary.byDay.slice(0, period).map((d) => (
              <View key={d.day} style={styles.dayRow}>
                <Text style={{ color: t.subtext, fontSize: 11, flex: 1 }}>{d.day}</Text>
                <Text style={{ color: t.text, fontSize: 11 }}>{`${fmtCount(d.requests)} req`}</Text>
                <Text style={{ color: t.text, fontSize: 11, width: 64, textAlign: 'right' }}>
                  {fmtUsd(d.spendUsd)}
                </Text>
              </View>
            ))}
            {summary.byDay.length === 0 ? (
              <Text style={{ color: t.subtext, fontSize: 13 }}>No days recorded.</Text>
            ) : null}
          </View>
        </>
      ) : (
        <FallbackView
          keyRow={key}
          theme={t}
          manualTotal={manualTotal}
          explainer={
            provider !== 'all' && !engine.getCapabilities(provider)?.activityHistory
              ? `${getDescriptor(provider).displayName} does not expose payable activity history. Plan usage and manual amounts are shown on Home.`
              : undefined
          }
        />
      )}
    </ScrollView>
  );
}

function EndpointRows({
  endpoints,
  rankBy,
  theme: t,
}: {
  endpoints: Array<{
    endpoint: string;
    requests: number;
    spendUsd: number;
    sharePct: number;
    avgPerReq: number;
    statusPageUrl: string | null;
  }>;
  rankBy: 'spend' | 'requests';
  theme: ReturnType<typeof useTheme>;
}) {
  const ranked = [...endpoints].sort((a, b) =>
    rankBy === 'spend' ? b.spendUsd - a.spendUsd : b.requests - a.requests,
  );
  return (
    <View>
      {ranked.slice(0, 12).map((e) => (
        <Pressable
          key={e.endpoint}
          style={styles.endpointRow}
          disabled={!e.statusPageUrl}
          onPress={() => e.statusPageUrl && void Linking.openURL(e.statusPageUrl)}
        >
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ color: t.text, fontSize: 12, fontWeight: '600' }} numberOfLines={1} ellipsizeMode="middle">
              {e.endpoint}
            </Text>
            <Text style={{ color: t.subtext, fontSize: 10 }}>
              {`${fmtCount(e.requests)} req · ${fmtUsd(e.avgPerReq)}/req · ${e.sharePct.toFixed(1)}%`}
            </Text>
          </View>
          {e.statusPageUrl ? (
            <Text style={{ color: t.accent, fontSize: 10 }}>status ↗</Text>
          ) : null}
          <Text style={{ color: t.text, fontSize: 12, fontWeight: '700', width: 64, textAlign: 'right' }}>
            {fmtUsd(e.spendUsd)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** M3.4/M8 — explainer + key spend windows and manual fallback amounts. */
function FallbackView({
  keyRow,
  theme: t,
  manualTotal = 0,
  explainer,
}: {
  keyRow: KeyRow | null;
  theme: ReturnType<typeof useTheme>;
  manualTotal?: number;
  explainer?: string;
}) {
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.cardTitle, { color: t.text }]}>
        {explainer ? 'Endpoint analytics unavailable' : '30-day analytics locked'}
      </Text>
      <Text style={{ color: t.subtext, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
        {explainer ??
          'Add a management key in Keys (M4) to unlock 30-day spend by endpoint. Until then here is this key’s spend from /key:'}
      </Text>
      <View style={styles.windowRow}>
        <Total label="today" value={fmtUsd(keyRow?.usageDaily ?? 0)} />
        <Total label="this week" value={fmtUsd(keyRow?.usageWeekly ?? 0)} />
        <Total label="this month" value={fmtUsd(keyRow?.usageMonthly ?? 0)} />
        <Total label="manual" value={fmtUsd(manualTotal)} />
      </View>
      <Text style={{ color: t.subtext, fontSize: 11, marginTop: 6 }}>
        Manual amounts are entered in Accounts and labeled as user-provided.
      </Text>
    </View>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.subtext, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  notice: { borderRadius: 8, borderWidth: 1, padding: 8, marginBottom: 10 },
  toggleRow: { flexDirection: 'row' },
  rankRow: { flexDirection: 'row' },
  segment: {
    borderWidth: 1,
    borderRadius: 8,
    // ≥ 44 px touch target (M5.4 / WCAG 2.5.5)
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginRight: 6,
  },
  totalsRow: { flexDirection: 'row', marginBottom: 6 },
  windowRow: { flexDirection: 'row', marginTop: 14 },
  donutRow: { flexDirection: 'row', alignItems: 'center' },
  legendRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8888',
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8888',
  },
});
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
  getKeyRow,
  getSetting,
  listProvidersFromDb,
} from '../store/daos';
import { SyncEngine, isStale } from '../sync/sync-engine';
import { POLL } from '../core/config';
import { addDays } from '../sync/rollups';
import { ActivityRow, KeyRow, Provider } from '../core/types';
import { computeSpendSummary } from './spend-summary';
import { fmtCount, fmtUsd } from './chart-math';
import { AreaChart, BarRows, Donut } from './primitives';
import { useTheme } from './theme';

interface Props {
  engine: SyncEngine;
  db: SqlDb;
}

const PERIODS = [7, 14, 30];

export default function SpendPane({ engine, db }: Props) {
  const t = useTheme();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [key, setKey] = useState<KeyRow | null>(null);
  const [period, setPeriod] = useState(30);
  const [rankBy, setRankBy] = useState<'spend' | 'requests'>('spend');
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const from = addDays(today, -34); // 35-day retention guard
      const [act, prov, hash] = await Promise.all([
        getActivityRows(db, { fromDay: from }),
        listProvidersFromDb(db),
        getSetting(db, 'credential.key_hash'),
      ]);
      const k = hash ? await getKeyRow(db, hash) : null;
      if (mounted.current) {
        setRows(act);
        setProviders(prov);
        setKey(k);
      }
    } catch {
      // offline-safe: keep last-known
    }
  }, [db]);

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

  const status = engine.getStatus();
  const activityLocked = status.activity?.error === 'management key required';
  const summary = computeSpendSummary(rows, providers, new Date().toISOString().slice(0, 10), period);
  const staleActivity = isStale(status.activity?.lastOkAt, POLL.ACTIVITY_FOREGROUND_MS * 2);

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
        <FallbackView keyRow={key} theme={t} />
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
            <AreaChart
              data={summary.trend.map((s) => s.spendUsd)}
              width={320}
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
              <View style={styles.donutRow}>
                <Donut
                  slices={summary.share.map((s, i) => ({ value: s.spendUsd, color: t.chart[i % t.chart.length] }))}
                  size={120}
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
        <View style={[styles.notice, { backgroundColor: t.accent + '18', borderColor: t.accent + '44' }]}>
          <Text style={{ color: t.accent, fontSize: 13 }}>
            No activity recorded yet — pull down to sync (management key required).
          </Text>
        </View>
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

/** M3.4 — no management key: explainer + key spend windows from /key. */
function FallbackView({ keyRow, theme: t }: { keyRow: KeyRow | null; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.cardTitle, { color: t.text }]}>30-day analytics locked</Text>
      <Text style={{ color: t.subtext, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
        Add a management key in Keys (M4) to unlock 30-day spend by endpoint.
        Until then here's this key's spend from /key:
      </Text>
      <View style={styles.windowRow}>
        <Total label="today" value={fmtUsd(keyRow?.usageDaily ?? 0)} />
        <Total label="this week" value={fmtUsd(keyRow?.usageWeekly ?? 0)} />
        <Total label="this month" value={fmtUsd(keyRow?.usageMonthly ?? 0)} />
      </View>
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
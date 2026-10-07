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
  getKeyRow,
  getSetting,
  listProvidersFromDb,
} from '../store/daos';
import { SyncEngine, isStale } from '../sync/sync-engine';
import { POLL } from '../core/config';
import { DailyRollup, KeyRow, Provider } from '../core/types';
import { computeHomeSummary, HomeSummary, resetLabel } from './home-summary';
import { fmtCount, fmtUsd, limitLabel } from './chart-math';
import { BarRows, ResponsiveAreaChart } from './primitives';
import { useTheme } from './theme';

interface Props {
  engine: SyncEngine;
  db: SqlDb;
}

interface HomeData {
  key: KeyRow | null;
  rollups: DailyRollup[];
  providers: Provider[];
  today: string;
}

export default function HomePane({ engine, db }: Props) {
  const t = useTheme();
  const [data, setData] = useState<HomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const hash = (await getSetting(db, 'credential.key_hash')) ?? '';
      const [key, rollups, providers] = await Promise.all([
        hash ? getKeyRow(db, hash) : null,
        getDailyRollups(db),
        listProvidersFromDb(db),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      if (mounted.current) setData({ key, rollups, providers, today });
      // activity locked is derived from the engine's status instead
    } catch (e) {
      // keep last-known data; offline is fine
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

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ color: t.subtext }}>Loading…</Text>
      </View>
    );
  }

  const status = engine.getStatus();
  const staleCredits = isStale(status.credits?.lastOkAt, POLL.CREDITS_FOREGROUND_MS * 2);
  const activityLocked = status.activity?.error === 'management key required';
  const summary: HomeSummary = computeHomeSummary({
    key: data.key,
    rollups: data.rollups,
    providers: data.providers,
    today: data.today,
    staleCredits,
    activityLocked: Boolean(activityLocked),
  });

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

      {/* Credits card */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: t.text }]}>{summary.label || 'Key'}</Text>
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
          {fmtUsd(summary.limitRemaining)} remaining · {fmtUsd(summary.usageDaily)} spent today
        </Text>
        <View style={[styles.limitTrack, { backgroundColor: t.border }]}>
          <View
            style={{
              width: `${summary.limit > 0 ? Math.min(100, (summary.limitRemaining / summary.limit) * 100) : 100}%`,
              ...styles.limitFill,
              backgroundColor:
                summary.limit > 0 && summary.limitRemaining / summary.limit < 0.1
                  ? t.danger
                  : t.ok,
            }}
          />
        </View>
        <View style={styles.windowRow}>
          <WindowStat label="today" value={fmtUsd(summary.usageDaily)} />
          <WindowStat label="this month" value={fmtUsd(summary.usageMonthly)} />
          <WindowStat label="last 7d" value={fmtUsd(summary.spend7d)} />
        </View>
      </View>

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

      {/* Health strip */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>
          Upstream providers — {summary.providers.length} catalogued
        </Text>
        {summary.providers.slice(0, 8).map((p) => {
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
              {p.statusPageUrl ? (
                <Text style={{ color: t.accent, fontSize: 11 }}>status page ↗</Text>
              ) : (
                <Text style={{ color: t.subtext, fontSize: 11 }}>no status page</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
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
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8888',
  },
  healthDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
});
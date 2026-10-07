/**
 * OpenRator — Provider Catalog (M4.1, spec §8.3): search/sort over the
 * on-device provider snapshot, with regions + status-page links.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SqlDb } from '../store/db';
import { listProvidersFromDb } from '../store/daos';
import { SyncEngine, isStale } from '../sync/sync-engine';
import { POLL } from '../core/config';
import { Provider } from '../core/types';
import { useTheme } from './theme';

interface Props {
  engine: SyncEngine;
  db: SqlDb;
}

export default function CatalogPane({ engine, db }: Props) {
  const t = useTheme();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'regions'>('name');
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const list = await listProvidersFromDb(db);
      if (mounted.current) setProviders(list);
    } catch {
      // offline-safe
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
      await engine.refreshProviders();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [engine, load]);

  const q = query.trim().toLowerCase();
  const filtered = providers
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
    .sort((a, b) =>
      sort === 'regions'
        ? (b.datacenters?.length ?? 0) - (a.datacenters?.length ?? 0)
        : a.name.localeCompare(b.name),
    );

  const stale = isStale(engine.getStatus().providers?.lastOkAt, POLL.SNAPSHOT_DAILY_MS);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.accent} />
      }
    >
      {stale ? (
        <View style={[styles.notice, { backgroundColor: t.warn + '22', borderColor: t.warn + '44' }]}>
          <Text style={{ color: t.warn, fontSize: 12 }}>Snapshot stale — pull down to resync</Text>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <TextInput
          style={[styles.search, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
          placeholder="Search providers…"
          placeholderTextColor={t.subtext}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.sortRow}>
          {(['name', 'regions'] as const).map((s) => (
            <Pressable
              key={s}
              style={[styles.segment, { borderColor: s === sort ? t.accent : t.border }]}
              onPress={() => setSort(s)}
              accessibilityRole="radio"
              accessibilityState={{ selected: s === sort }}
            >
              <Text style={{ color: s === sort ? t.accent : t.subtext, fontSize: 11 }}>
                {s === 'name' ? 'name A–Z' : 'regions ↓'}
              </Text>
            </Pressable>
          ))}
          <Text style={{ color: t.subtext, fontSize: 11, marginLeft: 'auto' }}>
            {filtered.length} of {providers.length}
          </Text>
        </View>
      </View>

      {filtered.map((p) => {
        const datacenters = p.datacenters ?? [];
        return (
          <View key={p.slug} style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.rowHeader}>
              <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', flex: 1 }}>{p.name}</Text>
              {p.statusPageUrl ? (
                <Pressable onPress={() => void Linking.openURL(p.statusPageUrl as string)}>
                  <Text style={{ color: t.accent, fontSize: 11 }}>status ↗</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={{ color: t.subtext, fontSize: 11 }}>{p.slug}</Text>
            {datacenters.length ? (
              <View style={styles.chips}>
                {datacenters.slice(0, 3).map((d) => (
                  <View key={d} style={[styles.chip, { backgroundColor: t.accent + '18' }]}>
                    <Text style={{ color: t.accent, fontSize: 10 }}>{d}</Text>
                  </View>
                ))}
                {datacenters.length > 3 ? (
                  <Text style={{ color: t.subtext, fontSize: 10 }}>
                    +{datacenters.length - 3} more
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  notice: { borderRadius: 8, borderWidth: 1, padding: 8, marginBottom: 10 },
  search: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  sortRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  segment: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 6,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 },
  chip: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
});
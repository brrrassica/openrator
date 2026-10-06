/**
 * OpenRator — Provider Policy editor (M4.2/4.3, spec §8.3).
 * Reads the selected preset's routing rules (provider.only/order/ignore),
 * shows every provider's derived state, and toggles write a NEW preset
 * version via POST /presets/{slug}/chat/completions (cost-free, M0.4 spike).
 * Optimistic UI with rollback; server response is the source of truth.
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
import { getSetting, listProvidersFromDb, setSetting } from '../store/daos';
import { SyncEngine } from '../sync/sync-engine';
import { Preset, PresetConfig, Provider } from '../core/types';
import { nextRule, ruleFor, setRule, withRouting } from './policy-state';
import { useTheme } from './theme';

interface Props {
  engine: SyncEngine;
  db: SqlDb;
}

const SELECTED_SETTING = 'preset.slug_selected';
const PREFERENCES_URL = 'https://openrouter.ai/settings/preferences';
const DASHBOARD_PRESETS_URL = 'https://openrouter.ai/settings/presets';

const versionOf = (p: Preset | null): number | null => p?.designatedVersion?.version ?? null;

export default function PolicyPane({ engine, db }: Props) {
  const t = useTheme();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<Preset | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [modelsCount, setModelsCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const loadProviders = useCallback(async () => {
    try {
      const list = await listProvidersFromDb(db);
      if (mounted.current) setProviders(list);
    } catch {
      // offline-safe
    }
  }, [db]);

  const loadPresets = useCallback(async () => {
    try {
      const list = await engine.client.listPresets();
      const saved = await getSetting(db, SELECTED_SETTING);
      const wanted =
        list.find((p) => p.slug === saved) ?? list.find((p) => p.status !== 'archived') ?? null;
      if (mounted.current) {
        setPresets(list);
        if (wanted) {
          setSelected(wanted);
          void setSetting(db, SELECTED_SETTING, wanted.slug);
        } else {
          setSelected(null);
        }
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [engine, db]);

  useEffect(() => {
    mounted.current = true;
    void loadPresets();
    void loadProviders();
    void getSetting(db, 'models_user_count').then((n) => {
      if (mounted.current && n) setModelsCount(Number(n));
    });
    const unsub = engine.subscribe(() => {
      void loadProviders();
      void getSetting(db, 'models_user_count').then((n) => {
        if (mounted.current && n) setModelsCount(Number(n));
      });
    });
    return () => {
      mounted.current = false;
      unsub();
    };
  }, [engine, db, loadPresets, loadProviders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await engine.refreshProviders();
      await engine.refreshModels();
      await loadPresets();
      await loadProviders();
    } finally {
      setRefreshing(false);
    }
  }, [engine, loadPresets, loadProviders]);

  const config: PresetConfig | null = selected?.designatedVersion?.config ?? null;

  const onToggle = useCallback(
    async (slug: string) => {
      if (!selected || !config || busy) return;
      const curRule = ruleFor(config.provider, slug);
      const want = nextRule(curRule);
      const nextRouting = setRule(config.provider, slug, want);

      // optimistic
      const optim: Preset = { ...selected };
      if (optim.designatedVersion) {
        optim.designatedVersion = {
          ...optim.designatedVersion,
          config: withRouting(config, nextRouting),
        };
      }
      setSelected(optim);
      setError(null);
      setNotice(null);
      setBusy(true);
      try {
        const saved = await engine.client.upsertPreset(selected.slug, withRouting(config, nextRouting));
        if (!mounted.current) return;
        setSelected(saved);
        const v = versionOf(saved);
        const prevV = versionOf(selected);
        setNotice(
          prevV !== null && v !== null && v > prevV + 1
            ? `Saved as version ${v} (a newer version already existed — this write won).`
            : v !== null
              ? `Saved — version ${v}`
              : 'Saved.',
        );
        void loadPresets();
      } catch (e) {
        if (!mounted.current) return;
        setSelected({ ...selected }); // rollback to last server truth
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [selected, config, busy, engine, loadPresets],
  );

  const ruleColors: Record<string, string> = {
    default: t.subtext,
    prioritized: t.accent,
    ignored: t.warn,
    included: '#4CAF50',
    excluded: t.subtext,
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.accent} />
      }
    >
      {error ? (
        <View style={[styles.notice, { backgroundColor: t.warn + '22', borderColor: t.warn + '44' }]}>
          <Text style={{ color: t.warn, fontSize: 12 }}>{error}</Text>
        </View>
      ) : null}
      {notice ? (
        <View style={[styles.notice, { backgroundColor: t.accent + '18', borderColor: t.accent + '44' }]}>
          <Text style={{ color: t.accent, fontSize: 12 }}>{notice}</Text>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Preset (routing rules)</Text>
        {presets.length === 0 ? (
          <>
            <Text style={{ color: t.subtext, fontSize: 13, lineHeight: 19 }}>
              No presets found. Create one on the OpenRouter dashboard — OpenRator edits it here, live.
            </Text>
            <Pressable onPress={() => void Linking.openURL(DASHBOARD_PRESETS_URL)}>
              <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700', marginTop: 6 }}>
                open dashboard presets ↗
              </Text>
            </Pressable>
          </>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            {presets.map((p) => {
              const active = selected?.slug === p.slug;
              return (
                <Pressable
                  key={p.slug}
                  style={[styles.chip, { borderColor: active ? t.accent : t.border }]}
                  onPress={() => {
                    setSelected(p);
                    setNotice(null);
                    void setSetting(db, SELECTED_SETTING, p.slug);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={{ color: active ? t.accent : t.text, fontSize: 12, fontWeight: active ? '700' : '400' }}>
                    {p.slug}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {selected ? (
          <Text style={{ color: t.subtext, fontSize: 11, marginTop: 6 }}>
            version {versionOf(selected) ?? '?'}
            {config?.model ? ` · model ${config.model}` : ''}
          </Text>
        ) : null}
      </View>

      {selected ? (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.rowHeader}>
            <Text style={[styles.cardTitle, { color: t.text }]}>Provider routing</Text>
            <Text style={{ color: t.subtext, fontSize: 10 }}>tap to cycle</Text>
          </View>
          <Text style={{ color: t.subtext, fontSize: 11, marginBottom: 8 }}>
            {providers.length === 0 ? 'Loading providers…' : `${providers.length} providers`}
          </Text>
          {providers.map((p) => {
            const rule = ruleFor(config?.provider, p.slug);
            const color = ruleColors[rule];
            return (
              <Pressable
                key={p.slug}
                style={styles.providerRow}
                onPress={() => void onToggle(p.slug)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`${p.name}: ${rule}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={{ color: t.subtext, fontSize: 10 }}>
                    {p.slug} · {rule}
                  </Text>
                </View>
                <Text style={{ color, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>
                  {rule}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Account-wide prefs</Text>
        <Text style={{ color: t.subtext, fontSize: 13, lineHeight: 19 }}>
          {modelsCount === null
            ? 'Fetching model visibility…'
            : `${modelsCount} models visible to your key's provider prefs (read-only).`}
          {'\n'}
          Routing favourites, ignore-lists and privacy are managed globally on the dashboard.
        </Text>
        <Pressable onPress={() => void Linking.openURL(PREFERENCES_URL)}>
          <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700', marginTop: 6 }}>
            manage globally ↗
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  notice: { borderRadius: 8, borderWidth: 1, padding: 8, marginBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginRight: 8 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8888',
  },
});
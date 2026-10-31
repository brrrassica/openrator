/**
 * OpenRator — Accounts pane (M7.7).
 * Add/remove per-provider credentials, store an optional management key, and
 * trigger a full sign-out. Raw keys are written only to secure storage.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CredentialService } from '../core/credentials';
import { clearAllData, getProviderSetting } from '../store/daos';
import { SqlDb } from '../store/db';
import { SyncEngine } from '../sync/sync-engine';
import { listDescriptors } from '../providers/registry';
import { ProviderId } from '../providers/types';
import { useTheme } from './theme';

interface Props {
  engine: SyncEngine;
  db: SqlDb;
  creds: CredentialService;
  onAccountsChanged?: () => void;
  onSignOut?: () => void;
}

export default function AccountsPane({
  engine,
  db,
  creds,
  onAccountsChanged,
  onSignOut,
}: Props) {
  const t = useTheme();
  const providers = listDescriptors();
  const [configured, setConfigured] = useState<ProviderId[]>([]);
  const [selected, setSelected] = useState<ProviderId>(providers[0]?.id ?? 'openrouter');
  const [key, setKey] = useState('');
  const [mgmtKey, setMgmtKey] = useState('');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ids = await creds.providersWithKeys();
    setConfigured(ids);
    const next: Record<string, string> = {};
    for (const id of ids) {
      next[id] =
        (await getProviderSetting(db, id, 'account.label')) ??
        (await getProviderSetting(db, id, 'credential.key_hash')) ??
        'saved key';
    }
    setLabels(next);
  }, [creds, db]);

  useEffect(() => {
    void load();
    const unsub = engine.subscribe(() => void load());
    return unsub;
  }, [engine, load]);

  const descriptor = providers.find((p) => p.id === selected) ?? providers[0];

  const add = async () => {
    if (busy || !descriptor) return;
    if (!descriptor.keyPattern.test(key.trim())) {
      setError(descriptor.keyHint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await creds.saveKey(key, false, selected);
      if (descriptor.supportsManagementKey && mgmtKey.trim()) {
        await creds.saveManagementKey(mgmtKey.trim(), selected);
      }
      setKey('');
      setMgmtKey('');
      await load();
      onAccountsChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: ProviderId) => {
    setBusy(true);
    setError(null);
    try {
      await creds.clearProvider(id);
      await clearAllData(db, id);
      await load();
      onAccountsChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Connected providers</Text>
        {configured.length === 0 ? (
          <Text style={{ color: t.subtext, fontSize: 13 }}>No providers connected.</Text>
        ) : (
          configured.map((id) => {
            const d = providers.find((p) => p.id === id);
            return (
              <View key={id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>
                    {d?.displayName ?? id}
                  </Text>
                  <Text style={{ color: t.subtext, fontSize: 10 }}>
                    {labels[id] ?? 'saved key'}
                  </Text>
                </View>
                <Pressable
                  style={[styles.segment, { borderColor: t.warn }]}
                  onPress={() => void remove(id)}
                  disabled={busy}
                  accessibilityRole="button"
                >
                  <Text style={{ color: t.warn, fontSize: 12, fontWeight: '700' }}>remove</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Add a provider</Text>
        <View style={styles.providerRow}>
          {providers.map((p) => {
            const active = p.id === selected;
            return (
              <Pressable
                key={p.id}
                style={[styles.segment, { borderColor: active ? t.accent : t.border }]}
                onPress={() => {
                  setSelected(p.id);
                  setError(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Text style={{ color: active ? t.accent : t.subtext, fontSize: 12 }}>
                  {p.displayName}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
          value={key}
          onChangeText={setKey}
          placeholder="primary key"
          placeholderTextColor={t.subtext}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        {descriptor?.supportsManagementKey ? (
          <TextInput
            style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
            value={mgmtKey}
            onChangeText={setMgmtKey}
            placeholder="management key (optional)"
            placeholderTextColor={t.subtext}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : null}
        {error ? <Text style={{ color: t.warn, fontSize: 12, marginTop: 6 }}>{error}</Text> : null}
        <Pressable
          style={[styles.segment, { borderColor: t.accent, alignSelf: 'flex-start', marginTop: 10 }]}
          onPress={() => void add()}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
            {busy ? 'saving…' : 'save provider'}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Sign out</Text>
        <Text style={{ color: t.subtext, fontSize: 13, lineHeight: 19 }}>
          Removes every provider credential from secure storage and wipes cached
          usage data from this device.
        </Text>
        {onSignOut ? (
          <Pressable
            style={[styles.segment, { borderColor: t.danger, alignSelf: 'flex-start', marginTop: 10 }]}
            onPress={onSignOut}
            accessibilityRole="button"
          >
            <Text style={{ color: t.danger, fontSize: 12, fontWeight: '700' }}>
              sign out all providers
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8888',
  },
  providerRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  segment: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginRight: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    marginTop: 8,
  },
});

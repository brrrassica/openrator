/**
 * OpenRator — Keys pane (M4.4/4.5, spec §8.4).
 * Current-key card (never the secret) + mgmt-gated key list CRUD
 * (rename / limit / reset / expiry / revoke, double-confirmed) and a
 * create-key flow whose full value is revealed once, copy/test-able,
 * then collapsed and never persisted (keys-flow state machine).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SqlDb } from '../store/db';
import { getKeyRow, getSetting } from '../store/daos';
import { SyncEngine } from '../sync/sync-engine';
import { AdminKey, KeyRow } from '../core/types';
import { fmtUsd } from './chart-math';
import { initialRevealState, revealReducer } from './keys-flow';
import { useTheme } from './theme';

interface Props {
  engine: SyncEngine;
  db: SqlDb;
  onSignOut?: () => void;
}

const RESETS = ['daily', 'weekly', 'monthly'] as const;
type Reset = (typeof RESETS)[number] | '';

export default function KeysPane({ engine, db, onSignOut }: Props) {
  const t = useTheme();
  const [key, setKey] = useState<KeyRow | null>(null);
  const [mgmt, setMgmt] = useState<boolean | null>(null);
  const [adminKeys, setAdminKeys] = useState<AdminKey[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const hash = await getSetting(db, 'credential.key_hash');
      const k = hash ? await getKeyRow(db, hash) : null;
      const isMgmt = await engine.isManagementKey();
      if (mounted.current) {
        setKey(k);
        setMgmt(isMgmt);
      }
      if (isMgmt) {
        const list = await engine.client.listAdminKeys();
        if (mounted.current) setAdminKeys(list);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [engine, db]);

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
    setError(null);
    try {
      await engine.refreshCredits();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [engine, load]);

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

      {key ? <CurrentKeyCard keyRow={key} theme={t} /> : null}

      {mgmt === false ? (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.cardTitle, { color: t.text }]}>Key management locked</Text>
          <Text style={{ color: t.subtext, fontSize: 13, lineHeight: 19 }}>
            Adding a management key unlocks the key list, limits and revoke
            controls. As a standard key you can still watch your own key card.
          </Text>
        </View>
      ) : null}

      {mgmt === true ? (
        <>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: t.text }]}>Keys ({adminKeys.length})</Text>
            <Pressable
              style={[styles.segment, { borderColor: t.accent }]}
              onPress={() => {
                setCreating((c) => !c);
                setEditingId(null);
              }}
              accessibilityRole="button"
            >
              <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
                {creating ? 'cancel' : '+ create key'}
              </Text>
            </Pressable>
          </View>

          {creating ? (
            <CreateKeyForm
              theme={t}
              onDone={async () => {
                setCreating(false);
                await load();
              }}
              client={engine.client}
            />
          ) : null}

          {adminKeys.map((ak) => (
            <View key={ak.id} style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
              <Pressable
                style={styles.keyRow}
                onPress={() => setEditingId(editingId === ak.id ? null : ak.id)}
                accessibilityRole="button"
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
                    {ak.label || '(unnamed)'}
                    {ak.isManagementKey ? ' · mgmt' : ''}
                  </Text>
                  <Text style={{ color: t.subtext, fontSize: 10 }}>
                    {ak.id.slice(0, 8)} · {fmtUsd(ak.usageMonthly)}/mo
                    {ak.limit > 0 ? ` · limit ${fmtUsd(ak.limit)} (${fmtUsd(ak.limitRemaining)} left)` : ''}
                    {ak.limitReset ? ` · ${ak.limitReset}` : ''}
                  </Text>
                </View>
                <Text style={{ color: t.subtext, fontSize: 11 }}>
                  {editingId === ak.id ? '▴' : '▾'}
                </Text>
              </Pressable>
              {editingId === ak.id ? (
                <KeyEditor
                  theme={t}
                  adminKey={ak}
                  client={engine.client}
                  onDone={async () => {
                    setEditingId(null);
                    await load();
                  }}
                />
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

// ---- current key ----------------------------------------------------------

function CurrentKeyCard({ keyRow, theme: t }: { keyRow: KeyRow; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.cardTitle, { color: t.text }]}>Current key</Text>
      <View style={styles.keyRow}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
            {keyRow.label}
            {keyRow.isManagement ? ' · management' : ''}
          </Text>
          <Text style={{ color: t.subtext, fontSize: 10 }}>…{keyRow.hash.slice(0, 12)}</Text>
        </View>
        {keyRow.limit > 0 ? (
          <Text style={{ color: t.text, fontSize: 12, fontWeight: '700' }}>
            {fmtUsd(keyRow.limitRemaining)} / {fmtUsd(keyRow.limit)} left
          </Text>
        ) : null}
      </View>
      <View style={styles.windowRow}>
        <WindowStat label="today" value={fmtUsd(keyRow.usageDaily)} theme={t} />
        <WindowStat label="week" value={fmtUsd(keyRow.usageWeekly)} theme={t} />
        <WindowStat label="month" value={fmtUsd(keyRow.usageMonthly)} theme={t} />
      </View>
      {keyRow.limitReset ? (
        <Text style={{ color: t.subtext, fontSize: 10, marginTop: 4 }}>
          resets {keyRow.limitReset}
          {keyRow.expiresAt ? ` · expires ${keyRow.expiresAt}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

function WindowStat({ label, value, theme: t }: { label: string; value: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.subtext, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

// ---- edit one key ---------------------------------------------------------

function KeyEditor({
  adminKey,
  client,
  theme: t,
  onDone,
}: {
  adminKey: AdminKey;
  client: SyncEngine['client'];
  theme: ReturnType<typeof useTheme>;
  onDone: () => Promise<void>;
}) {
  const [label, setLabel] = useState(adminKey.label ?? '');
  const [limit, setLimit] = useState(adminKey.limit > 0 ? String(adminKey.limit) : '');
  const [reset, setReset] = useState<Reset>(adminKey.limitReset ?? '');
  const [expires, setExpires] = useState(adminKey.expiresAt ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await client.patchAdminKey(adminKey.id, {
        label: label.trim() || undefined,
        limit: limit.trim() ? Number(limit) : undefined,
        limitReset: reset || undefined,
        expiresAt: expires.trim() || undefined,
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const revoke = () => {
    Alert.alert(
      `Revoke ${adminKey.label || 'key'}?`,
      'This cannot be undone. Requests using this key will start failing immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            client
              .deleteAdminKey(adminKey.id)
              .then(onDone)
              .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
          },
        },
      ],
    );
  };

  return (
    <View style={{ marginTop: 8 }}>
      {err ? (
        <Text style={{ color: t.warn, fontSize: 11, marginBottom: 6 }}>{err}</Text>
      ) : null}
      <TextInput
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
        value={label}
        onChangeText={setLabel}
        placeholder="label"
        placeholderTextColor={t.subtext}
      />
      <TextInput
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
        value={limit}
        onChangeText={setLimit}
        placeholder="limit ($, empty = no limit)"
        placeholderTextColor={t.subtext}
        keyboardType="numeric"
      />
      <View style={styles.resetRow}>
        {RESETS.map((r) => (
          <Pressable
            key={r}
            style={[styles.segment, { borderColor: r === reset ? t.accent : t.border }]}
            onPress={() => setReset(reset === r ? '' : r)}
            accessibilityRole="radio"
            accessibilityState={{ selected: r === reset }}
          >
            <Text style={{ color: r === reset ? t.accent : t.subtext, fontSize: 11 }}>{r}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
        value={expires}
        onChangeText={setExpires}
        placeholder="expires at (ISO, empty = clear)"
        placeholderTextColor={t.subtext}
        autoCapitalize="none"
      />
      <View style={styles.actionRow}>
        <Pressable style={[styles.segment, { borderColor: t.accent }]} onPress={() => void save()} disabled={saving}>
          <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>{saving ? 'saving…' : 'save'}</Text>
        </Pressable>
        <Pressable style={[styles.segment, { borderColor: t.warn }]} onPress={revoke}>
          <Text style={{ color: t.warn, fontSize: 12, fontWeight: '700' }}>revoke</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---- create flow (reveal-later, M4.5) -------------------------------------

function CreateKeyForm({
  client,
  theme: t,
  onDone,
}: {
  client: SyncEngine['client'];
  theme: ReturnType<typeof useTheme>;
  onDone: () => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [limit, setLimit] = useState('');
  const [reveal, dispatch] = React.useReducer(revealReducer, initialRevealState);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setErr(null);
    setTestResult(null);
    try {
      const created = await client.createAdminKey({
        name: label.trim() || undefined,
        limit: limit.trim() ? Number(limit) : undefined,
      });
      dispatch({ type: 'reveal', keyValue: created.key });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const test = async () => {
    if (!reveal.keyValue) return;
    setTestResult('testing…');
    try {
      const keyStatus = await import('../core/client').then((m) =>
        m.testRawKey(reveal.keyValue as string),
      );
      setTestResult(
        `✓ works — ${keyStatus.label}${keyStatus.isManagementKey ? ' (management)' : ''}`,
      );
      dispatch({ type: 'test' });
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.accent + '66' }]}>
      <Text style={[styles.cardTitle, { color: t.text }]}>Create key</Text>
      <TextInput
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
        value={label}
        onChangeText={setLabel}
        placeholder="label (required for future management)"
        placeholderTextColor={t.subtext}
      />
      <TextInput
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
        value={limit}
        onChangeText={setLimit}
        placeholder="limit ($, optional)"
        placeholderTextColor={t.subtext}
        keyboardType="numeric"
      />
      {err ? <Text style={{ color: t.warn, fontSize: 11, marginTop: 4 }}>{err}</Text> : null}

      {reveal.status === 'revealed' ? (
        <View style={[styles.revealBox, { backgroundColor: t.bg, borderColor: t.accent + '66' }]}>
          <Text style={{ color: t.subtext, fontSize: 11 }}>
            Show once — copy it now. OpenRator never stores this value.
          </Text>
          <Text selectable style={{ color: t.text, fontSize: 12, marginVertical: 8 }}>
            {reveal.keyValue}
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.segment, { borderColor: t.accent }]}
              onPress={() => {
                void Clipboard.setStringAsync(reveal.keyValue as string);
                dispatch({ type: 'copy' });
              }}
            >
              <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
                {reveal.copiedAt ? 'copied ✓' : 'copy'}
              </Text>
            </Pressable>
            <Pressable style={[styles.segment, { borderColor: t.accent }]} onPress={() => void test()}>
              <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
                {reveal.testedAt ? 'tested ✓' : 'test'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segment, { borderColor: t.border }]}
              onPress={() => {
                dispatch({ type: 'collapse' });
                void onDone();
              }}
            >
              <Text style={{ color: t.subtext, fontSize: 12 }}>I saved it</Text>
            </Pressable>
          </View>
          {testResult ? (
            <Text style={{ color: t.accent, fontSize: 11, marginTop: 6 }}>{testResult}</Text>
          ) : null}
        </View>
      ) : (
        <Pressable
          style={[styles.segment, { borderColor: t.accent, alignSelf: 'flex-start', marginTop: 8 }]}
          onPress={() => void create()}
          disabled={creating}
        >
          <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
            {creating ? 'creating…' : 'create'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notice: { borderRadius: 8, borderWidth: 1, padding: 8, marginBottom: 10 },
  keyRow: { flexDirection: 'row', alignItems: 'center' },
  windowRow: { flexDirection: 'row', marginTop: 10 },
  segment: {
    borderWidth: 1,
    borderRadius: 8,
    // ≥ 40 px touch target (WCAG 2.5.5)
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginRight: 8,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  resetRow: { flexDirection: 'row', marginBottom: 8 },
  actionRow: { flexDirection: 'row', marginTop: 4 },
  revealBox: { borderRadius: 8, borderWidth: 1, padding: 10, marginTop: 8 },
});
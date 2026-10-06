/**
 * OpenRator — app shell (M2.1): bottom tabs + themed header. Placeholder
 * tabs ship in M3 (Spend) / M4 (Providers, Keys).
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SqlDb } from '../store/db';
import { SyncEngine } from '../sync/sync-engine';
import HomePane from './home-pane';
import SpendPane from './spend-pane';
import { useTheme } from './theme';

export type Tab = 'home' | 'spend' | 'providers' | 'keys';

const TABS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'spend', icon: '📊', label: 'Spend' },
  { id: 'providers', icon: '🌐', label: 'Providers' },
  { id: 'keys', icon: '🔑', label: 'Keys' },
];

const TITLES: Record<Tab, string> = {
  home: 'OpenRator',
  spend: 'Spend & Endpoint Analytics',
  providers: 'Provider Policy',
  keys: 'Keys',
};

interface Props {
  engine: SyncEngine;
  db: SqlDb;
}

export default function Shell({ engine, db }: Props) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('home');

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <Text style={[styles.headerTitle, { color: t.text }]}>{TITLES[tab]}</Text>
      </View>

      <View style={styles.body}>
        {tab === 'home' ? <HomePane engine={engine} db={db} /> : null}
        {tab === 'spend' ? <SpendPane engine={engine} db={db} /> : null}
        {tab === 'providers' ? (
          <Placeholder
            title="Provider Policy"
            text={'Routing policy editor via presets + account-wide prefs — shipping in M4.'}
          />
        ) : null}
        {tab === 'keys' ? (
          <Placeholder
            title="Keys"
            text={'Key card, list and CRUD with a management key — shipping in M4.'}
          />
        ) : null}
      </View>

      <View style={[styles.tabbar, { backgroundColor: t.card, borderTopColor: t.border }]}>
        {TABS.map((tb) => {
          const active = tab === tb.id;
          return (
            <Pressable
              key={tb.id}
              style={styles.tab}
              onPress={() => setTab(tb.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={{ fontSize: 18 }}>{tb.icon}</Text>
              <Text
                style={{ fontSize: 11, color: active ? t.accent : t.subtext, fontWeight: active ? '700' : '400' }}
              >
                {tb.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  const t = useTheme();
  return (
    <View style={styles.placeholder}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', marginBottom: 6 }}>{title}</Text>
      <Text style={{ color: t.subtext, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  body: { flex: 1 },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 24,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});
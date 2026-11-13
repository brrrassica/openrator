/**
 * OpenRator — app shell (M2.1, M7.8): bottom tabs, provider switcher, and
 * global "All providers" scope. Capability-gated tabs show an explainer
 * instead of a fake control.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CredentialService } from '../core/credentials';
import { SqlDb } from '../store/db';
import { SyncEngine } from '../sync/sync-engine';
import { getDescriptor } from '../providers/registry';
import { ProviderId } from '../providers/types';
import HomePane from './home-pane';
import SpendPane from './spend-pane';
import CatalogPane from './catalog-pane';
import PolicyPane from './policy-pane';
import KeysPane from './keys-pane';
import AccountsPane from './accounts-pane';
import { BrandMark } from './brand-mark';
import { Icon, IconName } from './icons';
import { useTheme } from './theme';

export type Tab = 'home' | 'spend' | 'providers' | 'keys' | 'accounts';
export type ProviderScope = 'all' | ProviderId;

const TABS: Array<{ id: Tab; icon: IconName; label: string }> = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'spend', icon: 'spend', label: 'Spend' },
  { id: 'providers', icon: 'providers', label: 'Providers' },
  { id: 'keys', icon: 'keys', label: 'Keys' },
  { id: 'accounts', icon: 'settings', label: 'Accounts' },
];

const TITLES: Record<Tab, string> = {
  home: 'OpenRator',
  spend: 'Spend & Endpoint Analytics',
  providers: 'Provider Policy',
  keys: 'Keys',
  accounts: 'Accounts',
};

interface Props {
  engine: SyncEngine;
  db: SqlDb;
  creds: CredentialService;
  onSignOut?: () => void | Promise<void>;
  onAccountsChanged?: () => void;
}

export default function Shell({ engine, db, creds, onSignOut, onAccountsChanged }: Props) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('home');
  const configured = engine.getProviders();
  const [scope, setScope] = useState<ProviderScope>(
    configured.length > 1 ? 'all' : configured[0] ?? 'all',
  );
  const configuredKey = configured.join(',');
  useEffect(() => {
    if (scope !== 'all' && !configured.includes(scope)) {
      setScope(configured.length > 1 ? 'all' : configured[0] ?? 'all');
    }
  }, [configuredKey, configured, scope]);

  const activeCaps =
    scope === 'all'
      ? {
          keyManagement: configured.some((p) => engine.getCapabilities(p)?.keyManagement),
          providerCatalog: configured.some((p) => engine.getCapabilities(p)?.providerCatalog),
          routingPolicy: configured.some((p) => engine.getCapabilities(p)?.routingPolicy),
        }
      : engine.getCapabilities(scope);

  const scopeLabel = scope === 'all' ? 'All providers' : getDescriptor(scope).displayName;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <View style={styles.brandRow}>
          <BrandMark size={22} color={t.accent} />
          <Text style={[styles.headerTitle, { color: t.text }]}>{TITLES[tab]}</Text>
        </View>
        {configured.length > 0 ? (
          <View style={styles.scopeRow}>
            {(['all', ...configured] as ProviderScope[]).map((id) => {
              const active = scope === id;
              const label = id === 'all' ? 'All' : getDescriptor(id).shortName;
              return (
                <Pressable
                  key={id}
                  style={[styles.scopeChip, { borderColor: active ? t.accent : t.border }]}
                  onPress={() => setScope(id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={{ color: active ? t.accent : t.subtext, fontSize: 11 }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            <Text style={{ color: t.subtext, fontSize: 10, marginLeft: 'auto' }}>
              {scopeLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        {tab === 'home' ? <HomePane engine={engine} db={db} provider={scope} /> : null}
        {tab === 'spend' ? <SpendPane engine={engine} db={db} provider={scope} /> : null}
        {tab === 'providers' ? (
          !activeCaps?.providerCatalog && !activeCaps?.routingPolicy ? (
            <CapabilityExplainer
              title="Provider catalog unavailable"
              body="This provider's API does not expose a catalog or routing policy. Use its dashboard for those controls."
            />
          ) : (
            <ProvidersPane engine={engine} db={db} provider={scope} />
          )
        ) : null}
        {tab === 'keys' ? (
          !activeCaps?.keyManagement ? (
            <CapabilityExplainer
              title="Key management unavailable"
              body="This provider's API does not expose key management. You can still see its account balance and spend windows on Home."
            />
          ) : (
            <KeysPane engine={engine} db={db} provider={scope} onSignOut={onSignOut} />
          )
        ) : null}
        {tab === 'accounts' ? (
          <AccountsPane
            engine={engine}
            db={db}
            creds={creds}
            onSignOut={onSignOut}
            onAccountsChanged={onAccountsChanged}
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
              <Icon name={tb.icon} size={21} color={active ? t.accent : t.subtext} />
              <Text
                style={{ fontSize: 10, color: active ? t.accent : t.subtext, fontWeight: active ? '700' : '400' }}
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

/** Providers tab: catalog (browse) ⇄ policy (routing editor). */
function ProvidersPane({
  engine,
  db,
  provider,
}: {
  engine: SyncEngine;
  db: SqlDb;
  provider: ProviderScope;
}) {
  const t = useTheme();
  const [view, setView] = useState<'catalog' | 'policy'>('catalog');
  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.paneToggle, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        {(['catalog', 'policy'] as const).map((v) => (
          <Pressable
            key={v}
            style={[styles.seg, { backgroundColor: v === view ? t.accent + '22' : 'transparent' }]}
            onPress={() => setView(v)}
            accessibilityRole="tab"
            accessibilityState={{ selected: v === view }}
          >
            <Text
              style={{
                color: v === view ? t.accent : t.subtext,
                fontSize: 13,
                fontWeight: v === view ? '700' : '400',
              }}
            >
              {v === 'catalog' ? 'Catalog' : 'Policy'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        {view === 'catalog' ? (
          <CatalogPane engine={engine} db={db} provider={provider} />
        ) : (
          <PolicyPane engine={engine} db={db} provider={provider} />
        )}
      </View>
    </View>
  );
}

function CapabilityExplainer({ title, body }: { title: string; body: string }) {
  const t = useTheme();
  return (
    <View style={styles.placeholder}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', marginBottom: 6 }}>{title}</Text>
      <Text style={{ color: t.subtext, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingTop: 48,
    paddingBottom: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', marginLeft: 8 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  scopeChip: {
    borderWidth: 1,
    borderRadius: 999,
    // ≥ 44 px touch target (M5.4 / WCAG 2.5.5)
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 6,
  },
  body: { flex: 1 },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 24,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: 8 },
  paneToggle: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seg: { borderRadius: 8, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});

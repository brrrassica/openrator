/**
 * OpenRator — onboarding (M1.1, M7.7): choose a provider, paste its key,
 * optional label, and a management-key toggle where supported. Key never
 * logged; format-gated before save; paste-warn note inline.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { CredentialService } from '../core/credentials';
import { listDescriptors, getDescriptor } from '../providers/registry';
import { ProviderDescriptor, ProviderId } from '../providers/types';
import { BrandMark } from './brand-mark';
import { useTheme } from './theme';

interface Props {
  creds: CredentialService;
  providers?: ProviderDescriptor[];
  onDone: () => void;
  onError?: (message: string) => void;
}

export default function OnboardingScreen({
  creds,
  providers = listDescriptors(),
  onDone,
  onError,
}: Props) {
  const t = useTheme();
  const [providerId, setProviderId] = useState<ProviderId>(providers[0]?.id ?? 'openrouter');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [isMgmt, setIsMgmt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const provider = getDescriptor(providerId);
  const valid = provider.keyPattern.test(key.trim());

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await creds.saveKey(key, provider.supportsManagementKey ? isMgmt : false, providerId);
      onDone();
    } catch (e) {
      // WS2-7: a failed secure-store write must be surfaced; we do NOT advance.
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <View style={styles.brand}>
        <BrandMark size={56} color={t.accent} />
      </View>
      <Text style={[styles.title, { color: t.text }]}>Welcome to OpenRator</Text>
      <Text style={[styles.tagline, { color: t.subtext }]}>One pane for every AI bill</Text>
      <Text style={[styles.body, { color: t.subtext }]}>
        Paste your {provider.displayName} API key. It is stored only on this
        device and sent only to{' '}
        {provider.id === 'openrouter' ? 'openrouter.ai' : 'opencode.ai'} over TLS.
        OpenRator never logs it.
      </Text>

      {providers.length > 1 ? (
        <>
          <Text style={[styles.fieldLabel, { color: t.text }]}>Provider</Text>
          <View style={styles.providerRow}>
            {providers.map((p) => {
              const active = p.id === providerId;
              return (
                <Pressable
                  key={p.id}
                  style={[
                    styles.providerChip,
                    { borderColor: active ? t.accent : t.border, backgroundColor: t.card },
                  ]}
                  onPress={() => {
                    setProviderId(p.id);
                    setIsMgmt(false);
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
        </>
      ) : null}

      <View style={[styles.pasteWarn, { borderColor: t.warn, backgroundColor: t.warn + '18' }]}>
        <Text style={[styles.pasteWarnText, { color: t.warn }]}>
          Paste warning: this key will be saved to this device’s secure store.
          It also stays in your clipboard/history — clear it there too.
        </Text>
      </View>

      <Text style={[styles.fieldLabel, { color: t.text }]}>API key</Text>
      <TextInput
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
        value={key}
        onChangeText={setKey}
        placeholder={provider.id === 'openrouter' ? 'sk-or-v1-…' : 'opencode key'}
        placeholderTextColor={t.subtext}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        testID="onboarding.key"
      />

      <Text style={[styles.fieldLabel, { color: t.text }]}>
        Label (optional, shown on the Home pane)
      </Text>
      <TextInput
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. homelab"
        placeholderTextColor={t.subtext}
        testID="onboarding.label"
      />

      {provider.supportsManagementKey ? (
        <View style={styles.row}>
          <Switch
            value={isMgmt}
            onValueChange={setIsMgmt}
            trackColor={{ false: t.border, true: t.accent }}
            thumbColor={t.accentText}
          />
          <Text style={[styles.rowText, { color: t.subtext }]}>
            Also a management key — unlocks 30-day spend analytics, key list and
            key editing (spec §5.2).
          </Text>
        </View>
      ) : null}

      {err ? <Text style={[styles.error, { color: t.danger }]}>{err}</Text> : null}

      <Pressable
        style={[
          styles.button,
          { backgroundColor: !valid || busy ? t.border : t.accent },
        ]}
        disabled={!valid || busy}
        onPress={() => save()}
      >
        <Text style={[styles.buttonText, { color: t.accentText }]}>
          {valid ? 'Save key' : 'Enter a valid key'}
        </Text>
      </Pressable>
      {!valid && key.length > 0 ? (
        <Text style={[styles.hint, { color: t.subtext }]}>{provider.keyHint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: 'center' },
  brand: { alignSelf: 'center', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  tagline: { fontSize: 13, marginBottom: 14 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  providerRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, marginBottom: 8 },
  providerChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginRight: 8,
    marginBottom: 8,
  },
  pasteWarn: {
    borderStyle: 'dashed',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  pasteWarnText: { fontSize: 12, lineHeight: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginTop: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  rowText: { flex: 1, fontSize: 13, marginLeft: 8 },
  error: { fontSize: 13, marginTop: 8 },
  hint: { fontSize: 12, marginTop: 4 },
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 16,
  },
  buttonText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
});

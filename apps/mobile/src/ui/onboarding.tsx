/**
 * OpenRator — onboarding (M1.1): paste key, optional label, management-key
 * toggle. Key never logged; format-gated before save; paste-warn note inline.
 * Themed via useTheme() so it renders correctly in dark mode (WS2-4).
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { CredentialService } from '../core/credentials';
import { useTheme } from './theme';

interface Props {
  creds: CredentialService;
  onDone: () => void;
  onError?: (message: string) => void;
}

export default function OnboardingScreen({ creds, onDone, onError }: Props) {
  const t = useTheme();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [isMgmt, setIsMgmt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = CredentialService.looksLikeKey(key);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await creds.saveKey(key, isMgmt);
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
      <Text style={[styles.title, { color: t.text }]}>Welcome to OpenRator</Text>
      <Text style={[styles.body, { color: t.subtext }]}>
        Paste your OpenRouter API key (sk-or-v1-…). It is stored only on this
        device and sent only to openrouter.ai over TLS. OpenRator never logs it.
      </Text>

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
        placeholder="sk-or-v1-…"
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
        <Text style={[styles.hint, { color: t.subtext }]}>
          Keys start with sk-or-v1- and are at least 20 chars.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
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
/**
 * OpenRator — onboarding (M1.1): paste key, optional label, management-key
 * toggle. Key never logged; format-gated before save; paste-warn note inline.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { CredentialService } from '../core/credentials';

interface Props {
  creds: CredentialService;
  onDone: () => void;
  onError?: (message: string) => void;
}

export default function OnboardingScreen({ creds, onDone, onError }: Props) {
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
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Welcome to OpenRator</Text>
      <Text style={styles.body}>
        Paste your OpenRouter API key (sk-or-v1-…). It is stored only on this
        device and sent only to openrouter.ai over TLS. OpenRator never logs it.
      </Text>

      <Text style={styles.fieldLabel}>API key</Text>
      <TextInput
        style={styles.input}
        value={key}
        onChangeText={setKey}
        placeholder="sk-or-v1-…"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        testID="onboarding.key"
      />

      <Text style={styles.fieldLabel}>Label (optional, shown on the Home pane)</Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. homelab"
        testID="onboarding.label"
      />

      <View style={styles.row}>
        <Switch value={isMgmt} onValueChange={setIsMgmt} />
        <Text style={styles.rowText}>
          Also a management key — unlocks 30-day spend analytics, key list and
          key editing (spec §5.2).
        </Text>
      </View>

      {err ? <Text style={styles.error}>{err}</Text> : null}

      <Pressable
        style={[styles.button, !valid || busy ? styles.buttonDisabled : null]}
        disabled={!valid || busy}
        onPress={() => save()}
      >
        <Text style={styles.buttonText}>{valid ? 'Save key' : 'Enter a valid key'}</Text>
      </Pressable>
      {!valid && key.length > 0 ? (
        <Text style={styles.hint}>Keys start with sk-or-v1- and are at least 20 chars.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 16, color: '#666' },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginTop: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  rowText: { flex: 1, fontSize: 13, marginLeft: 8, color: '#555' },
  error: { color: '#c00', fontSize: 13, marginTop: 8 },
  hint: { color: '#888', fontSize: 12, marginTop: 4 },
  button: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 16,
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
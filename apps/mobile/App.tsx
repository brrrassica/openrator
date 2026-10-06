/**
 * OpenRator — app entry: M1 wiring (onboarding → key → client → DB →
 * first sync). Real screens arrive in M2; this proves the whole data path
 * end-to-end on a device.
 */

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { CredentialService, createSecureKeyValueStore } from './src/core/credentials';
import { OpenRouterClient } from './src/core/client';
import { migrate } from './src/store/daos';
import { openDb, SqlDb } from './src/store/db';
import { SyncEngine } from './src/sync/sync-engine';
import OnboardingScreen from './src/ui/onboarding';

type Stage = 'booting' | 'onboarding' | 'ready' | 'fatal';

interface Ctx {
  creds: CredentialService;
  db: SqlDb;
}

export default function App() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [stage, setStage] = useState<Stage>('booting');
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const store = await createSecureKeyValueStore();
        const creds = new CredentialService(store);
        const db = await openDb();
        await migrate(db);
        if (cancel) return;
        setCtx({ creds, db });
        setStage((await creds.hasKey()) ? 'ready' : 'onboarding');
      } catch (e) {
        setNote(String(e));
        setStage('fatal');
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  async function bootWithKey(key: string) {
    if (!ctx) return;
    const client = new OpenRouterClient({ apiKey: key });
    const eng = new SyncEngine(client, ctx.creds, ctx.db, {
      onError: (src, e) => setNote(`${src}: ${e.message}`),
    });
    setEngine(eng);
    void eng.refreshAll().then(() => {
      eng.start(true);
      setStage('ready');
    });
  }

  if (stage === 'booting') {
    return (
      <View style={styles.center}>
        <Text>OpenRator — starting…</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (stage === 'fatal') {
    return (
      <View style={styles.center}>
        <Text style={styles.fatal}>Startup failed: {note}</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (stage === 'onboarding' && ctx) {
    return (
      <OnboardingScreen
        creds={ctx.creds}
        onDone={async () => {
          const key = await ctx.creds.getKey();
          if (key) void bootWithKey(key);
        }}
        onError={(m) => setNote(m)}
      />
    );
  }

  // ready — M1 summary card; replaced by real Home Pane in M2.
  return (
    <View style={styles.center}>
      <Text style={styles.readyTitle}>OpenRator · M1 skeleton</Text>
      <Text>Data layer wired. Home Pane arrives in M2.</Text>
      {engine ? <Text>Sync engine running (credits poll active).</Text> : null}
      {note ? <Text style={styles.note}>Note: {note}</Text> : null}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  fatal: { color: '#c00', fontSize: 14, textAlign: 'center' },
  note: { color: '#a50', fontSize: 12, marginTop: 8 },
  readyTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
});
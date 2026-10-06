/**
 * OpenRator — app entry: M2 shell wiring. Boot → onboarding (M1) or themed
 * tab shell with the Home Pane; sync engine runs behind the scenes.
 */

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { CredentialService, createSecureKeyValueStore } from './src/core/credentials';
import { OpenRouterClient } from './src/core/client';
import { migrate, setSetting } from './src/store/daos';
import { openDb, SqlDb } from './src/store/db';
import { SyncEngine } from './src/sync/sync-engine';
import OnboardingScreen from './src/ui/onboarding';
import Shell from './src/ui/shell';
import { ThemeProvider, useTheme } from './src/ui/theme';

type Stage = 'booting' | 'onboarding' | 'ready' | 'fatal';

interface Ctx {
  creds: CredentialService;
  db: SqlDb;
}

export default function App() {
  return (
    <ThemeProvider>
      <Inner />
    </ThemeProvider>
  );
}

function Inner() {
  const t = useTheme();
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
        const hasKey = await creds.hasKey();
        if (hasKey) {
          const key = await creds.getKey();
          if (key) {
            const eng = makeEngine(creds, db, key, setNote);
            setEngine(eng);
            eng.start(true);
            void eng.refreshAll();
            setStage('ready');
            return;
          }
        }
        setStage('onboarding');
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
        setStage('fatal');
      }
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stage === 'booting') {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ color: t.subtext }}>OpenRator — starting…</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (stage === 'fatal') {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ color: t.danger }}>Startup failed: {note}</Text>
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
          if (!key) return;
          const eng = makeEngine(ctx.creds, ctx.db, key, setNote);
          setEngine(eng);
          eng.start(true);
          void eng.refreshAll();
          setStage('ready');
        }}
        onError={(m) => setNote(m)}
      />
    );
  }

  if (stage === 'ready' && engine && ctx) {
    return (
      <Shell
        engine={engine}
        db={ctx.db}
        onSignOut={() => {
          engine.stop();
          void ctx.creds.clear();
          void setSetting(ctx.db, 'credential.key_hash', '');
          void setSetting(ctx.db, 'credential.key_prefix', '');
          setEngine(null);
          setStage('onboarding');
        }}
      />
    );
  }

  return null;
}

function makeEngine(
  creds: CredentialService,
  db: SqlDb,
  apiKey: string,
  onError: (note: string) => void,
): SyncEngine {
  const client = new OpenRouterClient({ apiKey });
  return new SyncEngine(client, creds, db, {
    onError: (src, e) => onError(`${src}: ${e.message}`),
  });
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
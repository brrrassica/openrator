/**
 * OpenRator — credential handling (spec §6.2, D2/D7, M0.8).
 * Key lives in expo-secure-store (hardware-backed where available); the
 * management-key flag is cached alongside. The raw key is NEVER logged and
 * never written to SQLite.
 */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const K_OPENROUTER_KEY = 'openrator.openrouter.key';
const K_OPENROUTER_MGMT = 'openrator.openrouter.is_management';

/** In-memory store — tests only. */
export class MemoryKeyValueStore implements KeyValueStore {
  private m = new Map<string, string>();
  async get(key: string) {
    return this.m.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.m.set(key, value);
  }
  async delete(key: string) {
    this.m.delete(key);
  }
}

/**
 * expo-secure-store-backed store. The import is deferred so unit tests on
 * node never touch the native module.
 */
export async function createSecureKeyValueStore(): Promise<KeyValueStore> {
  let storeModule: typeof import('expo-secure-store') | undefined;
  try {
    storeModule = (await import('expo-secure-store')) as typeof import('expo-secure-store');
  } catch {
    storeModule = undefined;
  }
  const impl = storeModule;
  return {
    async get(key: string) {
      if (!impl) return null;
      try {
        return (await impl.getItemAsync(key)) ?? null;
      } catch {
        return null;
      }
    },
    async set(key: string, value: string) {
      // WS2-7: never silently swallow a write failure — the caller must be
      // able to tell the user the key was NOT saved.
      if (!impl) throw new Error('Secure storage is unavailable on this device');
      await impl.setItemAsync(key, value);
    },
    async delete(key: string) {
      if (!impl) return;
      try {
        await impl.deleteItemAsync(key);
      } catch {
        // no-op
      }
    },
  };
}

export class CredentialService {
  constructor(private readonly store: KeyValueStore) {}

  async hasKey(): Promise<boolean> {
    return (await this.store.get(K_OPENROUTER_KEY)) !== null;
  }

  async saveKey(key: string, isManagement: boolean): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('Key must not be empty');
    await this.store.set(K_OPENROUTER_KEY, trimmed);
    await this.store.set(K_OPENROUTER_MGMT, isManagement ? '1' : '0');
  }

  async getKey(): Promise<string | null> {
    return this.store.get(K_OPENROUTER_KEY);
  }

  /** Highest-confidence management flag: persisted toggle overrides missing. */
  async isManagementKey(): Promise<boolean> {
    return (await this.store.get(K_OPENROUTER_MGMT)) === '1';
  }

  async clear(): Promise<void> {
    await this.store.delete(K_OPENROUTER_KEY);
    await this.store.delete(K_OPENROUTER_MGMT);
  }

  /** Sanity gate for the key format OpenRouter issues. */
  static looksLikeKey(input: string): boolean {
    return /^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(input.trim());
  }
}
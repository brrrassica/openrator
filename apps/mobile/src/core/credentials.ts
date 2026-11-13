/**
 * OpenRator — credential handling (spec §6.2, D2/D7, M0.8, M7.4).
 *
 * Credentials live in expo-secure-store, never SQLite. v0.2 namespaces every
 * value under `provider.<id>.key`, optionally `provider.<id>.management_key`,
 * and the user's display `provider.<id>.label`. The legacy single OpenRouter
 * key is migrated exactly once.
 */

import { PROVIDER_IDS, ProviderCredential, ProviderId } from '../providers/types';
import { getDescriptor } from '../providers/registry';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const LEGACY_KEY = 'openrator.openrouter.key';
const LEGACY_MGMT = 'openrator.openrouter.is_management';

const keyName = (provider: ProviderId) => `provider.${provider}.key`;
const mgmtName = (provider: ProviderId) => `provider.${provider}.management_key`;
const labelName = (provider: ProviderId) => `provider.${provider}.label`;
const flagName = (provider: ProviderId) => `provider.${provider}.is_management`;

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
      // Like `set`, a failed delete must surface: sign-out cannot claim the
      // credential was removed while it is still on the device.
      await impl.deleteItemAsync(key);
    },
  };
}

export class CredentialService {
  constructor(private readonly store: KeyValueStore) {}

  // ---- legacy migration ----------------------------------------------------

  /**
   * Copies the v0.1 key to the OpenRouter namespace, then removes the old
   * records. Idempotent: a second run is a no-op.
   */
  async migrateLegacy(): Promise<void> {
    const legacyKey = await this.store.get(LEGACY_KEY);
    if (!legacyKey) return;
    if (!(await this.store.get(keyName('openrouter')))) {
      await this.store.set(keyName('openrouter'), legacyKey);
    }
    if ((await this.store.get(LEGACY_MGMT)) === '1') {
      await this.store.set(flagName('openrouter'), '1');
      if (!(await this.store.get(mgmtName('openrouter')))) {
        await this.store.set(mgmtName('openrouter'), legacyKey);
      }
    }
    await this.store.delete(LEGACY_KEY);
    await this.store.delete(LEGACY_MGMT);
  }

  // ---- primary key ---------------------------------------------------------

  async hasKey(provider: ProviderId = 'openrouter'): Promise<boolean> {
    return (await this.getKey(provider)) !== null;
  }

  async saveKey(
    key: string,
    isManagement: boolean,
    provider: ProviderId = 'openrouter',
  ): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('Key must not be empty');
    await this.store.set(keyName(provider), trimmed);
    await this.store.set(flagName(provider), isManagement ? '1' : '0');
  }

  async getKey(provider: ProviderId = 'openrouter'): Promise<string | null> {
    const stored = await this.store.get(keyName(provider));
    if (stored !== null) return stored;
    // Defensive read for callers that run before migrateLegacy().
    if (provider === 'openrouter') return this.store.get(LEGACY_KEY);
    return null;
  }

  /**
   * The stored flag saying the primary key itself is a management key.
   * Unlike `isManagementKey`, this does not infer true from a separate
   * management credential, so re-saving a primary key can preserve it.
   */
  async isManagementFlag(provider: ProviderId = 'openrouter'): Promise<boolean> {
    return (await this.store.get(flagName(provider))) === '1';
  }

  /** Highest-confidence management flag: management key or persisted toggle. */
  async isManagementKey(provider: ProviderId = 'openrouter'): Promise<boolean> {
    if ((await this.getManagementKey(provider)) !== null) return true;
    if (await this.isManagementFlag(provider)) return true;
    if (provider === 'openrouter') {
      return (await this.store.get(LEGACY_MGMT)) === '1';
    }
    return false;
  }

  // ---- optional display label ---------------------------------------------

  /** Persist the user's label; empty/null removes it. */
  async saveLabel(label: string | null, provider: ProviderId = 'openrouter'): Promise<void> {
    if (label === null || label.trim() === '') {
      await this.store.delete(labelName(provider));
      return;
    }
    await this.store.set(labelName(provider), label.trim());
  }

  async getLabel(provider: ProviderId = 'openrouter'): Promise<string | null> {
    return this.store.get(labelName(provider));
  }

  // ---- optional management key (D13) --------------------------------------

  async saveManagementKey(
    key: string | null,
    provider: ProviderId = 'openrouter',
  ): Promise<void> {
    if (key === null || key.trim() === '') {
      await this.store.delete(mgmtName(provider));
      return;
    }
    await this.store.set(mgmtName(provider), key.trim());
  }

  async getManagementKey(provider: ProviderId = 'openrouter'): Promise<string | null> {
    return this.store.get(mgmtName(provider));
  }

  // ---- lifecycle -----------------------------------------------------------

  async clearProvider(provider: ProviderId): Promise<void> {
    // Attempt every namespaced value even if one delete fails.
    const results = await Promise.allSettled([
      this.store.delete(keyName(provider)),
      this.store.delete(mgmtName(provider)),
      this.store.delete(labelName(provider)),
      this.store.delete(flagName(provider)),
    ]);
    const failed = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failed) throw failed.reason;
  }

  async clear(): Promise<void> {
    const failures: unknown[] = [];
    for (const provider of PROVIDER_IDS) {
      try {
        await this.clearProvider(provider);
      } catch (e) {
        failures.push(e);
      }
    }
    for (const legacy of [LEGACY_KEY, LEGACY_MGMT]) {
      try {
        await this.store.delete(legacy);
      } catch (e) {
        failures.push(e);
      }
    }
    if (failures.length > 0) {
      const details = failures
        .map((e) => (e instanceof Error ? e.message : String(e)))
        .join('; ');
      throw new Error(`Failed to remove credentials from secure storage: ${details}`);
    }
  }

  async providersWithKeys(): Promise<ProviderId[]> {
    const out: ProviderId[] = [];
    for (const provider of PROVIDER_IDS) {
      if (await this.hasKey(provider)) out.push(provider);
    }
    return out;
  }

  async getCredential(provider: ProviderId): Promise<ProviderCredential | null> {
    const key = await this.getKey(provider);
    if (!key) return null;
    const managementKey = await this.getManagementKey(provider);
    return {
      provider,
      key,
      managementKey,
      isManagement: await this.isManagementKey(provider),
    };
  }

  /** Sanity gate for a provider's documented key format. */
  static looksLikeKey(input: string, provider: ProviderId = 'openrouter'): boolean {
    return getDescriptor(provider).keyPattern.test(input.trim());
  }
}

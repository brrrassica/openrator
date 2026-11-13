import { describe, expect, it } from 'vitest';
import { CredentialService, KeyValueStore, MemoryKeyValueStore } from '../src/core/credentials';

/** Store whose writes always fail — simulates a broken secure store (WS2-7). */
class FailingStore implements KeyValueStore {
  async get(): Promise<string | null> {
    return null;
  }
  async set(): Promise<void> {
    throw new Error('keystore unavailable');
  }
  async delete(): Promise<void> {
    // no-op
  }
}

/** Store whose delete fails for one namespaced key, recording every attempt. */
class FailingDeleteStore extends MemoryKeyValueStore {
  readonly deleted: string[] = [];
  constructor(private readonly failingKey: string) {
    super();
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    if (key === this.failingKey) throw new Error('delete failed');
    return super.delete(key);
  }
}

describe('CredentialService — never logs, format-gated', () => {
  it('roundtrips key + mgmt flag through the store', async () => {
    const svc = new CredentialService(new MemoryKeyValueStore());
    expect(await svc.hasKey()).toBe(false);
    await svc.saveKey('sk-or-v1-abcdef-0123456789abcdefghij', true);
    expect(await svc.hasKey()).toBe(true);
    expect(await svc.getKey()).toBe('sk-or-v1-abcdef-0123456789abcdefghij');
    expect(await svc.isManagementKey()).toBe(true);
    await svc.clear();
    expect(await svc.hasKey()).toBe(false);
    expect(await svc.isManagementKey()).toBe(false);
  });

  it('trims surrounding whitespace on save', async () => {
    const svc = new CredentialService(new MemoryKeyValueStore());
    await svc.saveKey('  sk-or-v1-abcdef-0123456789abcdefghij  ', false);
    expect(await svc.getKey()).toBe('sk-or-v1-abcdef-0123456789abcdefghij');
  });

  it('rejects empty keys', async () => {
    const svc = new CredentialService(new MemoryKeyValueStore());
    await expect(svc.saveKey('   ', false)).rejects.toThrow('empty');
  });

  it('isManagementKey defaults to false', async () => {
    const svc = new CredentialService(new MemoryKeyValueStore());
    expect(await svc.isManagementKey()).toBe(false);
  });

  it('persists the optional display label and clears it on empty input', async () => {
    const svc = new CredentialService(new MemoryKeyValueStore());
    await svc.saveLabel('  My main key  ');
    expect(await svc.getLabel()).toBe('My main key');
    await svc.saveLabel('');
    expect(await svc.getLabel()).toBeNull();
  });

  it('clearing the management key also clears the management flag', async () => {
    const svc = new CredentialService(new MemoryKeyValueStore());
    await svc.saveManagementKey('sk-or-v1-mgmt-key-0123456789abcdef');
    expect(await svc.isManagementKey()).toBe(true);
    await svc.saveManagementKey('');
    expect(await svc.getManagementKey()).toBeNull();
    expect(await svc.isManagementKey()).toBe(false);
  });

  it('isManagementFlag ignores a separate management key', async () => {
    const svc = new CredentialService(new MemoryKeyValueStore());
    await svc.saveKey('sk-or-v1-abcdef-0123456789abcdefghij', false);
    await svc.saveManagementKey('sk-or-v1-mgmt-key-0123456789abcdef');
    expect(await svc.isManagementFlag()).toBe(false);
    expect(await svc.isManagementKey()).toBe(true);
    await svc.saveKey('sk-or-v1-abcdef-0123456789abcdefghij', true);
    expect(await svc.isManagementFlag()).toBe(true);
  });

  it('saveKey rejects when the secure store write fails (WS2-7)', async () => {
    const svc = new CredentialService(new FailingStore());
    await expect(
      svc.saveKey('sk-or-v1-abcdef-0123456789abcdefghij', false),
    ).rejects.toThrow('keystore unavailable');
    // the key must NOT be reported as saved
    expect(await svc.hasKey()).toBe(false);
  });

  it('clear rejects on delete failure but still attempts every namespaced key', async () => {
    const store = new FailingDeleteStore('provider.openrouter.key');
    const svc = new CredentialService(store);
    await svc.saveKey('sk-or-v1-abcdef-0123456789abcdefghij', false);
    await svc.saveLabel('work key');
    await svc.saveManagementKey('sk-or-v1-mgmt-key-0123456789abcdef');

    await expect(svc.clear()).rejects.toThrow('delete failed');
    // The failed key is still present, so sign-out must stay on-screen.
    expect(await svc.getKey()).toBe('sk-or-v1-abcdef-0123456789abcdefghij');
    // Other values were still attempted and removed.
    expect(await svc.getLabel()).toBeNull();
    expect(await svc.getManagementKey()).toBeNull();
    expect(store.deleted).toContain('provider.opencode-go.key');
    expect(store.deleted).toContain('openrator.openrouter.key');
  });

  it('looksLikeKey gates the documented format', () => {
    expect(CredentialService.looksLikeKey('sk-or-v1-abcdef-0123456789abcdefghij')).toBe(true);
    expect(CredentialService.looksLikeKey('sk-or-v1-short')).toBe(false); // too short
    expect(CredentialService.looksLikeKey('sk-proj-abcdef-0123456789abcdefghij')).toBe(false); // wrong prefix
    expect(CredentialService.looksLikeKey('plain text')).toBe(false);
  });
});
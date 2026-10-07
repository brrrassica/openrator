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

  it('saveKey rejects when the secure store write fails (WS2-7)', async () => {
    const svc = new CredentialService(new FailingStore());
    await expect(
      svc.saveKey('sk-or-v1-abcdef-0123456789abcdefghij', false),
    ).rejects.toThrow('keystore unavailable');
    // the key must NOT be reported as saved
    expect(await svc.hasKey()).toBe(false);
  });

  it('looksLikeKey gates the documented format', () => {
    expect(CredentialService.looksLikeKey('sk-or-v1-abcdef-0123456789abcdefghij')).toBe(true);
    expect(CredentialService.looksLikeKey('sk-or-v1-short')).toBe(false); // too short
    expect(CredentialService.looksLikeKey('sk-proj-abcdef-0123456789abcdefghij')).toBe(false); // wrong prefix
    expect(CredentialService.looksLikeKey('plain text')).toBe(false);
  });
});
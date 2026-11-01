/**
 * OpenRator — adapter factory (M7.7).
 * Builds the provider set from secure-store credentials at boot and after an
 * account is added/removed. Screens never construct provider clients.
 */

import { CredentialService } from '../core/credentials';
import { getDescriptor } from './registry';
import { createOpenRouterAdapter } from './openrouter/adapter';
import { OpenCodeGoAdapter } from './opencode-go/adapter';
import { OpenCodeZenAdapter } from './opencode-zen/adapter';
import { ProviderAdapter, ProviderId } from './types';

export function createAdapter(
  provider: ProviderId,
  creds: CredentialService,
): ProviderAdapter {
  switch (provider) {
    case 'openrouter':
      return createOpenRouterAdapter(() => creds.getCredential('openrouter'));
    case 'opencode-go':
      // Live: GET https://opencode.ai/zen/go/v1/usage (M8.1 verified).
      return new OpenCodeGoAdapter();
    case 'opencode-zen':
      // Zen balance transport is still unverified; manual fallback applies.
      return new OpenCodeZenAdapter();
  }
}

/** Create adapters only for providers that have a stored credential. */
export async function createConfiguredAdapters(
  creds: CredentialService,
): Promise<ProviderAdapter[]> {
  const ids = await creds.providersWithKeys();
  return ids
    .filter((id) => {
      const descriptor = getDescriptor(id);
      return descriptor.enabled || id === 'openrouter';
    })
    .map((id) => createAdapter(id, creds));
}

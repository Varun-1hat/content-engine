import type { AvatarAdapter } from './base';
import { heygenAvatarAdapter } from './heygen';

const ADAPTERS: Record<string, AvatarAdapter> = {
  heygen: heygenAvatarAdapter,
};

export function getAvatarAdapter(provider: string): AvatarAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown avatar provider "${provider}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}

export function listAvatarProviders(): string[] {
  return Object.keys(ADAPTERS);
}

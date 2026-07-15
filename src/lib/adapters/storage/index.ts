import type { StorageAdapter } from './base';
import { cloudinaryStorageAdapter } from './cloudinary';

const ADAPTERS: Record<string, StorageAdapter> = {
  cloudinary: cloudinaryStorageAdapter,
};

export function getStorageAdapter(provider: string): StorageAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown storage provider "${provider}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}

export function listStorageProviders(): string[] {
  return Object.keys(ADAPTERS);
}

import type { VoiceAdapter } from './base';
import { elevenLabsVoiceAdapter } from './elevenlabs';

const ADAPTERS: Record<string, VoiceAdapter> = {
  elevenlabs: elevenLabsVoiceAdapter,
};

export function getVoiceAdapter(provider: string): VoiceAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown voice provider "${provider}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}

export function listVoiceProviders(): string[] {
  return Object.keys(ADAPTERS);
}

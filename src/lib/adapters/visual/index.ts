import type { VisualAdapter } from './base';
import { veoImagenVisualAdapter } from './veo_imagen';

const ADAPTERS: Record<string, VisualAdapter> = {
  veo_imagen: veoImagenVisualAdapter,
};

export function getVisualAdapter(provider: string): VisualAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown visual provider "${provider}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}

export function listVisualProviders(): string[] {
  return Object.keys(ADAPTERS);
}

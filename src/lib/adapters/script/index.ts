import type { ScriptAdapter } from './base';
import { geminiScriptAdapter } from './gemini';

const ADAPTERS: Record<string, ScriptAdapter> = {
  gemini: geminiScriptAdapter,
};

export function getScriptAdapter(provider: string): ScriptAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown script provider "${provider}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}

// The single JSON-extraction path (replaces the per-route regex variants).
// Handles: native-JSON responses, fenced ```json blocks, and prose-wrapped output.
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/[[{][\s\S]*[\]}]/);
  return JSON.parse(match ? match[0] : cleaned) as T;
}

export function listScriptProviders(): string[] {
  return Object.keys(ADAPTERS);
}

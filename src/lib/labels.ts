// Human-readable labels for values stored raw (snake_case slugs, enums).
// UI renders labels; forms submit the raw value.

import { STAGE_INFO, type StageName } from './pipeline/stages';

export const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  elevenlabs: 'ElevenLabs',
  heygen: 'HeyGen',
  veo_imagen: 'Veo + Imagen',
  cloudinary: 'Cloudinary',
};

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

/** Generic snake_case / kebab-case -> Title Case fallback. */
export function humanize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function providerLabel(slug: string | null | undefined): string {
  if (!slug) return '';
  return PROVIDER_LABELS[slug] ?? humanize(slug);
}

export function statusLabel(slug: string | null | undefined): string {
  if (!slug) return '';
  return STATUS_LABELS[slug] ?? humanize(slug);
}

export function stageLabel(name: string | null | undefined): string {
  if (!name) return '';
  return STAGE_INFO[name as StageName]?.label ?? humanize(name);
}

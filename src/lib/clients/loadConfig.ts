import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ClientConfig, ResolvedClient } from './types';

const KB_BUCKET = 'client-kb';
// Short TTL keeps the prompt-tuning loop tight: edit a KB doc in Storage,
// changes reach generation within a minute. Cost is a few small reads/min.
const CACHE_TTL_MS = 60 * 1000;

const cache = new Map<string, { data: ResolvedClient; expiresAt: number }>();

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
  }
  return createClient(url, key);
}

function mapRow(row: any, avatarRows: any[], templateRows: any[]): ClientConfig {
  return {
    id: row.id,
    displayName: row.display_name,
    contentType: row.content_type,
    scriptMode: row.script_mode,
    tier: row.tier,
    active: row.active,
    locale: { language: row.locale_language, region: row.locale_region },
    speechWordsPerSec: Number(row.speech_words_per_sec),
    knowledgeBase: {
      researchDocPath: row.kb_research_doc_path ?? undefined,
      voicePromptPath: row.kb_voice_prompt_path ?? undefined,
      creativeDirectorPromptPath: row.kb_creative_director_prompt_path ?? undefined,
      pastContentPath: row.kb_past_content_path ?? undefined,
    },
    script: {
      provider: row.script_provider,
      model: row.model_script,
      structuredModel: row.model_structured,
      fallbackModel: row.model_fallback,
    },
    voice: {
      provider: row.voice_provider,
      voiceId: row.voice_id,
      modelId: row.voice_model_id,
      stability: Number(row.voice_stability),
    },
    avatarProvider: row.avatar_provider,
    avatars: avatarRows.map((a) => ({
      id: a.id,
      label: a.label,
      avatar_id: a.avatar_id,
      preview_image_url: a.preview_image_url,
      sort_order: a.sort_order,
    })),
    templates: templateRows.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      preview_video_url: t.preview_video_url,
      sort_order: t.sort_order,
    })),
    visual: { provider: row.visual_provider, stylePreset: row.visual_style_preset },
    storage: { provider: row.storage_provider, folderPrefix: row.storage_folder_prefix },
    extra: row.extra ?? {},
  };
}

async function downloadText(supabase: SupabaseClient, path?: string): Promise<string> {
  if (!path) return '';
  const { data, error } = await supabase.storage.from(KB_BUCKET).download(path);
  if (error) throw new Error(`Failed to load KB doc "${path}": ${error.message}`);
  return await data.text();
}

export async function loadClientConfig(clientId: string): Promise<ResolvedClient> {
  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const supabase = supabaseAdmin();
  const [clientRes, avatarRes, templateRes] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).eq('active', true).single(),
    supabase.from('client_avatars').select('*').eq('client_id', clientId).order('sort_order'),
    supabase.from('client_templates').select('*').eq('client_id', clientId).order('sort_order'),
  ]);

  if (clientRes.error || !clientRes.data) {
    throw new Error(`Unknown or inactive client: "${clientId}"`);
  }
  if (avatarRes.error) throw new Error(`Failed to load avatars for "${clientId}": ${avatarRes.error.message}`);
  if (templateRes.error) throw new Error(`Failed to load templates for "${clientId}": ${templateRes.error.message}`);

  const config = mapRow(clientRes.data, avatarRes.data ?? [], templateRes.data ?? []);
  const [researchDoc, voicePrompt, creativeDirectorPrompt, pastContent] = await Promise.all([
    downloadText(supabase, config.knowledgeBase.researchDocPath),
    downloadText(supabase, config.knowledgeBase.voicePromptPath),
    downloadText(supabase, config.knowledgeBase.creativeDirectorPromptPath),
    downloadText(supabase, config.knowledgeBase.pastContentPath),
  ]);

  const resolved: ResolvedClient = { ...config, researchDoc, voicePrompt, creativeDirectorPrompt, pastContent };
  cache.set(clientId, { data: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

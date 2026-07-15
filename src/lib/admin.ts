// Shared helpers for the /api/admin/* routes.

// Columns an admin may write on clients. id/created_at/updated_at are
// server-controlled.
const CLIENT_PATCHABLE = new Set([
  'display_name', 'content_type', 'script_mode', 'tier', 'active',
  'locale_language', 'locale_region', 'speech_words_per_sec',
  'kb_research_doc_path', 'kb_voice_prompt_path', 'kb_creative_director_prompt_path', 'kb_past_content_path',
  'script_provider', 'model_script', 'model_structured', 'model_fallback',
  'voice_provider', 'voice_id', 'voice_model_id', 'voice_stability',
  'avatar_provider', 'visual_provider', 'visual_style_preset',
  'storage_provider', 'storage_folder_prefix', 'extra',
]);

export function filterClientPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([k]) => CLIENT_PATCHABLE.has(k)));
}

// KB doc keys used by the admin editor <-> clients column + default filename.
export const KB_DOCS: Record<string, { column: string; filename: string; label: string }> = {
  research: { column: 'kb_research_doc_path', filename: 'research_doc.md', label: 'Research Doc (strategy + templates + topic rules)' },
  voice: { column: 'kb_voice_prompt_path', filename: 'voice_prompt.md', label: 'Voice Prompt (persona + language + TTS tags)' },
  creative_director: { column: 'kb_creative_director_prompt_path', filename: 'creative_director_prompt.md', label: 'Creative Director (B-roll style + timing)' },
  past_content: { column: 'kb_past_content_path', filename: 'past_content.md', label: 'Past Content (avoid-repeating list, optional)' },
};

export const KB_BUCKET = 'client-kb';

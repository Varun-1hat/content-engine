-- =============================================================================
-- 0002_seed_kiran.sql — migrates ALL of Kiran's currently-hardcoded values
-- (routes, page.tsx, env vars) into the schema. Run after 0001.
--
-- Fill the 5 <PASTE ...> placeholders from your current Render env vars first.
-- These are vendor IDs, not secrets — after this, they live in the DB and are
-- editable from Studio without a redeploy. The env vars can then be deleted.
-- =============================================================================

insert into clients (
  id, display_name, content_type, script_mode, tier,
  locale_language, locale_region, speech_words_per_sec,
  kb_research_doc_path, kb_voice_prompt_path, kb_creative_director_prompt_path,
  script_provider, model_script, model_structured, model_fallback,
  voice_provider, voice_id, voice_model_id, voice_stability,
  avatar_provider,
  visual_provider, visual_style_preset,
  storage_provider, storage_folder_prefix
) values (
  'kiran', 'Dr. Kiran More', 'talking_head', 'generate', 'scenario_premium',
  'hinglish', 'IN', 2.5,
  'kiran/research_doc.md', 'kiran/voice_prompt.md', 'kiran/creative_director_prompt.md',
  -- model_script seeded as flash to match today's live behavior (your cost change);
  -- flip to gemini-2.5-pro in Studio anytime — it's a knob now, not a deploy.
  'gemini', 'gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest',
  'elevenlabs', '<PASTE ELEVENLABS_VOICE_ID>', 'eleven_v3', 0.5,
  'heygen',
  'veo_imagen', 'indian_pediatric_v2',
  'cloudinary', 'kiran'
);

-- Avatar looks (from generate-avatar/route.ts env map + page.tsx AVATARS/images)
insert into client_avatars (client_id, label, avatar_id, preview_image_url, sort_order) values
  ('kiran', 'Casual', '<PASTE HEYGEN_AVATAR_ID_CASUAL>', '/casual.png', 0),
  ('kiran', 'Scrub',  '<PASTE HEYGEN_AVATAR_ID_SCRUB>',  '/scrub.png',  1),
  ('kiran', 'Formal', '<PASTE HEYGEN_AVATAR_ID_FORMAL>', '/formal.png', 2),
  ('kiran', 'Studio', '<PASTE HEYGEN_AVATAR_ID_STUDIO>', '/studio.png', 3);

-- Auth allowlist: internal admins. Add teammates as extra rows.
-- Each email must ALSO exist as a Supabase Auth user (Dashboard -> Authentication -> Users -> Add user).
insert into app_users (email, role) values
  ('varun@1hat.ai', 'admin');

-- Reel templates (from page.tsx EXCEL_TEMPLATES + TEMPLATE_PREVIEWS, verbatim).
-- Labels must match the template names inside kiran/research_doc.md.
insert into client_templates (client_id, label, description, preview_video_url, sort_order) values
  ('kiran', 'Myth vs Fact',           'Fast-paced hooks, busting a common parental misconception, ending with the clinical truth.', '/myth.mp4', 0),
  ('kiran', 'The 3 Mistakes',         'Highly engaging format calling out 3 common mistakes parents make.', '/3 mistake.mp4', 1),
  ('kiran', 'Behind the Scenes',      'Vlog style showing the reality of being a pediatrician/neonatologist.', '/bts.mp4', 2),
  ('kiran', 'Patient Transformation', 'Inspiring success stories (HIPAA compliant/anonymized) with emotional hooks.', '/patient transformation.mp4', 3),
  ('kiran', 'Quick Hack / DIY',       'Fast, actionable medical advice for parents to use at home.', '/quick hack.mp4', 4),
  ('kiran', 'Warning / Red Flag',     'Serious, cautionary tone. Opens with a shocking story to teach a critical safety lesson.', '/warning kiran.mp4', 5),
  ('kiran', 'Q&A Session',            'Friendly, direct answering of a common question. Highly reassuring.', '/kiran q&a.mp4', 6);

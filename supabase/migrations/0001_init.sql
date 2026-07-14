-- =============================================================================
-- 0001_init.sql — complete schema. Paste into Supabase Studio -> SQL Editor -> Run.
--
-- Design rules:
--   * Every hand-edited setting is a real column. jsonb ONLY for
--     machine-written artifacts and the `extra` escape hatch.
--   * Secrets (API keys) NEVER live here — env vars only.
--   * RLS on with zero policies: the publishable (browser) key can touch
--     nothing; all access is server-side via the secret key.
--   * jobs track (current_stage, stage_status) instead of a fixed status
--     enum, so every tier/pipeline shape fits without schema changes.
--     Stage names are defined by the code's stage registry.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- clients — one row per client. The core of multi-tenancy.
-- ---------------------------------------------------------------------------
create table clients (
  id                text primary key,              -- slug, e.g. 'kiran'
  display_name      text not null,
  content_type      text not null default 'talking_head'
                     check (content_type in ('talking_head', 'product_visual')),
  script_mode       text not null default 'generate'
                     check (script_mode in ('generate', 'polish')),
  tier              text not null default 'full_production'
                     check (tier in ('script_only', 'audio_only', 'avatar_only', 'full_production', 'scenario_premium')),
  active            boolean not null default true,

  -- Locale / pacing
  locale_language      text not null default 'hinglish',
  locale_region        text not null default 'IN',   -- drives seasonality framing in topic generation
  speech_words_per_sec numeric not null default 2.5, -- duration -> word count heuristic (language-dependent)

  -- Knowledge-base doc paths inside the 'client-kb' Storage bucket
  kb_research_doc_path              text,  -- strategy + templates + topic-selection rules
  kb_voice_prompt_path              text,  -- persona, style, TTS emotion-tag vocabulary
  kb_creative_director_prompt_path  text,  -- B-roll visual style + timing rules
  kb_past_content_path              text,  -- optional: published-topics list, "avoid repeating"

  -- Script engine (LLM)
  script_provider   text not null default 'gemini',
  model_script      text not null default 'gemini-2.5-flash',  -- creative writing (the quality knob)
  model_structured  text not null default 'gemini-2.5-flash',  -- JSON planning tasks (the cost knob)
  model_fallback    text not null default 'gemini-1.5-pro',    -- used on 503s

  -- Voice (TTS)
  voice_provider    text not null default 'elevenlabs',
  voice_id          text,                                      -- vendor voice ID (not a secret)
  voice_model_id    text not null default 'eleven_v3',
  voice_stability   numeric not null default 0.5,

  -- Avatar (talking head) — per-look IDs live in client_avatars
  avatar_provider   text not null default 'heygen',

  -- Visual layer (B-roll / product shots)
  visual_provider     text not null default 'veo_imagen',
  visual_style_preset text,

  -- Media storage
  storage_provider      text not null default 'cloudinary',
  storage_folder_prefix text,                                  -- e.g. 'kiran' -> kiran/audio, kiran/assembled

  -- Escape hatch for genuine one-offs ONLY. Anything used by 2+ clients
  -- should be promoted to a real column (additive change, non-breaking).
  extra             jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- client_avatars — 0..N avatar "looks" per client.
--   0 rows = avatar stage skipped · 1 = brand ambassador · N = wardrobe
-- ---------------------------------------------------------------------------
create table client_avatars (
  id                uuid primary key default gen_random_uuid(),
  client_id         text not null references clients(id) on delete cascade,
  label             text not null,          -- shown in UI; server resolves label -> avatar_id
  avatar_id         text not null,          -- vendor ID (HeyGen etc.) — never shipped to the browser
  preview_image_url text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  unique (client_id, label)
);

-- ---------------------------------------------------------------------------
-- client_templates — the reel formats offered in the UI for this client.
-- Labels MUST match the template names in the client's research doc
-- (the AI matches them by name — soft contract, checked by the admin panel).
-- ---------------------------------------------------------------------------
create table client_templates (
  id                uuid primary key default gen_random_uuid(),
  client_id         text not null references clients(id) on delete cascade,
  label             text not null,
  description       text,
  preview_video_url text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  unique (client_id, label)
);

-- ---------------------------------------------------------------------------
-- jobs — one row per reel, accumulating state across stages.
-- The browser holds a job id; every stage route persists its artifacts here.
-- ---------------------------------------------------------------------------
create table jobs (
  id                  uuid primary key default gen_random_uuid(),
  client_id           text not null references clients(id) on delete cascade,

  -- Pipeline position. Stage names come from the code's stage registry
  -- (topic, script, adapt_voice, audio, avatar, broll_plan, assemble).
  current_stage       text not null default 'topic',
  stage_status        text not null default 'pending'
                       check (stage_status in ('pending', 'running', 'done', 'failed')),
  created_by          text,          -- app_users.email

  -- Stage 1-2: content
  topic               text,
  template            text,
  target_duration_sec int,
  english_script      text,
  full_script         text,
  script_meta         jsonb,         -- machine-written: hookType, severity, wordCount, etc.

  -- Stage 3: production choices (per-job, NOT per-client)
  avatar_label        text,
  broll_frequency     text default 'Standard',
  editor_notes        text,
  speech_speed        numeric default 1.0,

  -- Stage 4-6: artifacts
  audio_url           text,
  audio_timestamps    jsonb,         -- machine-written sentence timing
  avatar_video_url    text,
  broll_plan          jsonb,         -- machine-written creative-director output
  final_video_url     text,

  -- Vendor job handles for crash reconciliation,
  -- e.g. {"heygen": "vid_abc", "veo": ["operations/xyz"]}
  provider_job_ids    jsonb not null default '{}'::jsonb,
  error               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index jobs_client_created_idx on jobs (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- job_events — append-only log per job. Powers the admin panel's debugging
-- view; `detail` later carries durations / token counts / vendor cost.
-- ---------------------------------------------------------------------------
create table job_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  stage       text not null,
  event       text not null,                      -- started | succeeded | failed | retried
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index job_events_job_idx on job_events (job_id, created_at);

-- ---------------------------------------------------------------------------
-- app_users — the auth allowlist. A Supabase Auth user may sign in, but the
-- app only authorizes emails present (and active) here.
--   role 'admin'  -> internal team: all clients + /admin panel
--   role 'client' -> scoped to client_id; picker hidden, ?client= ignored
-- ---------------------------------------------------------------------------
create table app_users (
  email       text primary key,                   -- must match the Auth user's email, lowercase
  role        text not null check (role in ('admin', 'client')),
  client_id   text references clients(id) on delete set null,  -- required when role='client'
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- kb_revisions — one row per KB-doc save from the admin panel; `path` points
-- to the timestamped backup copy written to Storage alongside the live doc.
-- ---------------------------------------------------------------------------
create table kb_revisions (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null references clients(id) on delete cascade,
  path        text not null,
  saved_by    text,                               -- app_users.email
  created_at  timestamptz not null default now()
);

create index kb_revisions_client_idx on kb_revisions (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Security: RLS on, zero policies = the publishable (browser) key can read
-- NOTHING. All access goes through server routes using the secret key.
-- ---------------------------------------------------------------------------
alter table clients          enable row level security;
alter table client_avatars   enable row level security;
alter table client_templates enable row level security;
alter table jobs             enable row level security;
alter table job_events       enable row level security;
alter table app_users        enable row level security;
alter table kb_revisions     enable row level security;

-- updated_at maintenance
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

create trigger jobs_set_updated_at
  before update on jobs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Storage: private bucket for the per-client knowledge-base docs.
-- (Equivalent to Dashboard -> Storage -> New bucket 'client-kb', private.)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('client-kb', 'client-kb', false);

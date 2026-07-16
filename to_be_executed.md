# to_be_executed.md — Stage-Toggle Pipelines & Onboarding Rework (v2.1)

**Supersedes** `docs/modular_refactor_plan.md` and the doc-pack plans. Everything built & verified on branch `interface` (`ff9e229`) stays; this builds on top. Grounded in a full code read (2026-07-16) + user clarifications.

---

## EXECUTED — 2026-07-16

All phases P0–P7 executed and verified. Migrations `0003_pipelines_uuid` + `0004_drop_legacy` are **live** on Supabase `oyxpwfpbfqcfbuklnsjq`. Kiran is now uuid `be45a5c4-70cb-426f-bd4f-6862af9ae87d` / slug `kiran`, with one `Default` 7-stage pipeline; dummy `meera` deleted. `tsc` exit 0 throughout.

**Two real bugs found by live verification (both fixed):**
1. **Every newly-created client was unloadable.** `loadClientConfig` hard-threw when a KB doc file didn't exist yet, but onboarding writes the `kb_*_path` columns at creation while the Storage files only appear when someone saves them in the KB editor. Result: create → activate → Studio → 500. Fixed in `clients/loadConfig.ts` — a missing object is now an empty doc (readiness already reports it as a warning); genuine storage errors still throw.
2. **Horizontal overflow on mobile.** `<body>` is a flex column (`layout.tsx`), so each screen's root is a flex item with `min-width:auto` — it refused to shrink below its `truncate`d (nowrap) content and pushed the page sideways (up to 213px at 375px). Fixed with `w-full min-w-0` on each root + `flex-wrap` on the ScriptDisplay toolbar + a responsive admin nav. All screens now 0px overflow at 375px.

**Verified live (zero vendor spend):** per-reel voiceover OFF → plan resolves to `topic, script, broll_plan, assemble` (drops adapt_voice+audio+avatar) · stage guards 409 (off-plan audio/avatar/topic) · cross-tenant 403 on three routes + foreign-pipeline 400 · N1 public PATCH rejects `stage_status`/`current_stage`/`final_video_url`/`provider_job_ids` (400) while `editor_notes` succeeds (200) · pipeline validation 400s on avatar-without-audio, assemble-without-visual, empty, unknown stage; out-of-order stages normalize · wizard creates uuid+auto-slug (`acme-product-co`), inactive, blank-by-default · readiness flags missing voice_id + empty KB docs · product upload → Cloudinary under the slug folder, non-image rejected · legacy job resumed from its backfilled `stage_plan` · client names + pipeline names everywhere (no raw ids) · ffmpeg concat filtergraph validated directly (1080×1920 H.264, both muxed-audio and silent).

**Verified live (real vendor calls, cheap):** Kiran regression `topic → script → adapt_voice` all succeeded — season-aware topic, template honored, 1809-char Hinglish with `[excited_surprised]`/`<emphasis>` tags, script_meta persisted, clean event trail.

**NOT yet exercised against paid vendors — needs a go-ahead:** ElevenLabs `audio`, HeyGen `avatar` (incl. the new product-photo attachment), Veo `assemble` (incl. the new **concat** path for avatar-less reels). The concat filtergraph itself is proven in ffmpeg; what's unproven is the live vendor round-trip. **HeyGen product attachment is the one genuinely uncertain piece** (see §5.3) — it sets the scene `background` to the product photo, which needs confirming against HeyGen's API/plan; assembly also overlays product photos as B-roll so the product appears regardless.

All throwaway verification data removed (test client, synthetic jobs, temp admins); the kept e2e reel's `editor_notes` restored after the PATCH test.

**Locked decisions (this revision):**
- **Client PK → UUID** + human-readable `slug` column. Dummy client `meera` deleted. Slug drives Storage/KB/Cloudinary folder naming (Kiran keeps `slug='kiran'` → no media moves); FKs repoint to UUID.
- **Products are NOT stored.** No product catalog table. Product photos are uploaded **per reel**, passed to HeyGen as **attachment photos** (avatar stage) + referenced in prompts; for avatar-less variants they become B-roll image placements. Transient URLs live on the job row as reel inputs.
- **No music feature / no `music_url`.** HeyGen bakes music from the prompt.
- **"No voiceover" is a per-REEL toggle**, not a pipeline/tier attribute — it exists to skip the Gemini voice-script + ElevenLabs calls case-by-case. Realized via the job's `stage_plan` snapshot.
- **`tier` deleted** (confirmed unused externally).

**Freeze note:** v1 froze the schema; the new model authorizes a redesign. 0003 does the UUID swap + adds `client_pipelines` + job columns + backfill (additive to data, converts PK). 0004 drops the four now-dead `clients` columns, run only after §8 verification.

---

## 1. Requirements → design

### 1.1 Model
One **canonical stage sequence** in code:
```
topic → script → adapt_voice → audio → avatar → broll_plan → assemble
```
Per client: **N `client_pipelines`** rows = a subset of enabled stages + settings (durations, product-input flag). Vendor config (models/voice/avatar/visual providers) stays client-level. **Each job binds one pipeline and snapshots a `stage_plan`** at creation, so (a) mid-job pipeline edits can't corrupt a run, (b) per-reel toggles (voiceover off, script injected) are just edits to that snapshot.

Extension: new variant = new pipeline row (or preset constant) — zero code. New stage = append to the canonical array + `STAGE_INFO` + one route + one screen mapping (`enabled_stages` is `text[]`, no migration).

### 1.2 Two axes of "which stages run"
- **Pipeline (per client, admin-set):** the reel *shape* for a subscription — its default `enabled_stages`. This is where the 6 variants live.
- **Per-reel (Studio, at creation):** small overrides on top of the chosen pipeline, snapshotted into `job.stage_plan`:
  - **Voiceover on/off** — off ⇒ drop `adapt_voice` + `audio` (and `avatar`, which needs an audio track to lip-sync). Saves the Gemini voice-script + ElevenLabs spend for silent product/music reels.
  - **Inject script** — user pastes a script ⇒ drop `topic` + `script`; seed `english_script`.

`validate` runs on both the pipeline (at save) and the resolved job plan (at creation).

### 1.3 The six variants (presets prefill the admin toggle editor; storage is always the raw stage set)

| # | Variant | Preset | enabled_stages | product_input |
|---|---|---|---|---|
| 1 | Full E2E (script gen, avatar+voice, b-roll; script injectable per-reel) | `full_e2e` | all 7 | no |
| 2 | E2E minus script gen (client supplies script; system optimizes it downstream) | `client_script` | `adapt_voice, audio, avatar, broll_plan, assemble` | no |
| 3 | E2E avatar + product | `avatar_product` | all 7 | **yes** |
| 4 | E2E avatar only (no product) | `full_e2e` | all 7 | no |
| 5 | E2E product only (no avatar; short promos, voiceover) | `product_promo` | `topic, script, adapt_voice, audio, broll_plan, assemble` | **yes** |
| 6 | E2E no voiceover (video + music, product ads) | `product_music` | `topic, script, broll_plan, assemble` | **yes** |

- **Variant 2 "optimize for each downstream tool"** = the existing `adapt_voice` stage on the pasted script (persona/language/TTS-tag conditioning via the voice prompt). UI label → **"Adapt Script"**; stage key stays `adapt_voice`.
- **Variant 3 "avatar + product"** — now genuinely achievable: product photos are **HeyGen attachment images** for that render + a prompt instructing the avatar to present/use the product. Photos uploaded per reel (§5.3).
- **Variant 6** keeps `script` (drives the shot list / captions) but no `adapt_voice`/`audio`. Also reachable per-reel by toggling voiceover off on any fuller pipeline.

### 1.4 Dependency rules — `validate(stages, {})` in `stages.ts`
| Rule | Error |
|---|---|
| every stage ∈ canonical set; non-empty | "Unknown stage / empty pipeline" |
| `avatar` ⇒ `audio` | avatar is lip-synced to the audio track |
| `assemble` ⇒ `avatar` OR `broll_plan` | nothing to assemble |

Readiness **warnings** (activation-time, non-blocking): `product_input` but no stage that can consume a product (`avatar`/`broll_plan`) · `avatar` enabled but 0 avatar rows or any `REPLACE_ME` · `audio` enabled but no `voice_id` · template labels absent from research doc · KB doc empty for an enabled stage.

### 1.5 Supersedes from the prior review
`polish` broken → `client_script` intake (built) · `scenario_premium` meaningless → tiers deleted · `product_visual` half-deliverable → b-roll-only concat assembly (built) · custom-topic dead-end fixed · stage-skip now has **server-side route guards** · hardcoded duration bounds → per-pipeline · N1 (job PATCH allowlist) + N2 (clone atomicity) folded in. Per-client vendor API keys remain deferred (unaffected).

---

## 2. Schema

### 2.1 FK audit
All existing FKs to `clients` are present/correct (avatars, templates, jobs, app_users→set-null, kb_revisions cascade; job_events→jobs). The real gap was **UI showing raw ids** (fixed in §6/§7). After 0003 every `client_id` FK is `uuid → clients(id)`.

### 2.2 `0003_pipelines_uuid.sql` (run first)

```sql
-- 0003 — UUID client PKs + slug + client_pipelines + job columns + backfill.

-- A. Drop dummy client (cascades to its children).
delete from clients where id = 'meera';

-- B. slug column (human-readable; drives storage/KB folder names).
alter table clients add column slug text;
update clients set slug = id;
alter table clients alter column slug set not null;
alter table clients add constraint clients_slug_key unique (slug);

-- C. New UUID identity on clients.
alter table clients add column uid uuid not null default gen_random_uuid();
alter table clients add constraint clients_uid_key unique (uid);

-- D. Repoint every child FK from text id -> uuid.
alter table client_avatars   add column client_uid uuid;
alter table client_templates add column client_uid uuid;
alter table jobs             add column client_uid uuid;
alter table app_users        add column client_uid uuid;
alter table kb_revisions     add column client_uid uuid;
update client_avatars   c set client_uid = p.uid from clients p where c.client_id = p.id;
update client_templates c set client_uid = p.uid from clients p where c.client_id = p.id;
update jobs             c set client_uid = p.uid from clients p where c.client_id = p.id;
update app_users        c set client_uid = p.uid from clients p where c.client_id = p.id;
update kb_revisions     c set client_uid = p.uid from clients p where c.client_id = p.id;
alter table client_avatars   drop constraint client_avatars_client_id_fkey;
alter table client_templates drop constraint client_templates_client_id_fkey;
alter table jobs             drop constraint jobs_client_id_fkey;
alter table app_users        drop constraint app_users_client_id_fkey;
alter table kb_revisions     drop constraint kb_revisions_client_id_fkey;
alter table client_avatars   drop column client_id;
alter table client_templates drop column client_id;
alter table jobs             drop column client_id;
alter table app_users        drop column client_id;
alter table kb_revisions     drop column client_id;
alter table client_avatars   rename column client_uid to client_id;
alter table client_templates rename column client_uid to client_id;
alter table jobs             rename column client_uid to client_id;
alter table app_users        rename column client_uid to client_id;
alter table kb_revisions     rename column client_uid to client_id;
alter table client_avatars   alter column client_id set not null;
alter table client_templates alter column client_id set not null;
alter table jobs             alter column client_id set not null;
alter table kb_revisions     alter column client_id set not null;

-- E. Swap clients PK to the uuid.
alter table clients drop constraint clients_uid_key;
alter table clients drop constraint clients_pkey cascade;
alter table clients drop column id;
alter table clients rename column uid to id;
alter table clients add primary key (id);   -- keeps default gen_random_uuid()

-- F. Re-add child FKs to clients(id).
alter table client_avatars   add constraint client_avatars_client_id_fkey   foreign key (client_id) references clients(id) on delete cascade;
alter table client_templates add constraint client_templates_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table jobs             add constraint jobs_client_id_fkey             foreign key (client_id) references clients(id) on delete cascade;
alter table app_users        add constraint app_users_client_id_fkey        foreign key (client_id) references clients(id) on delete set null;
alter table kb_revisions     add constraint kb_revisions_client_id_fkey     foreign key (client_id) references clients(id) on delete cascade;

-- G. client_pipelines — N per client; each = enabled-stage set + settings.
create table client_pipelines (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients(id) on delete cascade,
  name                 text not null,
  enabled_stages       text[] not null,
  product_input        boolean not null default false,   -- reels on this pipeline take per-reel product photos
  duration_min_sec     int not null default 15,
  duration_max_sec     int not null default 90,
  duration_default_sec int not null default 45,
  sort_order           int not null default 0,
  active               boolean not null default true,
  extra                jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (client_id, name),
  check (array_length(enabled_stages, 1) >= 1)
);
create index client_pipelines_client_idx on client_pipelines (client_id, sort_order);
alter table client_pipelines enable row level security;
create trigger client_pipelines_set_updated_at before update on client_pipelines
  for each row execute function set_updated_at();

-- H. jobs: pipeline binding + per-job snapshot + per-reel product photos.
alter table jobs
  add column pipeline_id        uuid references client_pipelines(id) on delete set null,
  add column stage_plan         text[],       -- resolved at creation; per-reel toggles applied here
  add column product_image_urls text[] not null default '{}';  -- transient reel inputs (Cloudinary), not a catalog

-- I. Backfill one 'Default' pipeline per client, mirroring the OLD derivation.
with tier_cut as (
  select id, case tier when 'script_only' then 3 when 'audio_only' then 4
                       when 'avatar_only' then 5 else 7 end as cut from clients),
avatar_counts as (
  select c.id cid, count(a.id)::int n from clients c
    left join client_avatars a on a.client_id = c.id group by c.id),
stages(name, ord) as (
  select * from unnest(array['topic','script','adapt_voice','audio','avatar','broll_plan','assemble']) with ordinality)
insert into client_pipelines (client_id, name, enabled_stages, product_input, sort_order)
select c.id, 'Default', array_agg(s.name order by s.ord),
       (c.content_type = 'product_visual'), 0
from clients c
join tier_cut t on t.id = c.id
join avatar_counts ac on ac.cid = c.id
join stages s on s.ord <= t.cut
where not (s.name='topic'       and c.script_mode='polish')
  and not (s.name='adapt_voice' and c.locale_language='english')
  and not (s.name in ('avatar','assemble') and (c.content_type='product_visual' or ac.n=0))
group by c.id;

-- J. Bind existing jobs to Default + snapshot its stage_plan.
update jobs j set pipeline_id = p.id, stage_plan = p.enabled_stages
from client_pipelines p where p.client_id = j.client_id and p.name = 'Default' and j.pipeline_id is null;
```
Expected: Kiran → uuid id, `slug='kiran'`, one `Default` pipeline with all 7 stages, `product_input=false`; e2e job bound + `stage_plan` = 7 stages.

### 2.3 `0004_drop_legacy.sql` (only after §8 verification)
```sql
alter table clients
  drop column content_type,
  drop column script_mode,
  drop column tier,
  drop column locale_region;
```
`locale_language` + `speech_words_per_sec` stay.

---

## 3. Core libraries

### 3.1 `pipeline/stages.ts` — rewrite
- `CANONICAL_STAGES` (was `FULL_ORDER`). `STAGE_INFO` label `adapt_voice` → **"Adapt Script"**.
- `normalizeStages(names): StageName[]` — filter to known, dedupe, canonical-sort.
- `validate(stages, opts): string[]` — §1.4 rules.
- `PIPELINE_PRESETS` — the 5 preset keys (§1.3): `{key,label,stages,productInput}`.
- `getStagePlan(pipeline)` = `normalizeStages(pipeline.enabled_stages)`. **Delete** `TIER_LAST_STAGE` + all tier/content/scriptMode/locale/avatar derivation.
- `getJobStagePlan(job)` = `normalizeStages(job.stage_plan ?? [])`; empty ⇒ full canonical (safety).
- `resolveReelStages(pipelineStages, {voiceover, injectScript})` — applies per-reel toggles: `!voiceover` removes `adapt_voice,audio,avatar`; `injectScript` removes `topic,script`. Returns normalized plan.
- Keep `nextStage`, `isStageInPlan`.

### 3.2 `clients/types.ts`
- Remove `Tier`/`ContentType`/`ScriptMode` and the `tier`/`contentType`/`scriptMode` fields; `locale` → `{ language: string }`; add `slug: string`.
- Add `ClientPipeline { id,name,enabled_stages:string[],product_input,duration_min_sec,duration_max_sec,duration_default_sec,sort_order,active }`.
- `ClientConfig` gains `slug` + `pipelines: ClientPipeline[]`. (No products type — not stored.)

### 3.3 `clients/loadConfig.ts`
Add `client_pipelines` query (`eq active true`, `order sort_order`) to the `Promise.all`; map in. Map `slug`. Drop `content_type`/`script_mode`/`tier`/`locale_region` from `mapRow`; `locale = {language}`.

### 3.4 `jobs.ts`
- `JobRow` gains `pipeline_id`, `stage_plan: string[]|null`, `product_image_urls: string[]`.
- **N1 fix:** `updateJobInternal` (unrestricted) for stage writers + `onSubmitted`; public `PATCHABLE_FIELDS` narrows to user-editable: `topic, template, target_duration_sec, english_script, full_script, avatar_label, broll_frequency, editor_notes, speech_speed`.
- `createJob(clientId, {pipelineId, voiceover, injectedScript?, productImageUrls?, createdBy?})`:
  1. Load pipeline; assert `client_id===clientId && active`.
  2. `stage_plan = resolveReelStages(pipeline.enabled_stages, {voiceover, injectScript: !!injectedScript})`.
  3. If `injectedScript`: set `english_script` (and `full_script` when plan lacks `adapt_voice`); log `job_events(script,succeeded,{source:'injected'})`.
  4. `product_image_urls = productImageUrls ?? []`; `current_stage` = first(plan).
- `stageNotInPlan(job, stage): NextResponse|null` → **409** when the stage isn't in `getJobStagePlan(job)`.

### 3.5 `labels.ts` — new
`PROVIDER_LABELS`, `STATUS_LABELS`, `humanize(snake)`, `stageLabel(name)`. Every dropdown/badge/subtitle/event-log line renders labels; values submitted raw.

### 3.6 `admin.ts`
Drop `content_type`/`script_mode`/`tier`/`locale_region` from `CLIENT_PATCHABLE`; add `slug`. `KB_DOCS` unchanged.

---

## 4. API

### 4.1 Changed
| Route | Change |
|---|---|
| `POST /api/jobs` | Body `{clientId, pipelineId, voiceover?, injectedScript?, productImageUrls?}` → `createJob`. `pipelineId` required; `voiceover` defaults true. |
| `GET /api/jobs?client=` | `select('*, client_pipelines(name)')` → `pipeline_name`. |
| `PATCH /api/jobs/[id]` | Narrowed allowlist (§3.4). |
| `GET→POST /api/generate-topic` | Body `{clientId, jobId, query?}`; `jobId` required; guard `topic`. **Region removed** (drop `Intl.DisplayNames`/`locale.region`; keep month; season context via research doc). Product jobs append a product block. |
| `POST /api/generate-english` | `jobId` required; guard `script`; `full_script` copy uses `getJobStagePlan`. Product block for product jobs. |
| `POST /api/generate-hinglish` | `jobId` required; guard `adapt_voice`. |
| `POST /api/revise-script` | `jobId` required; no stage guard. |
| `POST /api/generate-audio` | `jobId` required; guard `audio`. |
| `POST /api/generate-avatar` | Guard `avatar`. **Accept `productImageUrls`** (from job) → HeyGen attachments + prompt (§5.3). |
| `POST /api/generate-broll-plan` | Guard `broll_plan`. **Duration mode** when job plan lacks `audio` (§5.2). Product context + product-image placement entries (§5.3). |
| `POST /api/assemble-video` | Guard `assemble`. **Mode select** (§5.1): overlay if plan has `avatar` (needs `avatarVideoUrl`), else concat (needs clips + `job.audio_url`, silent if none). Reads audio from the **job row**. Resolves product-image placements. |
| `GET /api/clients/[id]/ui-config` | New shape: `{id, displayName, slug, pipelines:[{id,name,stagePlan:[{name,label}],duration:{min,max,default},productInput,hasVoiceStages}], templates, avatars}`. Drop tier/contentType/localeLanguage/top-level stagePlan+duration. Active pipelines only. |
| `POST /api/admin/clients` | Body `{display_name,…}` — **no `id`**; server generates slug from name (`[a-z0-9-]`, collision `-2/-3…`), id auto-uuid; KB paths/prefix from slug. |
| `POST /api/admin/clients/clone` | Body `{sourceId, displayName}`. Copies settings + templates + avatar labels + KB docs + **client_pipelines**. **N2 fix:** try/catch → `delete from clients where id=<newUuid>` on failure. |
| `PATCH /api/admin/clients/[id]` | Allowlist minus dropped cols (+`slug` editable). |
| `GET /api/admin/providers` | Drop `tiers`/`contentTypes`/`scriptModes`; add `stages:[{name,label}]` + `presets`. |
| `GET /api/admin/jobs` | Join `clients(display_name)` + pipeline name. |

### 4.2 New
| Route | Contract |
|---|---|
| `POST /api/uploads` (**requireUser**, client-scoped) | `multipart/form-data {file, clientId, kind:'product'}` → storage adapter → `{url}`. Folder `${slug}/jobs/_incoming/product`. Image only, ≤20 MB. Powers per-reel product upload in the Studio. |
| `POST /api/admin/upload` (requireAdmin) | Same, `kind:'avatar_preview'|'template_preview'` → `${slug}/uploads/${kind}`. Closes the "no preview-asset upload" gap. |
| `GET/POST/PATCH/DELETE /api/admin/clients/[id]/pipelines` | CRUD over `client_pipelines`; POST/PATCH run `normalizeStages`+`validate` → 400 w/ error list. |
| `GET /api/admin/clients/[id]/readiness` | Server checklist: `validate` on each active pipeline + §1.4 warnings → `{errors,warnings}`. |

### 4.3 Storage adapter
`cloudinary.upload(buffer,{folder,resourceType})` must accept `resourceType:'image'` (widen base type if needed).

---

## 5. Engine

### 5.1 Assembly — `pipeline/assembly.ts`
Keep `overlayBrolls` (avatar/overlay mode). Add `concatBrolls(clips, {audioPath?, targetDurationSec}, outputPath)`: per clip → scale/crop 1080×1920, place into `[start,end)` (images `-loop 1 -t`), `concat` filter, optional `-i audio` mapped, `-shortest`, libx264/aac; pad gaps via `tpad=stop_mode=clone` (never hard-fail on a small gap). `assemble-video`: `plan.has('avatar')` → overlay (base=avatarVideoUrl, 400 if missing); else concat (audio = `job.audio_url` or none → silent, from the job row not the body).

### 5.2 B-roll duration mode — `generate-broll-plan`
When `getJobStagePlan(job)` lacks `audio`: replace the timestamp block with `TARGET DURATION ${job.target_duration_sec}s; no narration timeline; emit clips that tile 0..N contiguously (each start = prev end; first 0; last = N).` If plan also lacks `avatar`: add `these clips ARE the whole visual track — vary shot types.` JSON contract unchanged.

### 5.3 Product (per-reel photos) — `heygen.ts` + prompts + placement
1. **Per-reel upload:** Studio uploads product photos via `POST /api/uploads` → Cloudinary URLs → stored on the job (`product_image_urls`).
2. **Avatar stage (variant 3):** `AvatarAdapter.render({avatarId, audioUrl, attachmentImageUrls?, onSubmitted})`; `heygen.ts` passes product photos as HeyGen attachment images and the route appends a product-use instruction to any prompt context HeyGen accepts. *(Exact HeyGen attachment field confirmed against HeyGen API docs at build; if the account/plan can't attach, degrade to product-as-B-roll. Credit-gated live test — flagged.)*
3. **Avatar-less variants (5,6):** `broll_plan` system contract gains an optional entry `{"media_type":"product_image","product_image_index":0,...}`; `assemble-video` resolves those to `product_image_urls[i]` (download → existing image-placement path), skipping generation. Product name/description + photo availability appended to topic/english/broll prompts.
4. **Prompt context helper** `productBlock(job)` shared by the three prompt routes.

---

## 6. Studio UI (`page.tsx` + `ScriptDisplay`)

### 6.1 Flow
1. **Start New Reel** → **pipeline picker** if >1 active pipeline (cards: name + stage chips), else auto-select. Then a compact **reel-setup** panel:
   - **Include voiceover?** toggle (default on) — shown when the pipeline has `audio`; off ⇒ this reel skips voice-script/TTS/avatar.
   - **Paste your own script?** (when pipeline has `script`) — reveals a textarea (injection).
   - **Product photos** uploader (when `pipeline.productInput`) → `POST /api/uploads`, collects URLs.
   Then `POST /api/jobs {clientId, pipelineId, voiceover, injectedScript?, productImageUrls?}` — **job exists before topic** (needed for binding, guards, resume). Recents show a `pipeline_name` chip.
2. **Screens derive from `job.stage_plan`** (kills hardcoded step numbers):

| Screen | Shown when plan has | Notes |
|---|---|---|
| Topic | `topic` | custom-topic fix: standalone "Generate Script with this topic" when the typed topic matches no card |
| Script | `script` OR injected/intake | ScriptDisplay + revise. Intake (variant 2): flow opens here on a paste screen; if plan has `adapt_voice` an "Optimize Script" button runs `generate-hinglish` |
| Architect | `audio` OR `broll_plan` | avatar look (if `avatar`+rows); b-roll freq + notes (if `broll_plan`); product recap (if product). Button "Generate Audio" (if `audio`) else "Continue to Assets" |
| Audio | `audio` | unchanged |
| Assets | `avatar` OR `broll_plan` | avatar video (if `avatar`); plan list; **Assemble enabled in concat mode without an avatar** |
| Final | `assemble` | unchanged |

Stepper renders from this list (index-based); `hydrateFromJob` maps artifacts → index against the same list. Duration bounds from the selected pipeline.

### 6.2 Polish
Reasoning tooltip `max-w-[min(18rem,80vw)]` (no viewport overflow); stepper labels `text-[10px]/truncate` on narrow; badges via `stageLabel`+`STATUS_LABELS`; home subtitle = active pipeline names (no raw tier/content_type).

---

## 7. Admin UI

### 7.1 Onboarding wizard — `/admin/clients/new` (the friction fix)
Full-page wizard; each step persists on Next (client exists from step 1, so partial onboarding resumes). Shows only sections the chosen pipelines need:

| Step | Content | Writes |
|---|---|---|
| 1 Basics | **Display name only** (no id field) + optional "Clone from…" (prefills; blank = empty). Language, words/sec. | `POST /clients` or `/clone` (inactive) |
| 2 Pipelines | Preset cards (multi-select) + toggle editor (stage checkboxes in canonical order, durations, product-input). Inline `validate` errors. | `POST …/pipelines` |
| 3 Stage config | Only groups used by an enabled stage: Script LLM (any LLM stage) · Voice (if `audio`) · Avatar provider (if `avatar`) · Visual provider (if `broll_plan`/`assemble`). Provider selects show labels. | `PATCH …/clients/[id]` |
| 4 Assets | Avatars (if `avatar`) + Templates, each with **Upload** buttons (`/api/admin/upload`). (No products — per-reel.) | avatars/templates routes |
| 5 Knowledge Base | Inline KB editor, only docs enabled stages use. | `…/kb` |
| 6 Review & activate | `GET …/readiness`: errors block, warnings list. Activate. | `PATCH active` |

Existing detail tabs stay for editing + gain a **Pipelines** tab (same toggle editor). Detail header shows readiness + drops `({id})`.

### 7.2 Clients list
Remove the id input; "New Client" → wizard. Row subtitle = pipeline names (resolve, no raw tier/id).

### 7.3 Jobs / Users
Jobs: show `clients.display_name` + pipeline name (not raw `client_id`); badges via `stageLabel`; retry map gains a `topic` case (POST+jobId). Users: show client display name.

### 7.4 Polish / bugs
`RowEditor` actions `<td>` has `flex` directly on the cell (breaks row height) → inner `<div className="flex">`. Number inputs: empty → `NaN` saved; guard `''→null`, `Number.isNaN` reject. All selects/badges via `labels.ts`. Final sweep at 375px + 1280px over every screen.

---

## 8. Execution order (one branch off `interface`; deploy once at end; `tsc` after each phase)

| Phase | What | Verify |
|---|---|---|
| **P0** | Snapshot Kiran rows → scratchpad. Run `0003`. | Kiran uuid id + `slug='kiran'`; Default pipeline 7 stages; e2e job bound + `stage_plan`; all child FKs `uuid`. |
| **P1** | Core libs: `stages.ts`, `types.ts`, `loadConfig.ts`, `labels.ts`, `jobs.ts` (cols + `createJob` + `resolveReelStages` + guard + N1), `admin.ts`. | `tsc` |
| **P2** | Routes §4.1 + new §4.2 + clone/providers/ui-config + `/api/uploads`. | `tsc` + curl (topic guard 409; jobs validation; ui-config shape) |
| **P3** | Engine: `concatBrolls`, assemble mode select, broll duration mode, HeyGen attachments, product placement + `productBlock`. | `tsc` + local ffmpeg concat on 2 stock clips |
| **P4** | Studio UI §6: pipeline picker, reel-setup (voiceover/inject/product), derived screens/stepper, custom-topic fix, labels, polish. | manual click-through |
| **P5** | Admin UI §7: wizard, pipelines tab, uploads, name-only, labels, row/number-input fixes. | manual |
| **P6** | Verification matrix. | all pass |
| **P7** | Run `0004`. Remove dead reads. Update `docs/` + memory. | `tsc` + one Kiran script-route smoke post-drop |

**P6 matrix:** Kiran regression (topic→script→adapt→audio live; avatar/assemble on user go-ahead) · variant-2 intake · variant-6 no-voiceover (duration-mode plan tiling + silent concat) · variant-5 product+voiceover concat · per-reel voiceover-off on Kiran's Default · injection drops topic/script · guards (avatar-stage 409 off-plan; foreign jobId 403; public PATCH strips `stage_status`) · wizard blank + clone + readiness-blocks-activation · multi-pipeline picker + resume · legacy job resumes from backfilled `stage_plan` · 375/1280 sweep, no raw snake_case or ids.

---

## 9. Deferred (unchanged)
Per-client vendor API keys (`*_api_key_env`, env-name pointers, dev-only) · caption burning (`caption_text` captured) · manual audio upload · script versioning · webhooks over polling · cost logging (`job_events.detail` ready) · publish-state lifecycle · RAG. Product-image **retry** caveat: since photos aren't cataloged, retrying a product stage after job expiry may need re-upload (URLs persist on the job while it lives).

## 10. Resolved decisions
UUID PK + slug (now) · products per-reel/not stored, HeyGen attachments · no music feature · voiceover per-reel toggle · tier deleted · `meera` deleted · HeyGen attachment API confirmed at build (credit-gated) · slug drives folder naming so Kiran media stays put.

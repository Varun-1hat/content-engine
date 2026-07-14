# Modular Pipeline Refactor — Final Spec

Grounded in the actual code (audited 2026-07-14). §0–3 = the audit (what exists, what's broken, what varies per client). §4+ = the frozen design. **Design freeze note:** after running the two migrations in §5, the schema does not get restructured again — every anticipated axis of variation (vendor, model, language, tier, content shape, avatar count, template set) has a home. Future needs can only *add* columns/tables, which is non-breaking; nothing existing gets reshaped.

---

## 0. Fix now (unrelated to the refactor, found during audit)

| # | Issue | Where | Status |
|---|-------|-------|-----|
| 1 | **Live Gemini API key hardcoded as fallback**, and `load_env()` only read `.env.local`, never `os.environ` — on Render this fallback was likely the key actually in use. | `src/lib/veo_generator.py:23`, `src/lib/imagen_generator.py:22` | **Fixed** — both read `os.environ` first, hard-fail if unset. Key rotation on Google's side: on you. |
| 2 | `exec("python ...")` but the Docker image only installs `python3` — B-roll generation fails silently in prod (per-clip errors are swallowed), leaving avatar-only videos. | `src/app/api/assemble-video/route.ts:82`, `Dockerfile:4` | **Fixed** — `python3`. Verify with one real render after deploy. |
| 3 | `.venv` (3,897 files) committed to git. | repo root | **Fixed** — untracked, gitignored. |
| 4 | `revise-script` hardcodes "Dr. Kiran" and a **different emotion-tag vocabulary** than the generation prompt teaches. | `src/app/api/revise-script/route.ts:15,26` vs `masterPrompt.ts:21-29` | Fixed by design in §4.4 (revise uses the client's voice prompt as system context). |
| 5 | `STRATEGY_DUMP` (past-content "avoid repeating" list) imported but never reaches any prompt. | `src/app/page.tsx:6` | Fixed by design — `kb_past_content_path` column + prompt wiring in §4.4 (generate-topic). |
| 6 | `@runwayml/sdk` and `@anthropic-ai/sdk` dependencies with zero imports. | `package.json` | **Open — your call**: drop or keep for planned integrations. |

---

## 1. Problem statement

Single-tenant app hardcoded to one client (Dr. Kiran), built as a POC that's now in production. Every "brain" (strategy doc, voice persona, B-roll style guide, avatar options) is a TS constant or hardcoded path, not data. No `client_id` exists anywhere. Two params the UI collects (`brollFrequency`, `editorInstructions`) never reach any API call.

Conclusion: **refactor, not rewrite**. The vendor-integration logic (Gemini/ElevenLabs/HeyGen/Veo/FFmpeg) is correct and battle-tested. What's missing is one layer: config-per-client instead of hardcoded-per-Kiran.

---

## 2. Audit — what's actually static vs. variable

### 2.1 Stage 1–2: Script generation (`generate-topic`, `generate-english`, `generate-hinglish`, `revise-script`)

| Value | Classification | Location |
|---|---|---|
| `RESEARCH_DOC` (IG strategy + 7 templates + hook/close rules) | **Business-variable** | `src/lib/researchDoc.ts` |
| **Topic-selection decision tree** (4-step analysis naming Kiran's 7 templates) | **Business-variable — but hardcoded in the route prompt, not the research doc.** Caught in the final design pass; now merged into the KB doc (seed-kb research_doc.md PART 3) so the route can be generic. | `generate-topic/route.ts:19-48` |
| `MASTER_PROMPT` (persona, Hinglish rules, emotion-tag vocabulary) | **Business-variable** — this *is* the client's voice | `src/lib/masterPrompt.ts` |
| "current month/season in **India**" framing | **Business-variable** → `locale_region` | `generate-topic/route.ts:11,16` |
| Words-per-second heuristic (2.5) | Rate is language-dependent → `speech_words_per_sec` column | `generate-english/route.ts:16` |
| JSON output schemas (topic list, script object) | **Infra-static** — these are the API contracts between stages; they stay in code | routes |
| Retry/fallback/JSON-fence stripping | Infra-static **but duplicated 4 ways with drift** (see §3) | all routes |
| Model names | **Business/tier-variable** → `model_script` / `model_structured` / `model_fallback` columns | all routes |

### 2.2 Stage 3: Production setup (UI only — `page.tsx`)

| Value | Classification |
|---|---|
| `EXCEL_TEMPLATES` + `TEMPLATE_PREVIEWS` (names, descriptions, sample videos) | **Business-variable** → `client_templates` table |
| `AVATARS` array + `/casual.png`-style images | **Business-variable** → `client_avatars` table (with `preview_image_url`) |
| `brollFrequency`, `editorInstructions` | Captured, never sent → become per-job fields, wired to the B-roll plan route |
| `globalSpeed` | Hidden UI, live plumbing → per-job field, keep |

### 2.3 Stage 4: Audio (`generate-audio/route.ts`)

| Value | Classification |
|---|---|
| Header/bracket stripping, timestamp parsing, FFmpeg `atempo`+`loudnorm`, Cloudinary upload | **Infra-static** — shared pipeline code |
| `ELEVENLABS_VOICE_ID` env var | → `voice_id` column |
| `eleven_v3`, `stability: 0.5` | → `voice_model_id`, `voice_stability` columns |
| `loudnorm=I=-16` | Infra-static (social-media loudness standard); `extra` covers exceptions |
| Folder `"dr_kiran_audio"` | → `${storage_folder_prefix}/audio` |

### 2.4 Stage 5: Avatar + B-roll plan

| Value | Classification |
|---|---|
| `HEYGEN_AVATAR_ID_*` env-var map | → `client_avatars` rows; browser sends the **label**, server resolves to `avatar_id` (IDs never ship to the client) |
| HeyGen call shape, polling, 1080×1920 | **Infra-static** (9:16 is the product) |
| `dr_kiran_creative_director_promptv2.md` (Indian-specific visual rules) | **Business-variable** → `kb_creative_director_prompt_path`. The Indian-specific negative-prompt *example* embedded in the route's JSON-format instruction moves into the KB doc too; the route keeps only the generic format contract. |
| `brollFrequency`/`editorInstructions` | Wired in as prompt context (finally) |

### 2.5 Stage 6: Assembly (`assemble-video/route.ts`, python generators)

| Value | Classification |
|---|---|
| FFmpeg overlay construction, parallel generation, temp handling | **Infra-static** |
| `veo_generator.py` / `imagen_generator.py` branch | Already the vendor-swap point → formalized as the visual adapter |
| Folder `"dr_kiran_assembled"` | → `${storage_folder_prefix}/assembled` |

### 2.6 Persistence (`save-script/route.ts`)

Unwired route inserting into a `scripts` table with no `client_id`. **Deleted in this design** — replaced by the `jobs` table (§4.2), which is the `Reel` record from `public/little_fern_reel_engine_flow.md` implemented literally.

---

## 3. Cross-cutting: the Gemini call is copy-pasted 4 different ways

| Route | Retries | 503 fallback | JSON mode | Extraction regex |
|---|---|---|---|---|
| `generate-topic` | 3x/1s | no | native | `\[[\s\S]*\]` |
| `generate-english` | none | → 1.5-pro | no | `\{[\s\S]*\}` |
| `generate-hinglish` | none | → 1.5-pro | no | `\{[\s\S]*\}` |
| `generate-broll-plan` | none | no | native | none |
| `revise-script` | **none** | **none** | no | none |

One adapter replaces all five variants with: retry(3) → fallback-model → native JSON mode where structured → single extraction path.

**The clean split, as a rule:** *structural output contracts (JSON schemas between stages) live in code; content, persona, style, and selection rules live in KB docs; settings and IDs live in DB columns; secrets live in env vars.* Every piece of the system falls into exactly one of those four buckets.

---

## 4. Final design

### 4.1 Schema — `supabase/migrations/0001_init.sql` (single migration, run once)

Four tables. Full DDL in the migration file; shape:

```
clients            -- one row per client; every setting a real column (Studio row editor = admin panel)
  id, display_name, content_type, script_mode, tier, active
  locale_language, locale_region, speech_words_per_sec
  kb_research_doc_path, kb_voice_prompt_path, kb_creative_director_prompt_path, kb_past_content_path
  script_provider, model_script, model_structured, model_fallback
  voice_provider, voice_id, voice_model_id, voice_stability
  avatar_provider
  visual_provider, visual_style_preset
  storage_provider, storage_folder_prefix
  extra jsonb        -- escape hatch for one-offs ONLY; promote repeated settings to real columns
  created_at, updated_at

client_avatars     -- 0..N looks per client (0 = skip avatar stage; 1 = brand ambassador; N = wardrobe)
  id, client_id fk, label, avatar_id, preview_image_url, sort_order   [unique (client_id, label)]

client_templates   -- the reel formats the UI offers for this client
  id, client_id fk, label, description, preview_video_url, sort_order [unique (client_id, label)]
                   -- labels must match template names in the client's research doc (AI matches by name)

jobs               -- one row per reel; the `Reel` record from little_fern_reel_engine_flow.md
  id, client_id fk, status (draft→script_ready→audio_ready→rendering→assets_ready→assembling→done|failed)
  topic, template, target_duration_sec, english_script, full_script, script_meta jsonb
  avatar_label, broll_frequency, editor_notes, speech_speed      -- per-JOB choices, not per-client
  audio_url, audio_timestamps jsonb, avatar_video_url, broll_plan jsonb, final_video_url, error
```

jsonb appears only for **machine-written artifacts** (timestamps, B-roll plans, script metadata) — never for anything a human edits by hand. RLS enabled on all four tables with zero policies: the publishable key can touch nothing; all access is server-side via the secret key.

**Why `jobs` now** even though persistence is the last implementation step: creating it costs nothing and means the schema never changes shape again — every remaining step is code-only.

### 4.2 Storage

Bucket `client-kb` (private). Per client: `<client_id>/research_doc.md`, `voice_prompt.md`, `creative_director_prompt.md`, optional `past_content.md`. Referenced by the `kb_*_path` columns.

**Single source of truth rule:** Supabase Storage is the *only* runtime source. `supabase/seed-kb/` in the repo is onboarding seed material (initial upload + versioned backup), never read by the app.

Kiran's seed files (extracted programmatically from the live TS constants — byte-identical):
- `research_doc.md` — now includes PART 3 (topic-selection decision tree, moved out of the route)
- `voice_prompt.md`, `creative_director_prompt.md`

### 4.3 Code layout

```
src/lib/
  clients/
    types.ts            ✅ ClientConfig / ResolvedClient / ClientAvatar / ClientTemplate
    loadConfig.ts       ✅ loadClientConfig(id) → row + avatars + templates + KB docs; 60s cache
  adapters/
    script/   gemini.ts + index.ts      generate({system, prompt, model, fallbackModel, json}) → text
    voice/    elevenlabs.ts + index.ts  synthesize(text, {voiceId, modelId, stability}) → {audioBase64, alignment}
    avatar/   heygen.ts + index.ts      render({avatarId, audioUrl}) → videoUrl   (polls internally)
    visual/   veo_imagen.ts + index.ts  generateClip({prompt, negativePrompt, mediaType, outPath}) → localPath
    storage/  cloudinary.ts + index.ts  upload(buffer, {folder, resourceType}) → url
  pipeline/
    audio.ts            text preprocessing + timestamp parsing + ffmpeg normalize (shared, vendor-free)
    assembly.ts         ffmpeg overlay/stitch logic (shared, vendor-free)
```

Each `index.ts` exports `get<Kind>Adapter(provider)` — a lookup keyed by the client's `*_provider` column. New vendor = one new file + one map entry; zero route changes. The Python generators stay (invoked by the visual adapter via `python3`).

### 4.4 Per-route changes (the complete list)

Every route gains `clientId` (body for POSTs, `?client=` for GETs) and starts with `const c = await loadClientConfig(clientId)`.

| Route | Changes |
|---|---|
| `generate-topic` | Prompt = `c.researchDoc` (which now contains the decision tree) + generic task/format block. Region/season from `c.locale`. If `c.pastContent` non-empty, append "PREVIOUSLY PUBLISHED — avoid repeating: …". Model `c.script.structuredModel` via script adapter. |
| `generate-english` | Prompt = `c.researchDoc` + generic task block. Word count = `duration × c.speechWordsPerSec`. Model `c.script.model`, fallback `c.script.fallbackModel`. |
| `generate-hinglish` | Prompt = `c.voicePrompt` + generic task block. Model `c.script.model`. (Route name is legacy — it's the "voice-adaptation" step; rename to `adapt-voice` optional, low priority.) |
| `revise-script` | System = `c.voicePrompt` (fixes finding #4: persona + tag vocabulary now always match generation). Model `c.script.model` via adapter (gains retry/fallback for free). |
| `generate-audio` | Voice adapter with `c.voice.*`. Upload folder `${c.storage.folderPrefix}/audio`. Shared pipeline code (`pipeline/audio.ts`) unchanged in behavior. |
| `generate-avatar` | Body sends `avatarLabel`; server resolves via `c.avatars` (label→`avatar_id`). Avatar adapter chosen by `c.avatarProvider`. |
| `generate-broll-plan` | System = `c.creativeDirectorPrompt` + generic JSON-format contract (Indian-specific example text moved into the KB doc). Body gains `brollFrequency` + `editorNotes`, appended as creative guidance. Model `c.script.structuredModel`. |
| `assemble-video` | Visual adapter chosen by `c.visual.provider`. Upload folder `${c.storage.folderPrefix}/assembled`. |
| `save-script` | **Delete.** Replaced by `jobs` routes in step F. |
| **New:** `GET /api/clients` | List `{id, display_name}` of active clients — powers the picker. |
| **New:** `GET /api/clients/[id]/ui-config` | Safe UI subset: display name, tier, content type, templates (label/description/preview), avatars (label/preview only — **vendor IDs never ship to the browser**), default duration bounds. |
| **New (step F):** `POST /api/jobs`, `PATCH /api/jobs/[id]`, `GET /api/jobs?client=` | Thin CRUD over `jobs`; each UI stage transition persists its artifacts. |

### 4.5 UI (`page.tsx`)

1. Fake login screen → **client picker** (from `/api/clients`; selection also readable from `?client=` for direct links).
2. `EXCEL_TEMPLATES`, `TEMPLATE_PREVIEWS`, `AVATARS` deleted → rendered from `/api/clients/[id]/ui-config`.
3. Every fetch adds `clientId`; avatar step sends `avatarLabel`; architect step finally sends `brollFrequency` + `editorInstructions` to the B-roll plan call.
4. Tier-awareness: steps render conditionally (`audio_only` stops after stage 4; `product_visual` skips avatar) — simple conditionals on `tier`/`contentType`, not a rearchitecture.
5. Step F: stage transitions write to `jobs` so work survives refresh (resume = load job by id).

### 4.6 Env vars — final state

| Stays in env (secrets) | Moves to DB (was env) | Gone |
|---|---|---|
| `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`, `CLOUDINARY_*`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | `ELEVENLABS_VOICE_ID` → `clients.voice_id` · `HEYGEN_AVATAR_ID_*` → `client_avatars` | `NEXT_PUBLIC_HEYGEN_AVATAR_ID`, `HEYGEN_AVATAR_ID` fallbacks |

### 4.7 Deletions (final step, after nothing imports them)

`src/lib/researchDoc.ts`, `masterPrompt.ts`, `strategyDump.ts` · `public/dr_kiran_creative_director_promptv2.md` · `src/app/api/save-script/` · root `strategy_dump.json`, `parse_excel.js`, `Dr_Kiran_IG_Strategy.xlsx` (after optionally distilling its published-topics list into `kiran/past_content.md`) · `xlsx` dependency · (your call: `@runwayml/sdk`, `@anthropic-ai/sdk`).

---

## 5. Execution order

Phases 1+2 from the earlier draft are **merged per-route**: each route gets config-loading *and* adapter extraction in one pass, so every route is touched once, not twice. The app keeps working for Kiran after every single step.

| Step | What | Who |
|---|---|---|
| **A** | Run `0001_init.sql`, fill 5 placeholders in `0002_seed_kiran.sql`, run it. Upload the 3 (or 4) KB docs from `supabase/seed-kb/kiran/` to the `client-kb` bucket (bucket may already exist from the earlier attempt — the files are unchanged except `research_doc.md`, **re-upload that one**; it gained PART 3). | **You** |
| **B** | Build adapters + `pipeline/` modules + the two new client routes. No existing route touched yet. | Code |
| **C** | Migrate routes one at a time, verifying against Kiran after each: topic → english → hinglish → revise → audio → avatar → broll-plan → assemble. | Code |
| **D** | `page.tsx`: picker, config-driven UI, wire the dropped params, tier conditionals. | Code |
| **E** | Deletions (§4.7). End-to-end test: one full reel for Kiran. | Code |
| **F** | Jobs persistence: CRUD routes + stage-transition writes + resume-by-id. (Table already exists — code-only.) | Code |

After **A**, the schema is frozen. B–F are code; each is independently verifiable.

---

## 6. Onboarding a new client (the runbook this was all for)

1. **Studio → clients**: insert row — all plain fields. Pick tier/content_type; set `storage_folder_prefix`.
2. **Studio → client_avatars / client_templates**: insert rows (0 avatars is valid for product-visual).
3. **Storage → client-kb/<id>/**: upload the client's 3 KB docs (start from Kiran's as skeletons; template names in `research_doc.md` must match the `client_templates` labels).
4. External one-time setup: ElevenLabs voice (license/clone) → `voice_id`; HeyGen avatar(s) → `client_avatars.avatar_id`; consent sign-off where applicable.
5. Open app → pick client → run one script + one full video → client sign-off → live.

No code. Editing an existing client = editing a cell in Studio (≤60s to take effect, per the config cache TTL).

---

## 7. Explicitly deferred (decided *against* for now — not gaps)

| Item | Why deferred | Cost when needed |
|---|---|---|
| Decomposing the 7 templates into structured rows (rules as columns) | Templates-as-prose works today; decomposition is a prompt-engineering project, not a schema one | Additive table |
| Per-client vendor API keys (client-billed accounts) | Secrets don't belong in the DB; all clients bill through your accounts today | Additive column naming an env var (`voice_api_key_env`) |
| Aspect ratios other than 9:16 (e.g. 16:9 ad cuts) | Every current client is reels; 9:16 is the product | Additive `jobs.aspect_ratio` column |
| Cost-per-deliverable logging (tokens + vendor minutes) | Valuable for tier pricing, but measurement, not architecture | Additive `job_events`/cost table |
| Admin panel | Studio row editor covers it at current scale — that's what the flattened columns bought | Pure frontend over existing tables |
| Webhooks instead of polling (HeyGen/Veo) | Polling works at current volume; webhooks need a public callback URL + reconciliation | Adapter-internal change, invisible to routes |
| RAG over KB docs | Docs are ~10KB each — full-prompt inclusion is fine; RAG matters when KBs are 100x this (chatbot territory, different pipeline family) | Separate concern |

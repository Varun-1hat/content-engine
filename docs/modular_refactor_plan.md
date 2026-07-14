# Modular Pipeline Refactor — Audit & Plan

Grounded in the actual code (audited 2026-07-14), not the abstract framework. This doc is the sequel to that framework: real file/line references, real bugs, concrete phased steps.

---

## 0. Fix now (unrelated to the refactor, found during audit)

| # | Issue | Where | Fix |
|---|-------|-------|-----|
| 1 | **Live Gemini API key hardcoded as fallback**, committed in the initial commit. `load_env()` only reads a `.env.local` file, never `os.environ` — so on Render (env vars injected as real process env, no `.env.local` file exists) this fallback was likely **the key actually in use in production**, not a dead edge case. | `src/lib/veo_generator.py:23`, `src/lib/imagen_generator.py:22` | **Done** — patched both to read `os.environ` first, hard-fail with a clear error if unset. **You still need to:** rotate/revoke this key in Google AI Studio / Cloud Console now, and set `GEMINI_API_KEY` in Render's env vars if it isn't already. |
| 2 | `exec("python ...")` calls a binary the Docker image never installs — Dockerfile only installs `python3`/`python3-pip`, no `python`→`python3` symlink. Errors are caught per-clip and logged, not thrown, so the request still "succeeds" with an avatar-only video and silently zero B-roll. | `src/app/api/assemble-video/route.ts:82`, `Dockerfile:4` | Change `python` → `python3` in the exec command (one word). Worth testing one real render against the Render deployment to confirm B-roll has actually been landing. |
| 3 | `.venv` (3,897 files) is committed to git — not in `.gitignore`. | repo root | Add `.venv/` to `.gitignore`, `git rm -r --cached .venv`. Bloats every clone; not urgent, just cleanup. |
| 4 | `revise-script` hardcodes "Dr. Kiran" by name and a **different emotion-tag vocabulary** (`[urgent],[pause],[slow],[warm],[emphasis]`) than the one the generation prompt actually teaches (`[excited_surprised],[serious],[concerned],[urgent],[informative],[reassuring],[instructive],[neutral]`). Revisions can inject tags the rest of the pipeline doesn't recognize. | `src/app/api/revise-script/route.ts:15,26` vs `src/lib/masterPrompt.ts:21-29` | Fold into Phase 2 (script adapter) — same root cause as everything else in §2.3. |
| 5 | `STRATEGY_DUMP` (past-published-content list, explicitly meant to "avoid repeating") is imported into the UI but never referenced again — never reaches any prompt. | `src/app/page.tsx:6` | Dead import. Either wire it into the topic-generation prompt (real value: stops repeat topics) or delete it. Your call — flagged, not fixed. |
| 6 | `@runwayml/sdk` and `@anthropic-ai/sdk` are dependencies with zero imports anywhere in `src/`. | `package.json:12,14` | Confirm intentional (future integration) or drop. |

---

## 1. Problem statement

Single-tenant app hardcoded to one client (Dr. Kiran), built as a POC that's now in production. Every "brain" (strategy doc, voice persona, B-roll style guide, avatar options) is a TS constant or hardcoded path, not data. No `client_id` exists anywhere in the schema or code. Two params the UI already collects (`brollFrequency`, `editorInstructions`) never reach any API call — confirmed at the exact fetch call sites, not just observed as a symptom.

Conclusion from the audit (matches the earlier framework call): **refactor, not rewrite**. The vendor-integration logic (Gemini/ElevenLabs/HeyGen/Veo/FFmpeg) is correct and battle-tested. What's missing is one layer: config-per-client instead of hardcoded-per-Kiran.

---

## 2. Audit — what's actually static vs. variable

### 2.1 Stage 1–2: Script generation (`generate-topic`, `generate-english`, `generate-hinglish`, `revise-script`)

| Value | Classification | Location |
|---|---|---|
| `RESEARCH_DOC` (IG algorithm strategy + 7 reel templates + hook/close rules) | **Business-variable** — 100% Kiran/pediatric-vertical content | `src/lib/researchDoc.ts` (imported by 2 routes) |
| `MASTER_PROMPT` (persona, Hinglish rules, ElevenLabs emotion-tag vocabulary, script structure timing) | **Business-variable** — the single highest-value thing to extract; this *is* the client's voice | `src/lib/masterPrompt.ts` |
| "current month/season in **India**" framing | **Business-variable** → becomes `locale.region` | `generate-topic/route.ts:11,16` |
| Word-count-from-duration heuristic (2.5 words/sec) | Infra-static logic, but the *rate* is language-dependent — should be a config number, not a literal | `generate-english/route.ts:16` |
| JSON output schema (topic/template/hookType/wordCount/etc.) | Infra-static — reusable shape | `masterPrompt.ts:63-73` |
| Retry (3x/1s), 503→`gemini-1.5-pro` fallback, JSON-fence stripping | Infra-static **but duplicated 4 times with drift** — `revise-script` has *none* of this (no retry, no fallback) | all 4 routes, see §3 |
| Model name (`gemini-2.5-flash`, was `-pro` until an uncommitted change today) | **Business/tier-variable** — should be a config knob, not a literal repeated 5x | all 4 routes |

### 2.2 Stage 3: Production setup (UI only — `page.tsx`)

| Value | Classification |
|---|---|
| `EXCEL_TEMPLATES` (7 template names), `TEMPLATE_PREVIEWS` (hardcoded video URLs + descriptions) | **Business-variable** — Kiran-specific content baked into the component (lines 30-38, 68-97) |
| `AVATARS = ["Casual","Scrub","Formal","Studio"]` | **Business-variable** — a brand-ambassador client has exactly 1 avatar, not 4 named looks |
| `brollFrequency`, `editorInstructions` state | Captured, shown back to the user, **never sent** to `/api/generate-audio` (line 183) or `/api/generate-broll-plan` (line 219) — confirmed gap |
| `globalSpeed` slider | UI hidden (commented out, lines 610-628) but state still wired at 1.0 default — dead UI, live plumbing |

### 2.3 Stage 4: Audio (`generate-audio/route.ts`)

| Value | Classification |
|---|---|
| Header/bracket-stripping regex, sentence-boundary timestamp parser, FFmpeg `atempo`+`loudnorm` pipeline, Cloudinary upload | **Infra-static** — fully reusable as-is, vendor-agnostic once ElevenLabs call is wrapped |
| `ELEVENLABS_VOICE_ID` (env var) | Already half-externalized — good instinct, wrong shape for multi-tenant (one global env var can't hold N clients' voice IDs) |
| `model_id: 'eleven_v3'`, `stability: 0.5`, `loudnorm=I=-16` | **Business-variable** — reasonable defaults, should be per-client overrides |
| Cloudinary folder `"dr_kiran_audio"` | **Business-variable** → `${client_id}/audio` |

### 2.4 Stage 5: Avatar + B-roll plan

| Value | Classification |
|---|---|
| 4-key avatar lookup (`HEYGEN_AVATAR_ID_CASUAL/SCRUB/FORMAL/STUDIO`) | **Business-variable** — models "avatar looks" as Kiran-specific env vars; won't scale past client #2 without proliferating env vars per client | `generate-avatar/route.ts:14-19` |
| HeyGen call shape, polling (5s × 60), 1080×1920, `avatar_style/version` | **Infra-static** — this stage is already the closest thing to a clean adapter in the codebase |
| `dr_kiran_creative_director_promptv2.md` (Indian skin-tone rules, jhabla/onesie clothing, Mumbai settings, katori/Krishna-idol props, B-roll timing rules) | **Business-variable** — entire file is Kiran/pediatric-vertical visual style, loaded via a hardcoded `path.join` | `generate-broll-plan/route.ts:17` |
| `brollFrequency`/`editorInstructions` | **Confirmed never in the request body** — route destructures only `script, audioUrl, avatarVideoUrl, timestamps` (line 10); frontend never sends them (page.tsx:219-224) |

### 2.5 Stage 6: Assembly (`assemble-video/route.ts`, `veo_generator.py`, `imagen_generator.py`)

| Value | Classification |
|---|---|
| FFmpeg complex-filter construction (setpts/scale/crop/overlay), parallel `Promise.all` generation, Cloudinary upload, temp-dir cleanup | **Infra-static** — generic, reusable regardless of vendor |
| `scriptFile = imagen_generator.py \| veo_generator.py` branch | This *is* the vendor-swap point already — cleanly isolated, smallest lift in the whole codebase to add a 3rd engine (Kling/Runway) |
| Cloudinary folder `"dr_kiran_assembled"` | **Business-variable** → `${client_id}/assembled` |

### 2.6 Persistence (`save-script/route.ts`)

Generic Supabase insert, but table `scripts` has no `client_id` column and isn't called from the UI at all. This is the literal seed of the jobs table in §4.3 — needs to grow into that, not just get wired up as-is.

---

## 3. Cross-cutting pattern: the Gemini call is copy-pasted 4 different ways

| Route | Retries | 503 fallback | JSON mode | Extraction regex |
|---|---|---|---|---|
| `generate-topic` | 3x/1s | no | native `responseMimeType` | `\[[\s\S]*\]` |
| `generate-english` | none | → `gemini-1.5-pro` | no | `\{[\s\S]*\}` |
| `generate-hinglish` | none | → `gemini-1.5-pro` | no | `\{[\s\S]*\}` |
| `generate-broll-plan` | none | no | native `responseMimeType` | none (trusts native mode) |
| `revise-script` | **none** | **none** | no | none |

Four variants of the same thing, one with zero resilience. This is the clearest single extraction target — see Phase 2.

Also inconsistent: two KB documents live as TS constants (`researchDoc.ts`, `masterPrompt.ts`), one lives as a markdown file read from disk at request time (`dr_kiran_creative_director_promptv2.md`). All three need to end up config content loaded the same way, by `client_id`.

---

## 4. Target architecture (refined from the framework doc using the real audit)

### 4.1 Client config

Recommend **Supabase table**, not a JSON file in the repo — `public/little_fern_reel_engine_flow.md:24` already states the requirement explicitly: *"editable config so Kiran/Pari can tune prompts without a code change."* A repo file still needs a deploy; a DB row (or DB row + Supabase Storage for the long prose docs) doesn't.

```
clients
  id            text primary key   -- "kiran"
  content_type  text               -- talking_head | product_visual
  tier          text               -- scenario_premium | full_production | avatar_only | audio_only | script_only
  script_mode   text               -- generate | polish
  active        boolean
  config        jsonb              -- everything below
```

`config` shape (fields marked ← are the ones this audit found hardcoded and traced to a real file/line above):

```json
{
  "locale": { "language": "hinglish", "region": "IN" },
  "knowledge_base": {
    "strategy_doc": "kb/kiran/research_doc.md",       // ← researchDoc.ts
    "voice_prompt": "kb/kiran/master_prompt.md",       // ← masterPrompt.ts
    "creative_director_prompt": "kb/kiran/creative_director.md", // ← dr_kiran_creative_director_promptv2.md
    "past_content": "kb/kiran/strategy_dump.json"      // ← strategyDump.ts (currently dead)
  },
  "templates": [ /* the 7 template defs, currently prose inside researchDoc.ts */ ],
  "voice": { "provider": "elevenlabs", "voice_id": "...", "model_id": "eleven_v3", "stability": 0.5 },
  "avatars": [ { "label": "Casual", "avatar_id": "..." }, { "label": "Scrub", "avatar_id": "..." } ],
  "visuals": { "provider": "veo_imagen", "style_preset": "indian_pediatric_v2" },
  "models": { "script": "gemini-2.5-pro", "structured": "gemini-2.5-flash" },
  "storage": { "provider": "cloudinary", "folder_prefix": "kiran" }
}
```

`avatars` as an array (not 4 fixed env-var slots) covers Kiran (4 looks), a brand client (exactly 1, created once), and a product-visual client (0 — skip the stage).

### 4.2 Adapters (interfaces, not vendors)

| Adapter | Signature | Replaces |
|---|---|---|
| `adapters/script/gemini.ts` | `generate(system, user, {model, jsonMode, retries, fallbackModel}) → string` | the 4 duplicated blocks in §3, including giving `revise-script` the resilience it currently lacks |
| `adapters/voice/elevenlabs.ts` | `synthesize(text, {voiceId, stability, modelId}) → {audioBase64, alignment}` | ElevenLabs fetch in `generate-audio` (ffmpeg/timestamp-parsing stay as shared pipeline code — not vendor-specific) |
| `adapters/avatar/heygen.ts` | `render({avatarId, audioUrl, dimension}) → videoUrl` (polls internally) | `generate-avatar/route.ts` body |
| `adapters/visual/veo_imagen.ts` | `plan(...) → clips[]`, `generateClip(clip) → localPath` | python-spawn logic in `assemble-video/route.ts` (fixes the `python3` bug in one place instead of two scripts) |
| `adapters/storage/cloudinary.ts` | `upload(buffer, {folder, resourceType}) → url` | 3 duplicated `cloudinary.uploader.upload_stream` blocks |

Each route shrinks to: load client config → call adapter → return. Swapping HeyGen→Higgsfield or Veo→Kling means writing one new adapter file; zero route changes.

### 4.3 Jobs table

`public/little_fern_reel_engine_flow.md:28-44` already specs this almost exactly (the `Reel` record) — Phase 3 is mostly *implementing an existing spec*, not new design:

```
jobs
  id, client_id, status,
  topic, template, target_duration,
  english_script, full_script, script_version,
  broll_frequency, editor_notes,        -- ← finally has somewhere to go
  audio_url, timestamps_json,
  avatar_video_url, avatar_look,
  broll_plan_json,
  final_video_url,
  created_at, updated_at
```

---

## 5. Phased plan

**Phase 1 — Client model** (do first; nothing else can start without a `client_id`)
1. Create `clients` table in Supabase.
2. Move `researchDoc.ts` / `masterPrompt.ts` / `dr_kiran_creative_director_promptv2.md` content to Supabase Storage under `kb/kiran/*`, referenced by the config's `knowledge_base` paths.
3. `src/lib/clients/loadConfig.ts` — `loadClientConfig(clientId)`, fetches row + KB content.
4. Thread `client_id` through every route (request body gains it; route loads config instead of importing the hardcoded constant).
5. UI: replace the single "Log In as Dr. Kiran" button with a client picker (or `?client=` param); swap `EXCEL_TEMPLATES`/`AVATARS`/`TEMPLATE_PREVIEWS` for `config.templates`/`config.avatars`.

**Phase 2 — Adapters**
Mechanical, one file at a time, per §4.2. Fixes the `revise-script` resilience gap and the tag-vocabulary mismatch (finding #4) as a side effect, since the adapter pulls the tag vocabulary from the same config the generation step uses.

**Phase 3 — Jobs table**
Per §4.3. Wire a row-per-stage-transition instead of React-state-only. Add `GET /api/jobs/[id]` for a status view — not a full admin UI.

Sizing (solo dev, relative not hours): Phase 1 = M, Phase 2 = M (mechanical but touches every route), Phase 3 = S.

---

## 6. Onboarding (post-Phase-1)

1. Insert a row into `clients` via Supabase Studio — no custom admin panel.
2. Upload KB docs to Supabase Storage under `kb/<client_id>/`.
3. Create voice_id (ElevenLabs) + avatar_id(s) (HeyGen) outside the pipeline; paste into config.
4. One script + one full video through `?client=<id>`, sign-off.
5. Go live.

No code changes per client once Phase 1 lands — only Phase 2 (new vendor) or a genuinely new content shape (`product_visual`) touches code again.

---

## 7. Open decisions

| Decision | Recommendation | Why it's not just decided for you |
|---|---|---|
| Repo B strategy: new git branch vs. literal separate repo/Render service | Branch — git already gives "safe to abandon," a second repo adds deploy/drift overhead for a solo dev | Depends on whether Render is auto-deploying `main` right now; if so a branch alone doesn't give you a safe staging URL to test against |
| KB storage: Supabase Storage vs. repo files under `kb/` | Supabase Storage | Repo files are simpler for a solo dev today but reintroduce "prompt tuning needs a deploy," which `little_fern_reel_engine_flow.md` explicitly calls out as something to avoid |
| Fix `python`→`python3` now vs. bundle into Phase 2 | Now — one word, zero risk, independent of everything else | — |

# Research Report — Kiran Reels v5 close-out (8 items)

Read first, as instructed: `CLAUDE.md` and `STATUS.md`. STATUS is dated 2026-07-18 and already carries item 1 as **R14** (STATUS.md:103) and the item-5-adjacent silence note as **R13** (STATUS.md:102). STATUS.md:174 says the tree is uncommitted; `git status` confirms only `CLAUDE.md` modified plus untracked `.claude/`, so the v4.1 close-out described there appears committed since.

Everything below is **verified by reading the cited file/line** unless explicitly marked *(inferred)* or listed in §6.

---

## 1. How it works today

### 1a. The shared spine (all items ride on this)

| File | Role |
|---|---|
| `src/lib/pipeline/stages.ts` | Sole authority on pipeline shape: `StageName`, `CANONICAL_STAGES`, `validate()`, `resolveReelStages()`, `getJobStagePlan()`, the 5 presets. |
| `src/lib/jobs.ts` | `JobRow` mirror of the `jobs` table, `PATCHABLE_FIELDS` allowlist, `createJob`, `updateJobInternal` vs `updateJob`, the guards `jobClientMismatch`/`stageNotInPlan`, and `startStage`/`completeStage`/`failStage`. |
| `src/lib/clients/loadConfig.ts` | Loads client row + 4 KB docs from the `client-kb` bucket, 60 s cache. `speechWordsPerSec` mapped at :27. |
| `src/app/page.tsx` | The whole Studio, one 1494-line client component. All reel state is `useState` in this file. |
| `src/lib/pipeline/assembly.ts` | `downloadToFile`, `overlayBrolls`, `concatBrolls`. |
| `src/lib/pipeline/coverage.ts` | `MIN_NARRATION_COVERAGE = 0.95` + `checkNarrationCoverage` (pure). |
| `src/lib/pipeline/product.ts` | `hasProduct`, `productBlock`, `fetchProductImages`, `MAX_IMAGE_BYTES`, `MAX_IMAGES`. |

Stage routes, all in `src/app/api/`: `generate-topic`, `generate-english` (script), `generate-hinglish` (adapt_voice), `generate-audio`, `generate-avatar`, `generate-broll-plan`, `assemble-video`, plus `jobs`, `jobs/[id]`, `uploads`, `revise-script`.

Migrations present: `0001_init.sql` … `0006_harden_function_search_path.sql`. **Next number is `0007`.** No CLI.

### 1b. Item 1 — `broll_frequency` state flow

Full path, Studio → DB:

- `src/app/page.tsx:82` — `const [brollFrequency, setBrollFrequency] = useState("Standard")`. The initial value is a **string literal**, not client config.
- `src/app/page.tsx:1207-1215` — the three chips (`BROLL_OPTIONS` at :37); `onClick={() => setBrollFrequency(freq)}` at :1210 is the only user-facing writer.
- `src/app/page.tsx:215` — the *other* writer: `if (job.broll_frequency) setBrollFrequency(job.broll_frequency);` inside `hydrateFromJob`, truthy-guarded.
- `src/app/page.tsx:489-530` — `handleGenerateVideoPipeline` is recreated every render and reads `brollFrequency` from its closure at :515, `editorInstructions` at :516, into the `/api/generate-broll-plan` POST body.
- `src/app/api/generate-broll-plan/route.ts:43` destructures it, :110-113 selects `FREQUENCY_GUIDANCE` (overlay) or `CONCAT_FREQUENCY_GUIDANCE` (concat, keyed on `noAvatar` at :65), :167 persists `broll_frequency: brollFrequency ?? null` **inside `completeStage`**.

Two facts that matter more than the suspected race:

1. `supabase/migrations/0001_init.sql:127` — `broll_frequency text default 'Standard'`. **Every new job row already reads `"Standard"` from the moment it is inserted.** The user's choice only lands in the row when `broll_plan` *completes*. Any read of the row before that — or after a failed/retried plan stage — shows `"Standard"` regardless of what was clicked. This is a complete, code-verified explanation of the observed symptom that requires no React race.
2. `src/app/page.tsx:235-257` (`openSetup`) resets topic, suggestions, overrides, editor notes, pipeline, voiceover, inject, products — **but not `brollFrequency`, not `selectedAvatar`, not `targetDuration`.** And `hydrateFromJob` at :215 only assigns when truthy, so resuming any job (Recent Reels button at :813, or `?job=` via `resumeJobById` at :179-188) forces the chip to the row's value — which is `'Standard'` by default.

How other Studio fields handle the same problem:

| Field | Persistence path | Shares the problem? |
|---|---|---|
| `full_script` | Explicit `PATCH /api/jobs/[id]` via `persistScriptEdits` (`page.tsx:444-454`), called on the Next buttons at :1123 and :1133 **before** navigating | **No — this is the only field with a persist-on-navigate** |
| `targetDuration` | POST body of `/api/generate-english` (:404) → route persists `target_duration_sec` (`generate-english/route.ts:80`) | Same shape, but written by an earlier stage |
| `selectedAvatar` | POST body of `/api/generate-avatar` (:499) → route persists the **resolved** label (`generate-avatar/route.ts:135`) | Same shape |
| `editorInstructions` | POST body (:516) → `editor_notes` at `generate-broll-plan/route.ts:168` | **Identical shape and identical exposure** |

Second consumer of the persisted value: `src/app/admin/jobs/page.tsx:21` re-sends `brollFrequency: job.broll_frequency` on a stage retry — so a wrong persisted value is re-used, not re-asked.

Note: `'broll_frequency'` is already in `PATCHABLE_FIELDS` (`src/lib/jobs.ts:51`), so persisting on select needs no server allowlist change.

### 1c. Item 2 — duration discipline

**Where the target lives.** `jobs.target_duration_sec int` (`0001_init.sql:120`), typed at `src/lib/jobs.ts:20`, patchable at :47. **Written in exactly one place:** `src/app/api/generate-english/route.ts:80` (`target_duration_sec: durationNum`). The Studio never PATCHes it — `page.tsx:330` sets local state from `selectedPipeline.duration.defaultSec` and stops there. So on any reel whose plan omits the `script` stage (`client_script` preset, or inject-script), **`target_duration_sec` is NULL**.

**Where the word budget is computed.** `generate-english/route.ts:35-36`:
```
const durationNum = targetDuration ? parseInt(targetDuration) : 45;
const targetWordCount = Math.round(durationNum * c.speechWordsPerSec);
```
and the prompt block at :51-52.

**`speechWordsPerSec` config chain:** `clients.speech_words_per_sec numeric not null default 2.5` (`0001_init.sql:32`, comment: "duration -> word count heuristic (language-dependent)"), kept deliberately by `0004_drop_legacy.sql:13-14`; mapped `loadConfig.ts:27`; typed `types.ts:37`; admin-editable via `src/lib/admin.ts:7` and the field at `src/app/admin/clients/[id]/page.tsx:23`.

**adapt_voice.** `src/app/api/generate-hinglish/route.ts:35-44` is the entire prompt. It contains `c.voicePrompt`, the topic, and the base English script. **No duration, no word budget, no reference to `job.target_duration_sec`** — the `job` row is loaded (:25) only for the ownership/plan guards. Output is `extractJson` → `{fullScript, ...meta}` → `script_meta` (:54-58).

**What the Studio displays about length.** `src/components/ScriptDisplay.tsx:116-120`:
```
<span><strong>Words:</strong> {script.wordCount}</span>
<span><strong>Duration:</strong> {script.estimatedDuration}</span>
<span><strong>Template:</strong> {script.template}</span>
```
Where those values come from, by path:
- after adapt_voice — `page.tsx:425` sets `finalScript` to the **model's own JSON**. `wordCount`/`estimatedDuration` are model-reported, unverified.
- no adapt_voice — computed client-side at `page.tsx:427-433`: `wordCount` is a whitespace split; `estimatedDuration` is **the target echoed back** (`` `${targetDuration}s` ``), not an estimate.
- injected + no adapt_voice — `page.tsx:351-357`, same shape with the pipeline default.
- resumed job — `page.tsx:210`, spread from `script_meta`.

**The header is stale by construction:** `onScriptUpdate` at `page.tsx:1118` does `setFinalScript({ ...finalScript, fullScript: newText })`, so editing the textarea never touches `wordCount` or `estimatedDuration`.

**TTS markup and time.** `prepareScriptForTts` (`src/lib/pipeline/audio.ts:18-22`) strips `^[A-Z0-9\s]+:` headers and `\[.*?\]`. So **`[emotion]` markers are removed before TTS and cost no spoken time; `<break …/>` and `<emphasis>` are not stripped and do reach ElevenLabs.** Real spoken length is only knowable after the audio stage, via `alignmentToSentenceTimestamps` (`audio.ts:28-66`) → `jobs.audio_timestamps`; the existing reader is `lastTimestampEnd()` at `generate-broll-plan/route.ts:33-37` ("the narration's real length").

### 1d. Item 3 — per-reel toggles, end to end

**Studio state → POST → snapshot → read-back**, for the two existing toggles:

1. State: `voiceover` (`page.tsx:57`), `injectMode`/`injectedScript` (:58-59); UI at :675-706; reset in `openSetup` at :250-253. Derived flags `mustPasteScript`/`willInject` at :110-111.
2. POST: `page.tsx:312-322` → `{ clientId, pipelineId, voiceover, injectedScript, productImageUrls }`.
3. Route: `src/app/api/jobs/route.ts:14` destructures, :26-33 enforces the product-photo count against `getVisualAdapter(...).maxReferenceImages`, :36-42 calls `createJob` with `voiceover: voiceover !== false` (default ON).
4. Resolution + snapshot: `src/lib/jobs.ts:86-113` — `resolveReelStages(pipeline.enabled_stages, {voiceover, injectScript})` → `validate(stagePlan, {scriptSupplied: injectScript})` → insert `stage_plan` + `current_stage: stagePlan[0]`; injected script seeded at :107-111.
5. The toggle logic itself: `src/lib/pipeline/stages.ts:155-167` — voiceover=false drops `adapt_voice`/`audio`/`avatar`; injectScript drops `topic`/`script`.
6. Read-back: every stage route calls `stageNotInPlan(job, '<stage>')` (`jobs.ts:192-200`) which uses `getJobStagePlan` (`stages.ts:145-148`); routes that need to branch derive it from the plan, e.g. `generate-broll-plan/route.ts:63-65` (`noAudio`, `noAvatar`) and `assemble-video/route.ts:40-42`.

**Load-bearing finding for this item: neither existing per-reel toggle is stored as its own column.** Both are *encoded in `stage_plan`* — no route ever reads a "voiceover" boolean. A toggle that changes **prompt weighting rather than stage membership** therefore has no storage precedent among the toggles. The closest precedent for a per-reel, snapshot-at-creation, non-stage job column is `product_image_urls` (`0003_pipelines_uuid.sql:100`, `jobs.ts:28`, set in `createJob` at `jobs.ts:104`).

**`jobs` table columns** — `0001_init.sql:106-145`: `id, client_id, current_stage, stage_status, created_by, topic, template, target_duration_sec, english_script, full_script, script_meta, avatar_label, broll_frequency, editor_notes, speech_speed, audio_url, audio_timestamps, avatar_video_url, broll_plan, final_video_url, provider_job_ids, error, created_at, updated_at`; plus `0003_pipelines_uuid.sql:97-100`: `pipeline_id, stage_plan, product_image_urls`. All timestamps are `timestamptz` (:143-144). Mirror interface at `src/lib/jobs.ts:10-38`. Public write allowlist at :44-54.

**Where `productBlock()` is composed in** (the prose itself is `src/lib/pipeline/product.ts:24-31`):
- `src/app/api/generate-topic/route.ts:38` — `${c.researchDoc}${pastContentBlock}${productBlock(job)}` then the task. Photos attached at :79. **The instruction that currently outranks the product is at :46**: `CRITICAL STEP: For EACH topic, follow the topic-selection rules in the research document exactly (topic analysis, template decision tree, mixed-template check, hook & close extraction).` — that line lives in the route, not the KB.
- `src/app/api/generate-english/route.ts:38` — `${c.researchDoc}${productBlock(job)}`; photos at :69.
- `src/app/api/generate-broll-plan/route.ts:91` — `${c.creativeDirectorPrompt}${productBlock(job)}` as `systemInstruction`; photos at :156.

**Visibility predicates (two exist, and they are not the same):**
- `selectedPipeline.productInput` — from `client_pipelines.product_input` (`0003:79`) via `src/app/api/clients/[id]/ui-config/route.ts:32`; the Studio gates the upload UI on it at `page.tsx:723`.
- `hasProduct(job)` — `src/lib/pipeline/product.ts:15-17`, based on `product_image_urls.length > 0`, i.e. actual uploads. This is what the three prompt routes use.
A product pipeline with zero uploaded photos satisfies the first and not the second. Photos are uploaded **before** job creation (`page.tsx:265-300`, state at :60), so at toggle time the Studio knows both.

### 1e. Item 4 — the b-roll plan prompt vs the visual adapter

**Exact current wording**, `src/app/api/generate-broll-plan/route.ts:86-88`:
```
RULES:
- "features_product": true is ONLY valid on "media_type": "video". A generated still ("media_type": "image") CANNOT be conditioned on the photos and would invent a different product — use option 1 or 2 instead.
- Never set "features_product": true on a shot that does not actually show the product.
```
Surrounding context — option 1 (real photo still) at :79-80, option 2 (conditioned video, rationale correct) at :82, option 3 at :84.

**Why the rationale is false**, `src/lib/adapters/visual/veo_imagen.ts:99-110`:
```
if (!isImage)            { scriptFile = 'veo_generator.py';        model = models?.video        || … }
else if (refs.length > 0){ scriptFile = 'nanobanana_generator.py'; model = models?.productImage || … }
else                     { scriptFile = 'imagen_generator.py';     model = models?.image        || … }
```
and the docstring at :80-91 states the purpose outright: *"That last route exists because Imagen cannot be conditioned on an image, so it would invent a product. Rather than refuse the shot, hand it to a model that can actually see the photos."*

**The path is reachable in code, only forbidden by prompt:** `src/app/api/assemble-video/route.ts:93` (`isImage = b.media_type === 'image'`), :100 (`featuresProduct`), :108-110 pass **both** `mediaType:'image'` and `referenceImages`. Nothing rejects that combination.

**Every place the rule is stated or relied upon:**
1. `src/app/api/generate-broll-plan/route.ts:87` — the false claim.
2. `src/lib/adapters/visual/veo_imagen.ts:80-91, 104-106` — the truth.
3. `src/lib/adapters/visual/base.ts:18-22` — "a provider that cannot condition generation on an image must THROW".
4. `src/lib/imagen_generator.py` — refuses `--ref` permanently (exit 2); pinned by `tests/generators.test.mjs:45-52` and :113-116.
5. `src/lib/nanobanana_generator.py:1-14` (module docstring) and :143-150 (`requires at least one --ref`, exit 2).
6. `supabase/migrations/0005_visual_models.sql:12-16` — the same "Imagen cannot be conditioned … so it would invent one" rationale in the migration comment.
7. `CLAUDE.md` — "Do not let a missing/unusable reference image degrade into a text-only generation."
8. `supabase/seed-kb/kiran/creative_director_prompt.md:13-15` — **separately** steers the model toward `media_type: "image"` for static objects ("thermometer close-up, chart, medicine bottle") with no product awareness. This is the **seed**; the live doc is in the `client-kb` bucket and I cannot read it (§6).

### 1f. Item 5 — no duration guard in no-VO concat

- `src/lib/pipeline/coverage.ts:13,20-30` — the constant and the pure check.
- `src/lib/pipeline/assembly.ts:166-170` — the only call site, inside `if (opts.audioPath) { … }`. On a no-VO reel `audioPath` is undefined (`assemble-video/route.ts:146-152`), so **nothing runs**.
- What `concatBrolls` knows: its signature (`assembly.ts:132-136`) is `(clips: BrollPlacement[], opts: {audioPath?: string}, outputPath)`. `BrollPlacement` (`assembly.ts:8-13`) is `{localPath, start, end, isImage}`. **It never receives the job, the plan, or `target_duration_sec`.**
- **`target_duration_sec` never reaches assembly at all.** Grep across the repo finds it only in `jobs.ts`, `generate-english/route.ts`, `generate-broll-plan/route.ts:127`, `page.tsx`, and `admin/jobs/page.tsx`. `assemble-video/route.ts` does not read it.
- Its one influence today is prompt-only: `generate-broll-plan/route.ts:125-136` — `const targetN = narrationEnd ?? job.target_duration_sec ?? 45;` then "TOTAL DURATION: `${targetN}` seconds … tile the full 0..`${targetN}`s CONTIGUOUSLY … Leave NO gaps". Note the three-step fallback ending in a **hardcoded 45**.
- Variant 6 (`product_music` = topic, script, broll_plan, assemble — `stages.ts:132-136`) does run the `script` stage, so `target_duration_sec` **is** populated for it (`generate-english:80`). A no-VO reel on a pipeline without `script` would hit the 45 fallback.
- **Doc/behaviour mismatch worth knowing:** `coverage.ts:18` says *"the caller measures the real durations (ffprobe) and passes them in"*, but `assembly.ts:151-159` builds `durations` from the **plan** (`Math.max(0.5, (clip.end ?? 0) - (clip.start ?? 0))`). Only `narrationSec` is ffprobe'd (`assembly.ts:167` → `getDurationSeconds`, `ffmpeg.ts:48-59`).
- Related: `-t dur` at `assembly.ts:155,157` is a **trim**, not a stretch. `veo_generator.py` takes no duration argument, so a generated clip shorter than its planned slot contributes only its real length. *(Inferred consequence; actual Veo clip length is a vendor fact not verifiable from code.)*

### 1g. Item 6 — `downloadToFile`

`src/lib/pipeline/assembly.ts:16-29`:
```ts
const fileStream = fs.createWriteStream(destPath);
const reader = res.body.getReader();
while (true) { const {done, value} = await reader.read(); if (done) break; fileStream.write(value); }
fileStream.end();
await new Promise<void>((resolve) => fileStream.on('finish', () => resolve()));
```
No `'error'` listener; the promise has no `reject`; `fileStream.write()`'s backpressure return value is ignored.

**Every caller — 5 sites, 2 routes:**
1. `src/app/api/generate-avatar/route.ts:39` — the HeyGen presenter still, inside `buildPresenterComposite`. That function's `catch` (:63-70) downgrades to a plain talking head, but a hang never reaches the catch.
2. `src/app/api/generate-avatar/route.ts:45` — each product photo, same function.
3. `src/app/api/assemble-video/route.ts:76` — each product photo, sequential loop.
4. `src/app/api/assemble-video/route.ts:142` — the avatar base video (overlay mode).
5. `src/app/api/assemble-video/route.ts:149` — the voiceover mp3 (concat mode).

Neither route wraps the download in a timeout. `assemble-video` cleans `tempDir` in `finally` (:168-172); `buildPresenterComposite` in `finally` (:68-70). Render's ceiling is 100 minutes (STATUS.md:62).

### 1h. Item 7 — the two caps

- Upload cap: `src/app/api/uploads/route.ts:11` `const MAX_BYTES = 20 * 1024 * 1024;`, enforced :25 → `400 'File exceeds 20 MB'`. Also image-only at :24.
- Model cap: `src/lib/pipeline/product.ts:12` `const MAX_IMAGE_BYTES = 8 * 1024 * 1024;`, enforced :63-67 with an actionable message that names the actual MB.
- The mismatch is **already acknowledged in the comment** at `product.ts:9-11`.
- **When the 8 MB throw actually bites:** `fetchProductImages` is called at `generate-topic:79`, `generate-english:69`, `generate-broll-plan:156`. On a normal product reel that means the **topic stage** fails first, immediately after upload — not "later stages". On an inject-script reel (no topic/script) it first bites at `broll_plan`.
- **Studio surfacing:** `page.tsx:726-728` shows only the *count* (`{productUrls.length}/{client.productImageLimit}`). The input at :746 is `accept="image/*"` with no size hint. A rejected upload surfaces as `alert("Product photo upload failed: " + err.message)` at :296. **Neither byte limit is shown before upload; the 8 MB limit is never shown at all.**
- A **third** number in a **fourth** place: `product.ts:13` `MAX_IMAGES = 4` (slice at :42) vs `veo_imagen.ts:70` `MAX_REFERENCE_IMAGES = 3` vs `jobs/route.ts:26-33` which rejects more uploads than `maxReferenceImages` (3). `MAX_IMAGES = 4` is currently unreachable.
- Assembly downloads product photos with **no size check at all** (`assemble-video:73-78`) — the 8 MB rule is a model-payload rule only.

### 1i. Item 8 — presenter still extension

- `src/app/api/generate-avatar/route.ts:38` — `const presenterPath = path.join(tempDir, 'presenter.jpg');` then `downloadToFile(presenterUrl, presenterPath)` at :39.
- URL source: `src/lib/adapters/avatar/heygen.ts:43-54` → `body?.data?.preview_image_url`. Vendor-controlled; format not asserted anywhere.
- Consumer: `src/lib/nanobanana_generator.py:79-94`, specifically :91 —
  `mime = "image/png" if ext == ".png" else "image/webp" if ext == ".webp" else "image/jpeg"` — called for the persona at :164. So the presenter is always declared `image/jpeg`.
- **The correct pattern is three lines below, in the same function:** `generate-avatar/route.ts:43` — `const ext = path.extname(new URL(url).pathname).toLowerCase() || '.jpg';`
- Same line in `src/app/api/assemble-video/route.ts:74`.
- Why URL-derived works for product photos: Cloudinary returns `result.secure_url` (`src/lib/adapters/storage/cloudinary.ts:69`), preserving the uploaded extension.
- M12 precedent: `src/lib/veo_generator.py:39-58` (`MIME_BY_EXT` + `reference_mime_type`), pinned by `tests/generators.test.mjs:90-108`.
- Blast radius today: the composite path degrades gracefully (`generate-avatar:63-70` → `null` → plain talking head), so a MIME rejection costs the product-in-hand, not the reel.

---

## 2. Patterns to follow (quoted, with source)

**Route shape** — from `CLAUDE.md`, matched exactly by `generate-broll-plan/route.ts:39-61`: parse → `requireUser()` → `forbidClientMismatch` → `getJob` + `job.client_id !== clientId` → `stageNotInPlan` → `loadClientConfig` → `startStage` → work → `completeStage` / `failStage` in `catch` → temp dirs in `finally`.

**Guard inconsistency to be aware of (not a hole):** most stage routes inline the ownership check (`generate-english:26-27`, `generate-topic:26-27`, `generate-broll-plan:54-55`, `assemble-video:35-36`). Only `revise-script/route.ts:21-22` uses the `jobClientMismatch` helper. Item 3 touches `generate-topic`, so match its existing inline style or the helper deliberately.

**Server vs public writes** — `src/lib/jobs.ts:40-54`:
> "Fields the PUBLIC PATCH endpoint may write. Deliberately narrow: only things a user edits by hand in the Studio. Stage progression, artifact URLs, provider ids, stage_plan, pipeline binding are all SERVER-controlled and are written via updateJobInternal from the stage routes only. (Hardening N1.)"

**Per-reel snapshot** — `src/lib/jobs.ts:91-97`:
> "The pipeline was validated when it was saved, but the per-reel toggles above subtract stages from it — and a subset of a valid plan is not necessarily valid… Re-check what this reel will actually run, so a broken plan is refused at creation instead of dead-ending at the stage that can't run."

**Vendor-free logic in `src/lib/pipeline/*`** — `coverage.ts:1-11` is the model: extracted specifically "so the rule that prevents a truncated reel is independently unit-testable", exports one pure function returning `string | null` (message or OK), tested by `tests/coverage.test.ts`. Item 2's estimator and item 5's guard both belong in this shape.

**Adapter retry/exit-code contract** — `veo_imagen.ts:52-62` and `src/lib/generators/base.py:41-61`: exit 2 = permanent (no retry), exit 1 = transient; every failure through `fail()` to **stderr**.

**Config over code** — `0005_visual_models.sql:1-21` is the worked example of moving a hardcoded vendor value into a client column with an identical default.

**Vendor ids never reach the browser** — `src/app/api/clients/[id]/ui-config/route.ts:7-8, 23-26`: the browser gets `productImageLimit` (a count) and labels, never ids. Any new Studio-visible signal for item 3 belongs here.

**Prompt-block composition** — `src/lib/pipeline/product.ts:19-23`:
> "Prompt context appended to topic/script/b-roll prompts for product reels. Only ever paired with fetchProductImages() — the wording promises the model images, so the caller must actually attach them."

**Migration style** — `0005_visual_models.sql` and `0006`: banner comment stating *why*, what it replaces, and reversibility; additive `alter table … add column … not null default …`; timestamps always `timestamptz`.

**Warning surfaces that already exist** — `src/app/api/admin/clients/[id]/readiness/route.ts:30-31, 84` returns `{ready, errors, warnings}` (string arrays). That is the only structured warning channel in the codebase; everything in the Studio is `alert()`.

---

## 3. Similar features already built

- **Item 1** → `persistScriptEdits` (`page.tsx:444-454`) is the one existing "write the user's choice before navigating" precedent, and it uses the already-allowlisted PATCH endpoint. Also see `generate-avatar/route.ts:135`, which persists the *resolved* value server-side rather than trusting the client string.
- **Item 2** → `generate-english/route.ts:35-36, 51-52` is the exact prompt+budget construction to mirror. `lastTimestampEnd` (`generate-broll-plan/route.ts:33-37`) is the existing "how long is it really" helper. `checkNarrationCoverage` is the model for a pure, message-returning check.
- **Item 3** → the voiceover and inject-script toggles (`page.tsx:675-706` → `jobs/route.ts:36-42` → `jobs.ts:86-113` → `stages.ts:155-167` → `stageNotInPlan`). For **storage**, the closest precedent is `product_image_urls` (per-reel, set at creation, plain job column, `0003:100`). For **prompt-block composition**, `productBlock` itself.
- **Item 4** → the `productEntryDoc` block it lives in (`generate-broll-plan/route.ts:73-88`) and the frequency-guidance tables at :17-30, which are the pattern for prompt text that changes by mode.
- **Item 5** → `checkNarrationCoverage` + `tests/coverage.test.ts` is a direct template: same "extract the rule, call it from inside `concatBrolls` so it can't be bypassed" reasoning (STATUS.md:38, M1b).
- **Item 6** → `heygen.ts:118-181` shows the house style for bounded waiting with distinguishable failure reasons; `veo_generator.py`'s 15-minute poll ceiling (STATUS.md:40, M3) is the precedent for "unbounded wait is the bug".
- **Item 7** → `jobs/route.ts:26-33` is the precedent for enforcing a limit at the boundary *and* surfacing it to the Studio via `ui-config` (`productImageLimit`), with the reasoning at `page.tsx:267-271`.
- **Item 8** → M12: `veo_generator.py:39-58` + the pinned test at `generators.test.mjs:90-108`. Same class, same fix shape, one file over.

---

## 4. Risks (only those that genuinely apply)

**Multi-tenant isolation.** No item removes a guard, but two add surface:
- Item 3's new job column must be written by `createJob` (server) and **must not** be added to `PATCHABLE_FIELDS` unless post-creation editing is intended — `stage_plan` is deliberately absent from that list (`jobs.ts:40-54`). Making the toggle patchable would let the browser change prompt behaviour on someone else's completed job's re-run, subject only to `forbidClientMismatch`.
- Item 1's likeliest fix touches `PATCH /api/jobs/[id]`, which checks `forbidClientMismatch(auth, existing.client_id)` at `src/app/api/jobs/[id]/route.ts:33` — verified present.
- RLS has zero policies (`0001_init.sql:196-202` enables RLS; no `create policy` anywhere), so these application checks are the entire boundary.

**Retry logic / vendor spend.**
- Item 8 is the one with money attached. A wrong declared MIME on the nano banana call produces a model non-answer, which `nanobanana_generator.py:183-189` classifies **retryable** (`fail()` default `retryable=True`) → `veo_imagen.ts:55` burns all 3 attempts on a deterministic contract error. That is the M12 shape exactly (STATUS.md:77).
- Item 6: `downloadToFile` has no retry wrapper and its callers fail the whole stage; whatever it does on error, it must produce a *rejected promise*, because `runGenerator`'s retry logic (`veo_imagen.ts:18-46`) only covers generator subprocesses.
- Item 4 is prompt-only — no retry impact. But steering the model harder toward option 1 (the real uploaded photo) shifts work from a retryable generator call to a zero-generation still.

**Server-controlled fields.** `broll_frequency` is already public-patchable (`jobs.ts:51`); item 3's toggle would be the first per-reel *behaviour* flag on the row, and the existing behaviour flag (`stage_plan`) is server-only. Deciding which precedent it follows is a real decision, not a detail (listed in §6).

**Overlay vs concat.**
- Item 5 *is* this distinction. The concat guard must remain **inside** `concatBrolls`, per `CLAUDE.md` and STATUS.md:38.
- Cross-item interaction: item 4's steer toward the real uploaded photo increases `product_image` entries; `assembly.ts:154-155` pads stills with silence, which is STATUS.md:102 (R13, "product + music starts quiet", mean −43.5 dB). **Items 4 and 5 pull in opposite directions on a no-VO reel.**
- Item 5's guard must not fire in overlay mode: `overlayBrolls` (`assembly.ts:35-106`) tolerates gaps by design, and keying a duration rule off the wrong axis was M1 (STATUS.md:37 — "the axis is `noAvatar`").

**Config over code.** Item 2's word budget correctly derives from `c.speechWordsPerSec` (a DB column). Any new "TTS markup adds N seconds" factor would be a **new hardcoded tuning constant**. Precedent exists (`MIN_NARRATION_COVERAGE`, `DUCK_UNDER_VOICEOVER` — both hardcoded with a justifying comment), but it is a choice the PM should make rather than inherit.

**Timezone and date math.** Checked — **does not apply**. None of the 8 items compares, ages, or displays a timestamp. The only caveat: `0007` must keep any new timestamp column `timestamptz`, matching `0001_init.sql:143-144`.

**Vendor ids to the browser.** Does not apply — item 3's toggle is a boolean and item 1's is a human label.

**Two documentation-vs-behaviour drifts that will mislead a builder:**
- `coverage.ts:18` claims ffprobe'd durations are passed in; `assembly.ts:151-159` passes planned ones.
- `product.ts:5-7` still says "the avatar/assembly stages consume them too (HeyGen background / B-roll image placements)" — the HeyGen `background` hack was removed for Route B (STATUS.md:138).

---

## 5. Tests that will need updating

The suite is 3 files, listed **explicitly** in `package.json:10`:
```
"test": "node --experimental-strip-types --test tests/coverage.test.ts tests/stages.test.ts tests/generators.test.mjs"
```
**There is no glob.** Any new test file not appended to that line never runs. `tsconfig.json:33` excludes `tests`, so `.ts` imports need explicit extensions. Both existing `.ts` tests import only from `src/lib/pipeline/*` — nothing imports a route, which would drag in `next/server` and `@supabase/supabase-js`.

| Item | File | Specific cases |
|---|---|---|
| 5 | `tests/coverage.test.ts` | Extend, and re-check the existing 7 — if the guard's signature or module changes, all of `MIN_NARRATION_COVERAGE is 0.95` (:9), `the exact variant-5 bug shape` (:13), the 0.95 boundary pair (:23, :28), over-coverage (:32) and single-clip (:36) must still pass unchanged. New cases: no-VO gapped plan refused; no-VO contiguous plan accepted; guard must **not** fire in overlay mode; behaviour when ordered duration is unknown (NULL `target_duration_sec`). |
| 3 | `tests/stages.test.ts` | Only if `resolveReelStages` is touched — and it **should not be**, since this toggle removes no stage. If it is, `voiceover=false drops adapt_voice, audio and avatar` (:68) and `injectScript=true drops topic and script` (:74) are the pins. A precedence-clause builder / `productBlock` variant is pure and belongs in a **new** `tests/product.test.ts` — **must be added to `package.json:10`**. |
| 8 | `tests/generators.test.mjs` | Template is `Veo reference images resolve an explicit MIME type per extension (webp included)` (:90-108), which imports `reference_mime_type` from `veo_generator.py`. **`nanobanana_generator.py` has no equivalent importable helper** — the mapping is an inline ternary at :91, so it cannot be pinned in that style as written. |
| 2 | new file | A duration/word-budget estimator is pure; new `tests/*.test.ts` + **`package.json:10` edit**. Cases: `<break time="…"/>` counted as time not words; `[emotion]` stripped (matching `prepareScriptForTts`, `audio.ts:18-22`) so it costs nothing; a 20 s target vs a 65 s script producing a warning; a NULL target producing no warning rather than a false one. |
| 1 | none exist | No test covers Studio state, and none can under the current setup (no DOM/React harness, dependency-free by rule). If frequency selection moves behind a pure helper, it becomes testable; otherwise this item is verification-by-run only. |
| 4 | none exist | No test asserts prompt text. A wording change is invisible to `npm test`, `tsc` and `next build` — exactly the "built ≠ works" trap in `CLAUDE.md`. |
| 6 | none exist | `downloadToFile` is exported from `assembly.ts`, which imports `fluent-ffmpeg`/`ffmpeg-static` at module load (`assembly.ts:2` → `ffmpeg.ts:1-3`) — worth knowing before assuming it can be imported into a dependency-free test. |
| 7 | none exist | Both caps are module constants; `uploads/route.ts` imports the storage adapter, but `product.ts` is clean and importable. `product.ts` is the testable half. |

STATUS.md:11 records the current baseline as **32/32**; the same count is in `CLAUDE.md`.

---

## 6. Open questions

**Item 1**
1. Was the `"Standard"` value read from the job row **before or after** the `broll_plan` stage completed on the variant-3 run? The column default is `'Standard'` (`0001_init.sql:127`), so a pre-completion or post-failure read explains the symptom with no React race. The job's `job_events` rows would settle it. Which mechanism it was determines whether the fix is "persist on select" or "don't read the row early".
2. Did the operator navigate away and back (Recent Reels / `?job=`) between clicking Minimal and starting the pipeline? `hydrateFromJob:215` would have re-applied the row's `'Standard'`.

**Item 2**
3. The **live** `voice_prompt.md` in the `client-kb` bucket defines the adapt_voice JSON output contract (including whether `wordCount`/`estimatedDuration` are required fields). Only the seed at `supabase/seed-kb/kiran/voice_prompt.md` is readable. Does it already carry length guidance that a route-level budget would contradict or duplicate?
4. Does the live voice prompt actually emit `<break>` / `<emphasis>`, and how much time does each add? Vendor/prompt fact, not a code fact.
5. `speech_words_per_sec` is a single per-client number (default 2.5). Was it calibrated on **English** output (what `generate-english` uses it for) or on the **adapted** output (which may be Hinglish/Devanagari)? Applying the same rate to both assumes they match.
6. Should the soft warning compare against `target_duration_sec` (NULL on `client_script`/inject-script reels) or against the pipeline's `duration_default_sec`? The Studio has the latter locally (`page.tsx:330`) but never persists it.

**Item 3**
7. What do the live research doc's topic-selection rules actually say? The precedence clause has to name what it overrides; only the seed is readable.
8. Should the toggle affect **only** `generate-topic` (where the symptom was observed) or also `generate-english` and `generate-broll-plan`? `productBlock` is composed into all three.
9. Visibility predicate: `selectedPipeline.productInput` (pipeline configured for products) or `productUrls.length > 0` (photos actually attached)? They differ, and the three prompt routes use the second.
10. Should the toggle be editable after job creation (add to `PATCHABLE_FIELDS`, like `broll_frequency`) or creation-only (server-set, like `stage_plan`)?
11. Default value for the new column — off (today's behaviour) for all reels, or off only for non-product reels?

**Item 4**
12. Does the **live** `creative_director_prompt.md` already contain product or `media_type` rules that would interact with the reworded clause? The seed at :13-15 steers static objects to `media_type: "image"` with no product awareness.
13. Where should the "left flagged for later review" marker live so it is not lost — an in-code comment, a new STATUS §3 residual-risk row (the existing R-list format at STATUS.md:99-109), or both?

**Item 5**
14. What is the "ordered duration" for a no-VO reel when `target_duration_sec` is NULL? Today `generate-broll-plan:127` silently falls back to a hardcoded 45.
15. Should the guard measure **planned** slot durations (what the existing coverage guard actually does) or **ffprobe'd delivered** durations (what `coverage.ts:18` claims it does)? These diverge whenever a generated clip is shorter than its slot, and the answer decides whether the guard can stay pure.
16. Refuse or warn? The existing coverage guard **throws** and fails the stage. A no-VO reel that is 12 s instead of 15 s is degraded, not broken — is a hard refusal the intended severity?

**Item 6**
17. In this Node/Next runtime, does an unhandled `'error'` on `fs.createWriteStream` hang the awaited promise or surface as an uncaught exception? The code fact (no listener, resolve-only on `'finish'`) is verified; the runtime outcome is not, and it changes severity from "hangs 100 min" to "crashes the request".

**Item 7**
18. Is 8 MB a real Gemini inline-image constraint or purely self-imposed? `product.ts:9-11` calls it "belt-and-braces", implying self-imposed, but the actual vendor limit is nowhere in the code — and it decides whether the fix is to lower the upload cap or raise the model cap.
19. `MAX_IMAGES = 4` (`product.ts:13`) vs `maxReferenceImages = 3` — intentional headroom for a future provider, or drift?

**Item 8**
20. What content types does HeyGen's `preview_image_url` actually serve, and does the URL carry an extension at all? `path.extname(new URL(url).pathname)` returns `''` for an extensionless path, which the `|| '.jpg'` fallback at `generate-avatar:43` would turn back into a guess.

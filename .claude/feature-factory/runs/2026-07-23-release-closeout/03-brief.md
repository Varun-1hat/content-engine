# TECHNICAL BRIEF - Kiran Reels v5 release close-out

**STATUS: APPROVED by the user at GATE 2 on 2026-07-23.** Build from this brief.

## GATE 2 AMENDMENTS — these OVERRIDE the body of this brief where they conflict

1. **Duration tolerance is ±5 SECONDS, BOTH DIRECTIONS — not "+5 s overshoot".**
   The user refined this at the gate. The Studio flags whenever the estimated spoken duration deviates from target by more than 5 s in **either** direction: a 20 s target returning **12 s** is flagged exactly as one returning 27 s is.
   - The pure helper is a two-sided **deviation** check, not an overshoot check. Name it for what it does (e.g. `checkDurationDeviation`), and give it unit cases on **both** sides of target: at −5.0 s (no flag), −5.1 s (flag), +5.0 s (no flag), +5.1 s (flag).
   - The flag stays **informational and non-blocking**. Every re-run is approved manually by the user, who takes the call to accept or regenerate. Nothing is auto-regenerated and nothing is ever disabled.
   - Wherever this brief says "over target + 5 s", "overshoot", or `checkDurationOvershoot`, read it as the two-sided deviation rule above. Criterion 8's negative case (a 45-word script on a 20 s target ≈ 18 s) still produces **no** flag, because 2 s of deviation is inside tolerance.

2. **PM open question 2 (criterion 7's proof standard) is CLOSED.** There is no "three runs, all within tolerance" bar. Criterion 7 is proven when the flag fires correctly outside ±5 s and stays silent inside it; the decision to re-run is the user's, per run.

3. **PM open question 1 (the 12 MB figure) is CONFIRMED** at 12 MB raw, with the ×4/3 base64 derivation recorded in a comment on the adapter constant.

4. **PM open question 3 is CLOSED as written in the brief:** the reworded rule stays a hard rule, so criterion 21 holds by construction. Allowing reference-conditioned stills remains the deferred design question flagged in R15.

5. **All five of the PM's judgement calls in §7 are APPROVED** as written (frequency picker in both places; presenter-URL fallback chain ending in a throw; no warning on over-coverage; `generate-broll-plan` failing rather than inventing 45 s; 12 MB).

6. **Migration `0007` will be applied by the orchestrator** via the connected Supabase MCP tool once the backend-engineer has written the file. The backend-engineer still only writes the file and must not attempt to apply it.

I have verified every load-bearing claim in the research doc against the source. Here is the brief.

---

# TECHNICAL BRIEF — Kiran Reels v5 release close-out

**Source of truth:** `.claude/feature-factory/runs/2026-07-23-release-closeout/02-story.md` (§5 DECISIONS are settled). Build from this brief; where this brief and the story disagree, the story wins and you stop and ask.

---

## 1. Summary

Eight work items make a reel come out matching what was ordered, and make it say so loudly when it won't: B-roll frequency is captured at reel creation instead of at `broll_plan` completion; `adapt_voice` finally receives the target duration and a word budget, with a live non-blocking Studio overshoot warning computed from the edited script; a per-reel "product overrides the research doc" toggle is snapshotted onto the job and applied as a precedence clause to the topic stage only; a false rationale in the B-roll prompt is reworded and the underlying design question is flagged in two places; no-voiceover concat reels warn when the plan under-tiles the ordered duration; a failed file write rejects instead of crashing the process; the two photo-size limits become one total-payload limit stated before upload; and the presenter still declares its real format instead of always claiming JPEG.

Together these satisfy criteria 1–47. Criteria 10 (second half), 32 (full-reel regression), 33 (past the render boundary) and 40 are **NOT PROVABLE this round** by decision 15 (budget) and must be recorded as unverified, never as passing.

---

## 2. Data model changes

### Migration `supabase/migrations/0007_product_override_research.sql` — **MIGRATION, gate item**

One column, additive, forward-only:

| Column | Table | Type | Nullable | Default | Constraint |
|---|---|---|---|---|---|
| `product_overrides_research` | `jobs` | `boolean` | **not null** | `false` | none |

`false` is today's behaviour, so every existing row and every reel created before the toggle is used behaves byte-for-byte as it does now (criterion 14, 18; story §6 assumption "defaults to off").

Migration file style follows `0005_visual_models.sql`: banner comment stating *why*, what it replaces, and that `alter table jobs drop column product_overrides_research` reverses it.

**No CLI.** The builder writes the file only. **Applying `0007` to the live project (`oyxpwfpbfqcfbuklnsjq`) is the USER's trigger to pull**, via the Supabase SQL editor or the Supabase MCP `apply_migration`. No builder applies it. Until it is applied, `createJob` will fail on insert — so the order of operations at the gate is: approve → apply `0007` → run the Studio.

### Explicitly NOT changed

- **`jobs.broll_frequency`** keeps its type and its `default 'Standard'`. Migrations are additive; nothing already shipped gets reshaped. The defect is closed by always writing the value at creation, not by changing the default.
- **`jobs.target_duration_sec`** unchanged (still `int`, still nullable, still written only by `generate-english`).
- No new timestamp, date, or interval column anywhere. **Timezone semantics: not applicable to this change** — no item compares, ages, or renders a timestamp. The only rule that applies is the negative one: had a timestamp column been needed it would be `timestamptz`, matching `0001_init.sql:143-144`.
- RLS stays on with **zero policies**. No policy is proposed. Every read/write remains server-side via `supabaseAdmin()`.

### `PATCHABLE_FIELDS` — deliberate decision, **NO widening**

`product_overrides_research` is **NOT** added to `PATCHABLE_FIELDS` in `src/lib/jobs.ts:44-54`.

Reasoning, stated for the gate: it is a per-reel **behaviour** flag, and the existing behaviour flag (`stage_plan`) is deliberately absent from that allowlist. Adding it would let any authenticated user of the owning client flip prompt behaviour on an already-created reel and then trigger an admin retry against different weighting than the reel was ordered under — which criterion 44 ("No item lets the browser change a reel's *behaviour* after creation beyond what is permitted today") forbids outright. The flag is written once, by `createJob`, server-side, and every consumer reads it from the row. It is never accepted in a stage route's request body.

`broll_frequency` is already in `PATCHABLE_FIELDS` (`src/lib/jobs.ts:51`) and stays there. Item 1 uses the existing allowlist entry — **this is not a widening**, and no new field is added to that set by any of the eight items.

---

## 3. Process flow

### Item 1 — B-roll frequency survives (criteria 1–5)

1. **Studio → New Reel (setup screen, `src/app/page.tsx`, `setupMode` branch).** The user picks the pipeline and, when that pipeline's stage plan contains `broll_plan`, a B-roll frequency (Minimal / Standard / High). `openSetup()` resets it to `"Standard"` along with avatar and target duration (decision 3).
2. **`POST /api/jobs`** carries `brollFrequency` alongside `voiceover`, `injectedScript`, `productImageUrls`.
3. **`createJob` (`src/lib/jobs.ts`)** normalises the label against the server-side allowlist and writes `broll_frequency` into the insert. **The row reads the user's choice from the instant it exists** — this is the whole fix for criterion 1, and it closes both candidate mechanisms per decision 1.
4. **Studio → Architect (step 3).** The frequency chips stay where they are today (`page.tsx:1202-1217`). They remain editable — a production choice tuned after reading the script. `proceedFromArchitect` PATCHes `broll_frequency` to `/api/jobs/[id]` **before** kicking off audio or the video pipeline, mirroring `persistScriptEdits` (`page.tsx:444-454`, called on the Next buttons at :1123/:1133) — the one existing persist-on-navigate precedent in this codebase.
5. **`POST /api/generate-broll-plan`** continues to accept `brollFrequency` in the body and continues to persist it in `completeStage`. Unchanged.
6. **Retry / resume.** `src/app/admin/jobs/page.tsx:21` re-sends `job.broll_frequency` — now always the user's selection (criteria 2, 4). `hydrateFromJob` restores it (criterion 3). **`src/app/admin/jobs/page.tsx` does not change.**

Stage: `broll_plan`. Applies to overlay and concat alike (the frequency *table* already branches on `noAvatar` at `generate-broll-plan/route.ts:110` — untouched).

### Item 2 — duration discipline on `adapt_voice` (criteria 6–12)

**Server half.** Studio → Script step calls `POST /api/generate-hinglish` (stage `adapt_voice`). The route already loads the job at :25 for guards; it now also resolves the ordered duration via `resolveOrderedDurationSec(job, c.pipelines)` and, when that is a number, appends a duration block to the prompt stating the target seconds, the client's configured words-per-second (`c.speechWordsPerSec`, `clients.speech_words_per_sec` — decision 6, no new column), and the resulting word budget from `wordBudgetFor()`. When it resolves to `null`, **the block is omitted entirely** — no invented target (criterion 12). Per decision 7 the block is a *constraint*, consistent with the live `voice_prompt.md`; it must not restate or contradict the KB's output contract.

**Studio half.** `ScriptDisplay` computes the estimate from its own live `editValue`, not from the model's self-report (decision 7), so a hand-trim updates it without leaving the page (criterion 9). Over target + 5 s (decision 4) it shows a visible, **non-blocking** flag (criterion 10 — nothing is ever disabled). With no recorded target the comparison basis is the pipeline default (decision 5) and is labelled as such.

Stages: `adapt_voice` (server), pre-`audio` (Studio). Overlay/concat irrelevant.

### Item 3 — per-reel product-override toggle (criteria 13–19)

1. **Studio setup screen.** The toggle renders **only when `productUrls.length > 0`** (decision 8) — it appears as the first photo lands and disappears if all are removed. It sits with the voiceover and inject-script toggles (`page.tsx:675-706`), defaults OFF.
2. **`POST /api/jobs`** carries `productOverridesResearch`. `createJob` writes `true` only when the flag is set **and** the reel actually has photos; otherwise `false`. That closes story edge case 4 without a 400.
3. **`POST /api/generate-topic`** (stage `topic`) reads `job.product_overrides_research` **from the row, never from the body**, and composes `productPrecedenceBlock(job)` into the prompt after `productBlock(job)`. `c.researchDoc` stays. The `CRITICAL STEP` line at `generate-topic/route.ts:46` stays. The clause states precedence for **topic selection**; template decision tree, hook and close remain governed by the research doc (criterion 15 — "precedence clause, never suppression").
4. **Nothing else reads the flag.** `generate-english` and `generate-broll-plan` are untouched by it (decision 9).
5. **Retry / resume** work for free because the value lives on the row (criterion 17).

`resolveReelStages` and `stages.ts` are **not touched** — this changes prompt weighting, not stage membership (criterion 19).

Note for the builder: `generate-topic/route.ts` is the one stage-named route that does **not** call `startStage`/`completeStage`/`failStage` — it is a suggestion generator, not a stage transition. That is existing, deliberate behaviour. **Do not "fix" it**; it is out of scope.

### Item 4 — reword the B-roll plan rationale (criteria 20–23)

Wording only, inside `generate-broll-plan/route.ts:86-88` (stage `broll_plan`, both modes). The false claim ("A generated still … CANNOT be conditioned on the photos") goes; the operative rule (`"features_product": true` is only valid on `"media_type": "video"`) **stays, in force**, so the model's output distribution does not move (criterion 21 — a measurable shift is a failure). The replacement reason is true: for a still that must show the real product, use option 1, the uploaded photo itself. A code comment at the block records that "which route a product still should take" is deliberately deferred, and a matching residual-risk row goes into `STATUS.md` §3 as **R15** (decision 10 — both places).

No generation path changes: `veo_imagen.ts` routing, `imagen_generator.py`'s permanent refusal of `--ref`, and `assemble-video`'s pass-through of `mediaType:'image'` + `referenceImages` are all untouched (criterion 23).

### Item 5 — duration guard for no-voiceover concat reels (criteria 24–28)

**Concat territory only. This is the M1 axis — key it on `noAvatar`, never on `noAudio`.**

1. `POST /api/assemble-video` (stage `assemble`) already branches at :139 on `overlayMode = plan.includes('avatar')`.
2. In the **else** (concat) branch only, the route resolves `orderedDurationSec = resolveOrderedDurationSec(job, c.pipelines)` and passes it into `concatBrolls` as a new option. `overlayBrolls` receives nothing new and gains no guard (criterion 26).
3. Inside `concatBrolls` — where it cannot be bypassed, per M1b — after the planned `durations[]` are built (`assembly.ts:150-159`), `checkOrderedDurationCoverage(durations, orderedDurationSec)` runs. It **returns a warning string, it does not throw** (decision 11). `null` in → `null` out (criterion 28: the guard never invents an ordered duration).
4. The existing `checkNarrationCoverage` call at `assembly.ts:166-170` is **completely unchanged** — same threshold, same message, still throws (criterion 27).
5. `concatBrolls` returns `{ warnings: string[] }`; `assemble-video` returns them in its JSON response; the Studio shows them on the Final screen as an amber note. The reel still ships (decision 11).

The guard measures **planned slot durations** — what `concatBrolls` already computes. That is also what the stale comment at `coverage.ts:18` misdescribes, and decision 17 has that comment corrected in the same change.

### Item 6 — a failed file write fails the stage (criteria 29–33)

`downloadToFile` moves to its own module and gains an `'error'` listener that **rejects**. Empirically settled (decision 13): today an unwritable destination emits an unhandled `'error'` → uncaught exception → **process exit**, taking every in-flight reel with it. Five call sites, two routes: `generate-avatar` (presenter still, product photos) and `assemble-video` (product photos, avatar base video, voiceover mp3). On rejection the partial file is deleted before the error propagates (criterion 31), and the failure reaches the user through the existing `failStage` path with the write error as its reason (criterion 30). `buildPresenterComposite`'s catch still downgrades to a plain talking head (criterion 33) — it now actually reaches that catch.

### Item 7 — one photo-size limit, stated before upload (criteria 34–37)

Today: 20 MB per file at `/api/uploads:11`, 8 MB per image at `product.ts:12`. Decision 14 settles that 8 MB is self-imposed **and measures the wrong axis** — Gemini's real ceiling is 20 MB for the **total request**. Decision 18: the number comes from the model/adapter.

New shape — **one limit, a per-reel total of raw photo bytes**:
- The number lives on the **script adapter** (`ScriptAdapter.maxInlineImagePayloadBytes`), because the script model is what receives the inline images. Same pattern as `VisualAdapter.maxReferenceImages`.
- **Studio** reads it from `ui-config` and states it *before* the file picker (criterion 35), and pre-checks the running total across already-selected photos before uploading anything.
- **`/api/uploads`** enforces the same number as its per-file ceiling (a single photo could be the reel's only photo), replacing the hardcoded 20 MB.
- **`fetchProductImages`** enforces it as a **total** across the reel's photos, with the number passed in by the route from the adapter. The 8 MB per-image cap is deleted.

All three surfaces state and enforce the same number in the same units (raw MB, what a user sees on their own files) — criteria 34 and 36. The photo **count** limit is untouched: still `getVisualAdapter(...).maxReferenceImages`, still shown as `n/limit` and still enforced at `POST /api/jobs` (criterion 37).

### Item 8 — the presenter still declares its real format (criteria 38–40)

`generate-avatar/route.ts:38` hardcodes `presenter.jpg`. Decision 16: HeyGen serves `.webp` for 3 of Kiran's 4 avatars, so on 3 of 4 a webp reaches `nanobanana_generator.py:91` declared `image/jpeg` — M12's exact shape, surviving only because Gemini is more lenient than Veo.

Flow: presenter URL → `extensionFromUrl()` (the pattern already three lines below at :43) → if that yields nothing usable, fall back to the `Content-Type` of the same download → if that is also unusable, throw, which the existing catch turns into the graceful talking-head downgrade rather than a confidently wrong declaration (criterion 39). The file is then named with its real extension, and `nanobanana_generator.py` resolves the MIME from that extension via the shared, importable `reference_mime_type` (criterion 38).

Plus decision 19: `nanobanana_generator.py` wraps its SDK call the way `veo_generator.py` was wrapped in M12b — an API-level 4xx (except 429) surfaces the vendor's reason and exits **2** (no retries). **Content refusals ("model returned no image") stay retryable** — that is an evidence-based decision recorded in STATUS.md and CLAUDE.md and it does not change.

---

## 4. API changes

Every stage route below keeps the house shape verbatim: parse → `requireUser()` → `forbidClientMismatch` → `getJob` + inline `job.client_id !== clientId` ownership check → `stageNotInPlan` → `loadClientConfig` → `startStage` → work → `completeStage` / `failStage` in `catch` → temp cleanup in `finally`. **No guard is removed, reordered, or replaced anywhere.** Routes that inline the ownership check keep inlining it (`generate-topic:26-27`, `generate-english:26-27`, `generate-broll-plan:54-55`, `generate-avatar:92-93`, `assemble-video:35-36`) — do not swap them to the `jobClientMismatch` helper, that is an unrelated refactor. RLS has zero policies, so these application checks are the entire tenancy boundary (criterion 43).

### `POST /api/jobs` — MODIFIED

**Request (added fields, both optional):**
```
{ clientId, pipelineId, voiceover?, injectedScript?, productImageUrls?,
  brollFrequency?: string,              // NEW — "Minimal" | "Standard" | "High"
  productOverridesResearch?: boolean }  // NEW — default false
```
**Response:** unchanged — `201 { job }` (the job now carries `broll_frequency` = the choice, and `product_overrides_research`).

**Server rules:**
- `brollFrequency` is normalised against the server-side allowlist; anything unrecognised or absent becomes the default `"Standard"`. It is **not** a 400 — an unknown label is a UI drift, not an attack, and the existing route already tolerates one (`generate-broll-plan:111`).
- `productOverridesResearch` is coerced to `true` only when it is `true` **and** `productImageUrls.length > 0`; otherwise `false`.

**Errors (all unchanged):** `400` missing `clientId` / `pipelineId`; `400` product photo count over `maxReferenceImages`; `400` `PIPELINE_INVALID` / `PLAN_INVALID`; `401` unauthenticated; `403` client mismatch; `404` unknown/inactive client; `500` otherwise.

**Guards:** `requireUser()` then `forbidClientMismatch(auth, clientId)`. No job-ownership check applies — the job does not exist yet; the pipeline's ownership is verified inside `createJob` (`jobs.ts:82`).

### `PATCH /api/jobs/[id]` — UNCHANGED (route file untouched)

Used by item 1 with `{ broll_frequency }`. `broll_frequency` is already allowlisted; `forbidClientMismatch(auth, existing.client_id)` at :33 is already the ownership check. **No code change to this route and no change to `PATCHABLE_FIELDS`.**

### `POST /api/generate-hinglish` — MODIFIED (prompt only)

Request and response shapes **unchanged**: `{ clientId, jobId, englishScript, topic? }` → `{ success: true, script }`. Errors unchanged (`400` missing clientId/jobId/englishScript, `401`, `403`, `409` off-plan, `500`). The only change is the prompt body and the fact that `job.target_duration_sec` and `c.pipelines` are now read. Guards unchanged.

### `POST /api/generate-topic` — MODIFIED (prompt only)

Request `{ clientId, jobId, query? }` and response `{ success: true, topics }` **unchanged**. The override flag is read from the job row and is **never** accepted from the body. Errors unchanged. Guards unchanged (`requireUser` → `forbidClientMismatch` → ownership → `stageNotInPlan('topic')`).

### `POST /api/generate-broll-plan` — MODIFIED (prompt only)

Request and response **unchanged**. Two internal changes: the reworded rules block, and `targetN` now resolves through `resolveOrderedDurationSec` instead of `?? 45`.

**New error condition:** in concat mode (`noAvatar`), when there is neither a narration end nor a resolvable ordered duration, the stage **fails** with a named reason (`500`, recorded by `failStage`) rather than tiling against an invented 45 seconds. Decision 12 forbids the hardcoded literal, and `client_pipelines.duration_default_sec` is `not null`, so this can only fire on a reel whose `pipeline_id` has been orphaned. Flagged in §7 as a deliberate behaviour change.

### `POST /api/assemble-video` — MODIFIED

Request **unchanged**. **Response gains one field:**
```
{ success: true, finalVideoUrl, failedClips, warnings: string[] }   // warnings NEW
```
`warnings` is `[]` on a clean run. Populated only in concat mode, only from `checkOrderedDurationCoverage`. It never changes the status code — the reel shipped (decision 11). Errors unchanged. Warnings are **per-run and not persisted**; a resumed reel will not re-show them. Accepted, stated in §7.

### `POST /api/uploads` — MODIFIED

Request `multipart/form-data { file, clientId }` unchanged. Response `{ url }` unchanged.

**Errors:** `400 'clientId is required'`, `400 'file is required'`, `400 'Only image files are allowed'`, `401`, `403`, `404 'Client not found'`, `500` — all unchanged except the size rejection, whose **message now names the adapter-derived limit** instead of the literal "File exceeds 20 MB".

Implementation note: the route deliberately does **not** call `loadClientConfig` (which requires `active = true` and would change behaviour for an inactive client — story edge case 15). Add `script_provider` to the existing `.select()` at :29 and read the number off `getScriptAdapter(...)`.

### `GET /api/clients/[id]/ui-config` — MODIFIED

**Response gains two top-level fields.** This is the exact contract the frontend consumes:
```
{ …existing…,
  speechWordsPerSec: number,            // NEW — clients.speech_words_per_sec, for the Studio's estimate
  productImagePayloadLimitMb: number }  // NEW — whole MB, from the script adapter
```
Both are plain numbers. **No vendor id, model name, or provider slug is added** — the house rule holds: labels and counts out, ids never.

`productImagePayloadLimitMb` is derived server-side as `Math.floor(getScriptAdapter(c.script.provider).maxInlineImagePayloadBytes / 1024 / 1024)` so the number the Studio prints is exactly the number enforced (criterion 36).

Guards unchanged: `requireUser()` → `forbidClientMismatch(auth, id)`.

### `GET /api/jobs/[id]`, `GET /api/jobs` — UNCHANGED

Both already return the full row, so `product_overrides_research` reaches the browser with no code change. It is a boolean, not a vendor id.

---

## 5. Frontend changes

Frontend owns exactly two files: `src/app/page.tsx` (the Studio) and `src/components/ScriptDisplay.tsx`. **Nothing under `src/app/api/**` or `src/lib/**` is a frontend change**, and `src/app/admin/jobs/page.tsx` does not change at all.

All Studio behaviour stays derived from the job's `stage_plan` via the existing `hasStage()` / `pipelineHasStage()` helpers. No new hardcoded stage order, no `if (client.slug === …)` anywhere (criterion 45).

### `src/app/page.tsx`

**New/changed state**
- `productOverridesResearch: boolean` — new `useState(false)`, setup-screen only.
- `brollFrequency` — existing (`:82`); now also reset by `openSetup()` to `"Standard"` (decision 3), alongside two additions to the same reset: `selectedAvatar` back to `client.avatars[0]?.label ?? ""` and `targetDuration` back to the selected pipeline's `duration.defaultSec` (decision 3 names all three).
- `assembleWarnings: string[]` — new, set from the assemble response, cleared at the start of `handleAssembleFinalVideo`.

**Setup screen (`setupMode` branch, ~:659-762)**
1. **B-roll frequency picker** — new block, rendered only when `pipelineHasStage(selectedPipeline, "broll_plan")`. Reuses the existing `BROLL_OPTIONS` labels (`:37`) and the existing chip styling from the Architect screen. Sends the label; the server resolves it. Placed after the voiceover/inject toggles, before product photos.
2. **Product-override toggle** — new block, rendered only when `productUrls.length > 0` (decision 8), styled identically to the voiceover/inject toggles at :675-706. Label wording must make the precedence explicit, e.g. *"Make this reel about the uploaded product — the product takes priority over the research doc's usual topics. Templates, hooks and closes are unchanged."* Default OFF.
3. **Product photo block (~:723-751)** — the size limit is stated **before the file picker**, in the existing helper paragraph at :728, using `client.productImagePayloadLimitMb` (criterion 35). `handleProductFiles` gains a pre-upload total-bytes check across the already-selected `File`s plus the running total, and refuses with the same number in the message. The existing count check and its `alert()` behaviour at :271-280 stay exactly as they are (criterion 37).
4. `handleStartReel` sends `brollFrequency` and `productOverridesResearch` in the `POST /api/jobs` body.

**Architect screen (step 3, ~:1202-1229)** — the frequency chips stay and stay editable. `proceedFromArchitect` (`:484-487`) awaits a `PATCH /api/jobs/[id]` with `{ broll_frequency: brollFrequency }` **before** dispatching to audio or the pipeline, mirroring `persistScriptEdits`. Loading: the existing Continue button's `disabled` covers it. Error: swallow like `persistScriptEdits` and proceed — the value still travels in the `generate-broll-plan` body, so a failed PATCH degrades to today's behaviour and never blocks the reel.

**Script screen (step 2)** — passes the new props to `ScriptDisplay` (below).

**Audio/blueprint screen (step 4, ~:1265-1276)** — one new list item, rendered when `productUrls.length > 0`: `Product priority: On | Off`, from state restored by `hydrateFromJob`. Makes criterion 17's Studio half inspectable.

**Final screen (step 6, ~:1401-1432)** — when `assembleWarnings.length > 0`, render an amber non-blocking note listing each warning above the video. Not an `alert()`; the reel succeeded.

**`hydrateFromJob` (~:200-233)** — restores `product_overrides_research` into state. `broll_frequency` restoration at :215 stays as it is (still truthy-guarded, which is now correct because the row is never empty).

**Behaviour when the relevant stage is absent**
- No `broll_plan` in the plan → no setup frequency picker, no Architect chips (already gated at :1202), no `broll_frequency` PATCH, no assemble warnings from the concat guard.
- No `adapt_voice`/`script` in the plan → `ScriptDisplay` still renders (`showScript` covers `!!finalScript`), and the estimate still shows; the target falls back to the pipeline default and is labelled as such.
- Non-product pipeline, or product pipeline with zero photos → the override toggle is not rendered at all and nothing about topic generation changes (criterion 18).

**Labels in, vendor ids never.** The Studio sends `"Minimal" | "Standard" | "High"` (a human label, resolved server-side against the frequency tables in `generate-broll-plan/route.ts:17-30`), a boolean, and an avatar **label** (unchanged). It receives `speechWordsPerSec` and `productImagePayloadLimitMb` — numbers, not model names.

### `src/components/ScriptDisplay.tsx`

**New props:** `targetDurationSec: number | null`, `wordsPerSec: number`, `targetSource: 'reel' | 'pipeline-default' | 'none'`.

**Computed, in a `useMemo` over `editValue`** (the component's own live edit state — this is what makes criterion 9 work without leaving the page): `estimateSpokenScript(editValue, wordsPerSec)` → `{ words, seconds }`, then `checkDurationOvershoot(seconds, targetDurationSec)` → `string | null`.

**Header (`:116-120`)** — `Words:` and `Duration:` now render the **computed** values, replacing `script.wordCount` and `script.estimatedDuration`, which are the model's unverified self-report and are stale by construction (decision 7). Alongside them: `Target: {n}s` when a target exists, suffixed `(pipeline default)` when `targetSource === 'pipeline-default'`; nothing at all when `'none'` (criterion 12 — no misleading number).

**Overshoot flag** — an amber inline badge next to the header stats when `checkDurationOvershoot` returns non-null, naming estimated vs target. **It disables nothing.** No button, no navigation, no stage call is gated on it (criterion 10). It disappears the moment the user trims below the tolerance, because it is recomputed from `editValue`.

**Loading/error:** none new. The computation is synchronous and pure; there is no fetch and nothing to fail.

---

## 6. Tests required

Suite is dependency-free `node --test` with `--experimental-strip-types`, living outside the app tsconfig (`tsconfig.json:33` excludes `tests`), so `.ts` imports need explicit extensions. **No test calls a vendor or the DB.**

**`package.json:10` lists test files explicitly — there is no glob.** The line must become:
```
"test": "node --experimental-strip-types --test tests/coverage.test.ts tests/stages.test.ts tests/generators.test.mjs tests/duration.test.ts tests/product.test.ts tests/download.test.ts"
```
A new file not added to that line silently never runs — that is the failure mode criterion 41 exists to catch.

Baseline is **32** (coverage 7 + stages 16 + generators 9, verified by count). The final number must be higher, and all 32 existing cases must pass **with unchanged verdicts and message shapes** (criteria 41, 27).

### Purity requirements (what must be extractable for any of this to be testable)

| Logic | Must live in | Why |
|---|---|---|
| Spoken-duration estimate, word budget, overshoot check, ordered-duration resolution | `src/lib/pipeline/duration.ts` (new) | Pure, no ffmpeg, no `next/server`, no Supabase. Must **not** import `audio.ts` (which imports ffmpeg at module load). |
| Ordered-duration coverage rule | `src/lib/pipeline/coverage.ts` (extend) | Same reasoning as `checkNarrationCoverage`; keeps the guard callable from inside `concatBrolls` where it cannot be bypassed. |
| Precedence clause | `src/lib/pipeline/product.ts` (extend) | `product.ts` has no vendor imports today; keep it that way. |
| `downloadToFile`, `extensionFromUrl`, `extensionFromMimeType` | `src/lib/pipeline/download.ts` (new) | `assembly.ts` imports `fluent-ffmpeg`/`ffmpeg-static` at module load, which makes it unimportable from a lean test. Moving the download helper out is what makes item 6 testable at all. |
| MIME-by-extension, API-error classification (Python) | `src/lib/generators/base.py` (extend) | Already the shared contract module (m4 precedent). Both generators import from it, so **`from veo_generator import reference_mime_type` still resolves** and the existing pinned test at `generators.test.mjs:90-108` passes unchanged. |

### SUCCESS cases

| Test | File | Proves |
|---|---|---|
| `wordBudgetFor(20, 2.5) === 50`; rounds like `generate-english` does | `duration.test.ts` (new) | **6** (unit half) |
| `estimateSpokenScript` on a 45-word script at 2.5 w/s ≈ 18 s | `duration.test.ts` | **8**, **11** |
| `<break time="1.5s"/>` adds 1.5 s and 0 words; `time="500ms"` adds 0.5 s | `duration.test.ts` | **11** |
| `<emphasis>text</emphasis>` — the tag costs 0 words, the enclosed text counts | `duration.test.ts` | **11** |
| `resolveOrderedDurationSec` prefers `target_duration_sec` over the pipeline default | `duration.test.ts` | **6**, **28** |
| `resolveOrderedDurationSec` falls back to the matching pipeline's `duration_default_sec` | `duration.test.ts` | decision 5, **12** |
| A no-VO concat plan tiling `0→5→10→15` against 15 s ordered yields **no** warning (the proven variant-6 shape) | `coverage.test.ts` | **24** |
| Over-coverage (18 s tiled, 15 s ordered) yields no warning, matching the narration guard's pinned behaviour | `coverage.test.ts` | **25** (overshoot half), story edge case 3 |
| `productPrecedenceBlock` returns the clause when photos exist **and** the flag is true | `product.test.ts` (new) | **13** |
| `productPrecedenceBlock` output contains no instruction to ignore/suppress the research doc | `product.test.ts` | **15** |
| `extensionFromUrl` on the four real HeyGen URL shapes (`.webp` ×3, `.jpg`), incl. one with a query string | `download.test.ts` (new) | **38** |
| `reference_mime_type` importable from **`nanobanana_generator`** returns `image/webp image/png image/jpeg image/jpeg` | `generators.test.mjs` | **38** |
| A successful download over a localhost `node:http` server writes the exact bytes and resolves | `download.test.ts` | **32** (single-download half) |

### FAILURE cases

| Test | File | Proves |
|---|---|---|
| A 300-word script on a 20 s target produces an overshoot message naming both numbers | `duration.test.ts` | **8**, **7** (unit half) |
| A no-VO plan covering 12 s of a 15 s ordered duration warns, naming ordered **and** covered seconds | `coverage.test.ts` | **25** |
| The ordered-duration guard **returns a string, never throws** | `coverage.test.ts` | **decision 11** |
| `fetchProductImages`' total-payload message names the total and the limit (pure-path assertion on the message builder) | `product.test.ts` | **34**, **36** |
| An unwritable destination (path under a non-existent directory) makes `downloadToFile` **reject within seconds**, with the write failure in the message | `download.test.ts` | **29**, **30** |
| After that rejection, no partial file remains at the destination | `download.test.ts` | **31** |
| `is_retryable_api_error` classifies 400→permanent, 429→retryable, 500→retryable, unknown→retryable | `generators.test.mjs` | **decision 19** |
| `nanobanana_generator.py` still exits **2** with "requires at least one --ref" (existing case, must be unchanged) | `generators.test.mjs` | **23**, **41** |
| `imagen_generator.py` still refuses `--ref` permanently (existing case, unchanged) | `generators.test.mjs` | **23**, **41** |

### EDGE cases

| Test | File | Proves |
|---|---|---|
| A 45-word script on a 20 s target produces **no** flag (the criterion's own negative case) | `duration.test.ts` | **8** |
| An estimate exactly at target + 5.0 s does **not** warn; target + 5.1 s does | `duration.test.ts` | **decision 4** |
| `targetDurationSec === null` → `checkDurationOvershoot` returns `null`, never a message | `duration.test.ts` | **12** |
| `resolveOrderedDurationSec` returns `null` when there is no target **and** no matching pipeline | `duration.test.ts` | **28**, **decision 12** |
| `checkOrderedDurationCoverage(anything, null)` returns `null` | `coverage.test.ts` | **28** |
| Single-clip plan and a plan exactly at the ordered duration | `coverage.test.ts` | **24**, story edge case 8 |
| All 7 existing `checkNarrationCoverage` cases pass with identical verdicts and message text | `coverage.test.ts` | **27**, **41** |
| `resolveReelStages` output is byte-identical whether or not an unrelated opts key is present — the toggle removes no stage | `stages.test.ts` | **19** |
| Existing `voiceover=false drops adapt_voice/audio/avatar` and `injectScript=true drops topic/script` pass unchanged | `stages.test.ts` | **19**, **41** |
| `productPrecedenceBlock` returns `''` when the flag is true but there are no photos | `product.test.ts` | **18**, story edge case 4 |
| `productPrecedenceBlock` returns `''` when photos exist but the flag is false | `product.test.ts` | **14** |
| `extensionFromUrl` on an extensionless CDN path returns null (not a confident `.jpg`) | `download.test.ts` | **39** |
| `extensionFromMimeType('image/webp')` → `.webp`; `('application/octet-stream')` → null | `download.test.ts` | **39** |
| `stripUnspokenMarkup` output composed with a whitespace collapse equals `prepareScriptForTts`'s documented behaviour for a script with headers **and** brackets | `duration.test.ts` | **11** |

### Not automatable, and why — flag for the user, do not silently assume

- **Item 1 (criteria 1–5)** — no test can cover Studio state: there is no DOM/React harness and adding one is out of scope (story §4). Verification is by driving the Studio and reading the reel record. The only extractable piece (`normalizeBrollFrequency`) is worth one case in `product.test.ts` or `duration.test.ts` but proves almost nothing about the defect.
- **Item 4 (criteria 20–22)** — no test asserts prompt text anywhere in this repo, and adding one would pin wording that is meant to be tuned. `npm test`, `tsc` and `next build` are all blind to this item. It is `[inspection]` plus a comparison `[live-text]` run.
- **`tests/download.test.ts` opens a localhost socket** using built-in `node:http` on an ephemeral port. No new dependency, no vendor, no DB — but it is the first test in this repo to bind a port, so it is called out here for the gate. If that is unacceptable, item 6 drops to `[forced-failure]`-only manual verification and criteria 29–32 lose their regression pin.

---

## 7. Risks and open questions

### Decisions I made that §5 did not settle (each is overrulable at the gate)

1. **Where the frequency picker lives.** Decision 2 says "captured in the job-creation request", which requires a setup-screen picker. Story edge case 14 says capture-at-creation "makes it moot for the toggle, **not for the frequency chip**", which implies the chip stays mutable afterwards. I resolved this as **both**: a setup picker (creation capture, criteria 1 and 5) *and* the existing Architect chip persisting on navigate (criteria 2 and 4). Rejected alternative: patch-on-every-click — inconsistent with `persistScriptEdits`, the only precedent.
2. **Criterion 39, presenter URL with no usable extension.** OQ 16 was answered only as "the four real URLs do carry extensions". I chose: URL extension → `Content-Type` fallback → **throw**, landing in the existing graceful downgrade. Rejected alternative: keep a `.jpg` default, which is precisely the "confidently wrong declaration" criterion 39 forbids.
3. **Over-coverage in the no-VO guard.** Decision 11 settles short reels only; story edge case 3 leaves overshoot open. I chose **no warning on over-coverage**, matching the pinned behaviour of the narration guard (`coverage.test.ts:32`).
4. **The exact byte number for `maxInlineImagePayloadBytes`.** Gemini's ceiling is 20 MB for the **whole request**, and inline images travel base64-encoded (×4/3). I set the limit in **raw** bytes so the Studio can state a number a user can check against their own files, with headroom for the prompt and KB prose. **Recommended: 12 MB raw** (≈16 MB on the wire, ~4 MB left for text). The derivation belongs in a comment on the adapter constant. **The number itself is a judgement call — confirm it at the gate.**
5. **`generate-broll-plan` fails rather than inventing 45 seconds** when concat mode has neither a narration end nor a resolvable ordered duration. Decision 12 forbids the literal; `duration_default_sec` is `not null`, so this can only fire on an orphaned `pipeline_id`. This is a deliberate behaviour change on a path that has never been hit. Alternative if the gate prefers: keep a literal and log loudly — but that contradicts decision 12 as written.

### Risks

- **Items 4 and 5 pull in opposite directions** (story edge case 16). Steering harder toward option 1 (the real uploaded photo) produces more `product_image` stills, which are padded with silence (R13, mean −43.5 dB). Criterion 21 neutralises this by construction — a measurable shift in the b-roll plan's composition is a **failure** of item 4, not a success. The reword must preserve the operative rule verbatim in effect.
- **The reword is invisible to every automated gate.** `tsc`, `lint`, `build` and `npm test` will all pass on a reword that materially changes model behaviour. Only the comparison `[live-text]` run catches it.
- **`fetchProductImages` gains required options at three call sites.** Miss one and it fails to compile (good), but a builder tempted to default the options inside `product.ts` would reintroduce exactly the shared-global constant decision 18 forbids. The numbers must come from the adapters, at the call site.
- **Unifying the Python MIME map changes one byte of behaviour**: nanobanana currently maps `.gif` → `image/jpeg` via its else-branch; the shared map returns `image/gif`. Strictly more correct, practically unreachable (Cloudinary product photos and HeyGen stills), and called out here so the validator does not read it as scope creep.
- **`concatBrolls` and `downloadToFile` both change signature.** Both are TS-checked at every call site, so a missed update is a compile error, not a runtime surprise. `downloadToFile`'s new return value is ignored by four of its five callers by design.
- **Assemble warnings are not persisted.** A resumed reel will not re-display them. No criterion requires persistence, and adding a column for a warning string is schema surface this change does not need. Accepted; state it in STATUS §3 if the gate wants it tracked.
- **`speech_words_per_sec` calibration** (researcher OQ 5) is unresolved: it is one number per client applied to both the English and the adapted script. Decision 6 settles that we reuse it as-is and add no second column. If criterion 7's live run shows the adapted script systematically overshooting, that is a **config** finding for the admin panel, not a code change — record it, do not add a column.
- **The live `voice_prompt.md` cannot be read from the repo** (only the seed). Decision 7 says it already carries length guidance. If the live run shows the route-level block contradicting the KB, fix the KB doc or soften the block — do not add a second output contract.
- **`0007` must be applied before the first Studio run**, or `createJob` fails on insert. That is the user's trigger.

### Open questions genuinely left for the user

1. **The 12 MB figure** (risk 4 above) — confirm or set a different number.
2. **Criterion 7's tolerance and run count.** Decision 4 fixes the Studio warning threshold at +5 s. It does not say how many live `adapt_voice` runs constitute proof that the 20 s → 65 s defect is fixed. Recommend: three runs on the defect's own topic, all within +5 s. Confirm the count and whether one failure out of three is a pass.
3. **Does the reworded rule stay a hard rule or become a preference?** I kept it a hard rule so criterion 21 holds by construction. If the intent was ever to *allow* reference-conditioned stills (the adapter already supports it via `nanobanana_generator.py`), that is a behaviour change, out of scope by story §4, and belongs to the deferred design question flagged in R15.

---

## 8. Files that will change

Scope contract. The validator checks the diff against this table; an omission reads as an out-of-scope change.

### BACKEND — owner: backend-engineer (`src/app/api/**`, `src/lib/**`, `supabase/migrations/**`)

| Path | New/Mod | Reason |
|---|---|---|
| `supabase/migrations/0007_product_override_research.sql` | **NEW** | **MIGRATION** — adds `jobs.product_overrides_research boolean not null default false` (item 3). |
| `src/lib/jobs.ts` | Mod | `JobRow` gains the new field; `CreateJobOpts` + `createJob` accept and write `brollFrequency` and `productOverridesResearch`; comment recording why the flag is **not** in `PATCHABLE_FIELDS` (items 1, 3). |
| `src/lib/pipeline/broll.ts` | **NEW** | `BROLL_FREQUENCIES` + `normalizeBrollFrequency` — the server-side label allowlist `createJob` needs and `jobs.ts` cannot import from a route (item 1). |
| `src/lib/pipeline/duration.ts` | **NEW** | Pure duration logic: `stripUnspokenMarkup`, `estimateSpokenScript`, `wordBudgetFor`, `resolveOrderedDurationSec`, `checkDurationOvershoot`, `DURATION_OVERSHOOT_TOLERANCE_SEC` (items 2, 5). |
| `src/lib/pipeline/coverage.ts` | Mod | Adds `MIN_ORDERED_DURATION_COVERAGE` + `checkOrderedDurationCoverage`; **fixes the stale comment at :18** that claims ffprobe'd durations are passed in (item 5, decision 17). |
| `src/lib/pipeline/download.ts` | **NEW** | `downloadToFile` moved here and fixed to reject on write failure, plus `extensionFromUrl` / `extensionFromMimeType` — keeps the download path importable without ffmpeg (items 6, 8). |
| `src/lib/pipeline/assembly.ts` | Mod | Drops `downloadToFile`; `concatBrolls` accepts `orderedDurationSec` and returns `{ warnings }`; `overlayBrolls` untouched (items 5, 6). |
| `src/lib/pipeline/product.ts` | Mod | Adds `productPrecedenceBlock`; `fetchProductImages` takes `{ maxImages, maxTotalBytes }` and enforces a **total** payload; deletes `MAX_IMAGE_BYTES` and `MAX_IMAGES`; **fixes the stale comment at :5-7** about the removed HeyGen `background` hack (items 3, 7, decisions 17/18). |
| `src/lib/adapters/script/base.ts` | Mod | `ScriptAdapter` gains `maxInlineImagePayloadBytes` — the cap belongs to the model that has it (decision 18). |
| `src/lib/adapters/script/gemini.ts` | Mod | Implements it with the 20 MB-total-request derivation in a comment (item 7, decision 14). |
| `src/lib/generators/base.py` | Mod | Adds the shared `MIME_BY_EXT` / `reference_mime_type` and `api_error_status` / `describe_api_error` / `is_retryable_api_error` (items 8, decision 19). |
| `src/lib/veo_generator.py` | Mod | Imports those from `generators.base` instead of defining them locally; the module-level import keeps `from veo_generator import reference_mime_type` resolving, so the existing pinned test is unaffected (item 8). |
| `src/lib/nanobanana_generator.py` | Mod | Uses the shared `reference_mime_type` instead of the inline ternary at :91; wraps `generate_content` so a 4xx (except 429) exits 2 while content refusals stay retryable (item 8, decision 19). |
| `src/app/api/jobs/route.ts` | Mod | Accepts and forwards `brollFrequency` and `productOverridesResearch` (items 1, 3). |
| `src/app/api/generate-topic/route.ts` | Mod | Composes `productPrecedenceBlock(job)`; passes adapter-derived options to `fetchProductImages` (items 3, 7). |
| `src/app/api/generate-english/route.ts` | Mod | Uses the shared `wordBudgetFor` instead of its inline copy of the formula; adapter-derived `fetchProductImages` options (items 2, 7). |
| `src/app/api/generate-hinglish/route.ts` | Mod | Adds the target-duration + word-budget block to the `adapt_voice` prompt, omitted when the duration is unknown (item 2). |
| `src/app/api/generate-broll-plan/route.ts` | Mod | Reworded rules block + deferred-question comment; `resolveOrderedDurationSec` replaces the hardcoded `?? 45` at :127; adapter-derived `fetchProductImages` options (items 4, 5, 7). |
| `src/app/api/generate-avatar/route.ts` | Mod | Presenter still named with its real extension; imports `downloadToFile` from the new module (items 6, 8). |
| `src/app/api/assemble-video/route.ts` | Mod | Imports from the new download module; passes `orderedDurationSec` in the concat branch only; returns `warnings` (items 5, 6). |
| `src/app/api/uploads/route.ts` | Mod | Per-file cap now derived from the script adapter instead of the hardcoded 20 MB (item 7). |
| `src/app/api/clients/[id]/ui-config/route.ts` | Mod | Adds `speechWordsPerSec` and `productImagePayloadLimitMb` (items 2, 7). |
| `STATUS.md` | Mod | New **R15** residual-risk row for item 4's deferred design question (decision 10); closes **R14**; updates the test count and the gates line. |

### FRONTEND — owner: frontend-engineer (`src/app/**/page.tsx`, `src/components/**`)

| Path | New/Mod | Reason |
|---|---|---|
| `src/app/page.tsx` | Mod | Setup-screen frequency picker + product-override toggle; `openSetup` resets frequency/avatar/target duration; pre-upload total-size check and stated limit; `broll_frequency` PATCH on leaving the Architect screen; blueprint line for the override; assemble warnings on the Final screen; new props to `ScriptDisplay` (items 1, 2, 3, 5, 7). |
| `src/components/ScriptDisplay.tsx` | Mod | Computes words and spoken duration from the live edit buffer, shows them against the target, and renders the non-blocking overshoot flag (item 2). |

### TESTS — owner: test-verifier

| Path | New/Mod | Reason |
|---|---|---|
| `package.json` | Mod | The `test` script must list the three new files explicitly — there is no glob. |
| `tests/coverage.test.ts` | Mod | New ordered-duration guard cases; the 7 existing cases must pass unchanged. |
| `tests/stages.test.ts` | Mod | Pins that the override toggle changes no stage membership; 16 existing cases unchanged. |
| `tests/generators.test.mjs` | Mod | Pins nanobanana's MIME resolution and the 4xx retry classification; 9 existing cases unchanged. |
| `tests/duration.test.ts` | **NEW** | Estimator, word budget, ordered-duration resolution, overshoot tolerance. |
| `tests/product.test.ts` | **NEW** | Precedence clause and the total-payload message. |
| `tests/download.test.ts` | **NEW** | Write-failure rejection, partial-file cleanup, extension/MIME resolution. |

### Explicitly NOT changing — touching any of these is an out-of-scope finding

`src/lib/pipeline/stages.ts` · `src/lib/pipeline/audio.ts` (beyond delegating `prepareScriptForTts` to the shared strip helper, which must leave its output byte-identical) · `src/lib/pipeline/ffmpeg.ts` · `src/app/api/jobs/[id]/route.ts` · `src/app/admin/jobs/page.tsx` · `src/lib/adapters/visual/**` · `src/lib/adapters/avatar/**` · `src/lib/imagen_generator.py` · `src/proxy.ts` · `src/lib/auth.ts` · all migrations `0001`–`0006`.

### NEW INFRASTRUCTURE

**None.** No new table, queue, cron, bucket, service, or npm/pip dependency. The one schema change is a single additive column on an existing table (§2), and the one new test dependency is `node:http`, which is built in.

---

## 9. Acceptance-criteria coverage map

| # | Item | How it is proven |
|---|---|---|
| 1 | 1 | `[studio]` — read the reel record right after Start Reel |
| 2 | 1 | `[studio]` + `[live-text]` — fail/retry `broll_plan` (in budget) |
| 3 | 1 | `[studio]` — Recent Reels / `?job=` |
| 4 | 1 | `[studio]` — admin retry |
| 5 | 1 | `[studio]` — three reels, three frequencies |
| 6 | 2 | `[unit]` `wordBudgetFor` + `[live-text]` composed instruction |
| 7 | 2 | `[live-text]` — see open question 2 for run count |
| 8 | 2 | `[studio]` (+ `[unit]` on the estimator) |
| 9 | 2 | `[studio]` — trim in place, flag clears |
| 10 | 2 | `[studio]` to the authorized boundary; **avatar/assemble half NOT PROVABLE this round** |
| 11 | 2 | `[unit]` |
| 12 | 2 | `[unit]` estimator + `[studio]` |
| 13 | 3 | `[live-text]` — topic stage, toggle on |
| 14 | 3 | `[live-text]` — toggle off |
| 15 | 3 | `[live-text]` — output parses, template/hook/close intact |
| 16 | 3 | `[studio]` |
| 17 | 3 | `[studio]` + `[live-text]` |
| 18 | 3 | `[studio]` + `[unit]` (`productPrecedenceBlock` returns `''`) |
| 19 | 3 | `[unit]` |
| 20 | 4 | `[inspection]` — read the prompt |
| 21 | 4 | `[live-text]` — before/after comparison run |
| 22 | 4 | `[inspection]` — STATUS §3 R15 + code comment |
| 23 | 4 | `[unit]` — existing generator contract cases |
| 24 | 5 | `[unit]` |
| 25 | 5 | `[unit]` |
| 26 | 5 | `[unit]` + `[inspection]` (guard passed only in the concat branch) |
| 27 | 5 | `[unit]` — 7 existing cases, unchanged verdicts |
| 28 | 5 | `[unit]` |
| 29 | 6 | `[unit]` (`download.test.ts`) + `[forced-failure]` |
| 30 | 6 | `[unit]` — message names the write failure |
| 31 | 6 | `[unit]` — no partial file remains |
| 32 | 6 | `[unit]` single download; **full-reel regression NOT PROVABLE this round** |
| 33 | 6 | `[forced-failure]` to the render boundary; the composite call itself is out of budget |
| 34 | 7 | `[unit]` on the message + `[live-text]` |
| 35 | 7 | `[studio]` |
| 36 | 7 | `[studio]` + `[unit]` (same number, both surfaces) |
| 37 | 7 | `[studio]` — count limit unchanged |
| 38 | 8 | `[unit]` — helpers are importable on both the TS and Python sides |
| 39 | 8 | `[unit]` |
| 40 | 8 | **NOT PROVABLE this round** — needs an image-generation call (decision 15) |
| 41 | — | `[unit]` — `npm test`, count above 32, all 32 unchanged |
| 42 | — | `[unit]` — `npx tsc --noEmit`, `npm run lint`, `npm run build` |
| 43 | — | `[forced-failure]` — cross-client jobId → 403 on each touched route |
| 44 | — | `[forced-failure]` — PATCH `product_overrides_research` → filtered out, 400 "No valid job fields" |
| 45 | — | `[inspection]` — grep the diff for `slug`/`client_id` branching |
| 46 | — | `[inspection]` — spend log: text stages + ElevenLabs only |
| 47 | — | `[inspection]` — every item ends verified-with-evidence or unresolved-with-reason in STATUS.md |

Items 10, 32, 33 and 40 are the follow-up sweep list required by decision 15. They are recorded as **unverified**, never as passing.
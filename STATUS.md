# STATUS — Kiran Reels

**The living tracker.** State only: what's done, what's open, what to test.
For *why* any of it exists, read the v3 doc pack (`kiran-reels-docs-v3.zip`, user-held) — this file does not duplicate it.
⚠️ The pack predates the live vendor run below and is **stale** wherever the two disagree; this file wins.

| | |
|---|---|
| **Updated** | 2026-07-24 (**v5 release close-out — COMPLETE, both halves built; verification 28 PASS · 0 FAIL · 19 CANNOT COVER of 47 criteria, the 19 recorded below and never as passing**: 8 items — frequency captured at creation · adapt_voice duration budget · per-reel product-override toggle · reworded b-roll rationale (R15) · no-VO ordered-duration warning · download write-failure now rejects · one photo-payload limit · presenter still declares its real format) |
| **Branch** | `interface`, HEAD `e47980b` (V5 committed). Working tree: v5 close-out **uncommitted** — `0007` migration (**applied live**), four new test files, `pipeline/{broll,duration,download}.ts`, edits across the stage routes, and the Studio half (`page.tsx`, `ScriptDisplay.tsx`) |
| **Gates** | `tsc` 0 · `next build` 0 (27 API routes) · `lint` 170 problems = **the pre-existing baseline exactly, zero new** (all `no-explicit-any`) · tests `npm test` **109/109** (coverage + ordered-duration guards · stage-plan validation · generator CLI contract · webp MIME regression on BOTH generators · duration estimator/budget/±5s deviation · product precedence clause · **one photo-size limit on one axis, creation and stage agreeing over a real socket** · download write-failure rejection · plus the 47-criterion acceptance suite) |
| **Live DB** | Supabase `oyxpwfpbfqcfbuklnsjq` · migrations **`0001`–`0007` applied** · `0007_product_override_research.sql` applied 2026-07-24 and confirmed against `information_schema.columns` — `product_overrides_research`, `boolean`, `NOT NULL`, default `false`, which is exactly what `createJob` inserts |
| **Vendors** | ✅ **ElevenLabs, HeyGen v3 and Veo all called live and passing** (2026-07-17) · **live TEXT+AUDIO close-out verification 2026-07-24** (6 Gemini + 1 ElevenLabs, no HeyGen/Veo/nano-banana by budget) — see §6 |
| **Live close-out verification** | **Criteria 6, 7, 13, 14, 15, 21 all PASS against real vendors.** Headline: the 20 s reel that produced a ~65 s script in v5 now speaks in **20.08 s** (ElevenLabs ground truth, 0.08 s off target). Product-override A/B on identical inputs: **3/3 topics on-product with the toggle ON, 0/3 with it OFF**. B-roll reword A/B on identical inputs: **composition identical**, so the reword moved no behaviour. §6 has the numbers. |
| **Deadline** | **2026-11-01** HeyGen v1/v2 retire — code is on v3 and **v3 is now proven**. Handled. |

**HeyGen product placement (R4): ✅ BUILT + verified end-to-end (Route B).** Presenter composited holding the product → HeyGen `type:'image'` lip-synced to our audio. Proven live (Kiran holding ZORBEX, mid-speech). Studio E2E for variant 3 is the only piece left — see §R4 and §5.

## Review checklist

| # | Item | Verdict | Reason |
|---|---|---|---|
| 1 | Gaps causing prod issues | ✅ pass | Every known blocker/major closed and verified. Residual risk is listed below, not silent. |
| 2 | Customizability | ✅ pass | 4-bucket model holds; model ids are DB columns, no redeploy. |
| 3 | Modularity & stage skipping | ✅ pass | Toggles → snapshot → one reader → 409. Text-source rule closed server-side. |
| 4 | All variants work individually & together | ✅ pass | **All four sold variants now rendered E2E through the Studio**: 1 & 5 (§2b, 2026-07-17), **3 & 6 (§5, 2026-07-18)**. Overlay mode keeps gaps, concat mode tiles contiguously — both confirmed on real reels. |

---

## 1. Done & verified

**v3 doc pack (`01 §1`, `02 §Part 1`) — accurate as written; spot-verified, not restated.**

**Fixed + verified 2026-07-17:**

| # | Fix | Evidence |
|---|---|---|
| M1 | **Variant 5 (`product_promo`, sold) shipped truncated reels.** Tiling was keyed off `noAudio`; the axis is `noAvatar` (concat drops gaps → reel = SUM of durations → `-shortest` cuts narration). Now tiles `0..narrationEnd` + aligns cuts to sentence boundaries. | 30s narration: **9.00s → 30.00s, 100% of script** |
| M1b | **Coverage guard** `MIN_NARRATION_COVERAGE=0.95` **inside** `concatBrolls` so it can't be bypassed. | sparse plan → refused with reason |
| M2 | **Generator errors went to stdout; adapter reads stderr** → cause replaced by a base64 command dump. All 4 generators now report via `base.fail()` → stderr. | real cause now surfaces |
| M3 | **`veo_generator.py` poll was unbounded** — a stuck op hung assembly forever. Now 15-min ceiling. **This was also the only real Render-timeout risk.** | bounded |
| M4 | **`operation.error` + `rai_media_filtered_reasons` never checked** → real Veo reason lost. Now surfaced. | caught a live RAI message verbatim |
| **M11** | 🔴 **`negative_prompt` + `reference_images` = `400 INVALID_ARGUMENT` on Veo 3.1.** EVERY product clip would have failed. Found only by calling Veo. Fix: fold exclusions into the prompt as an `AVOID:` clause (as nano banana does). | same call: **400 → exit 0, 936KB mp4** |
| M5 | Retry burned 3 attempts on permanent failures. Generators now exit **2** = don't retry (contract/config errors); content refusals stay retryable. | stops at attempt 1/3 |
| M7 | `google-genai` unpinned → `>=2.11,<3`. | — |
| m1 | Text-source rule missing server-side. `validate(names,{scriptSupplied})` from `createJob`. | 8/8 plan cases |
| m2 | Frequency guidance said *"let the base video carry the reel"* in concat mode — no base video exists. Concat mode now = cut density. | — |
| m4 | 3 generators duplicated `parse_cli_args`/`load_env`. Now import `generators.base` (resolves from any cwd — Docker-safe). | verified 2 cwds |
| m5 | `provider_job_ids` overwritten, not merged. | — |
| m6 | Shell interpolation of `--ref`/`--model`. Now `execFile` + argv array — no shell. | — |

**Live vendor run — first ever (2026-07-17):**

| Vendor | Result |
|---|---|
| **ElevenLabs** | ✅ 4.7s, 25KB mp3, alignment intact, Kiran's real config (`eleven_v3`) |
| **HeyGen v3** | ✅ **2/2 renders COMPLETED.** `POST /v3/videos` → `waiting`→`processing`→`completed`→`video_url`. Error shape `{error:{code,message,doc_url}}` confirmed via a 404 probe. **The highest-risk item in the pack is closed.** |
| **Veo 3.1 Fast** | ✅ Clip generated **with `reference_images`** — product preserved exactly (teal body / purple cap / orange bolt, none of it in the prompt). **Native audio confirmed present** (aac 48kHz stereo) — the assumption `concatBrolls` rests on. |

**Closed as non-issues (checked, don't re-investigate):**
- **Veo `reference_images` is NOT account-gated** on this account (pack known-weak #2) — proven working.
- **HeyGen talking_photo vs avatar**: 3 of Kiran's 4 "avatars" are `type:talking_photo`, but v3 accepts them under `type:'avatar'` — **both render fine**. Not a bug.
- **Render request ceiling: 100 minutes.** HeyGen (15m) and Veo (15m, now bounded) sit well inside. M6 needs no work.
- Clips pushed to `placements` in completion order — harmless (`concatBrolls` sorts; `overlayBrolls` uses absolute timestamps).
- camelCase kwargs in the Python generators — pydantic aliases resolve both.
- Cleanup route orphan predicate — reviewed sound (reference check before age check; publicId matching; correct pagination). `list('image')` matches `/api/uploads`' `resourceType:'image'`.

## 2. Pending fixes / bugs / defects

**None known in code.** Everything inventoried is fixed and verified, or listed below as an explicit, accepted residual.

### v5 close-out — NOT PROVABLE this round (decision 15: text stages + ElevenLabs only)

Recorded as **unverified**, never as passing. These are the follow-up sweep list:

| Criterion | Item | Why it could not be proven |
|---|---|---|
| 10 (second half) | 2 | The overshoot flag's "never blocks" claim is provable only to the authorized boundary; the `avatar`/`assemble` half needs a paid render. |
| 32 (full-reel) | 6 | A single download's success is unit-pinned (`tests/download.test.ts`); a whole-reel regression needs a full assembly. |
| 33 (past the render boundary) | 6 | The presenter-composite downgrade is reachable by forced failure, but the composite call itself is an image-generation call. |
| 40 | 8 | Confirming the two already-proven formats still behave needs a nano banana call. |
| 20, 21 | 4 | The `broll_plan` reword is invisible to `tsc`, `lint`, `build` and `npm test`. Needs `[inspection]` plus a before/after comparison run on a real product reel. |
| 1–5 | 1 | Studio state has no DOM/React harness (out of scope by story §4). Verified by driving the Studio and reading the reel record. |

### M12 — 🔴 WebP product photos 400'd EVERY Veo product clip (found + fixed 2026-07-18)

**Found by running variant 3 with a real client product photo (a `.webp`).** Assembly failed: both `features_product` clips died after 3 attempts.

- **Cause:** `types.Image.from_file()` infers MIME from Python's `mimetypes` registry, which **does not know `.webp` on Windows** → `mime_type=None` → the SDK omits `mimeType` → Veo returns `400 INVALID_ARGUMENT: "Image field doesn't have expected `bytesBase64Encoded` or `mimeType` fields"`. Every v4 test used PNG, so it never surfaced. `/api/uploads` accepts any `image/*`, and webp is the norm for product photography — so **any webp product reel was guaranteed to fail**.
- **Fix:** `veo_generator.py` now resolves the MIME type from an explicit `MIME_BY_EXT` map and builds `types.Image(image_bytes=…, mime_type=…)` directly — no platform dependency. (`nanobanana_generator.py` already did this, which is exactly why the Route B composite succeeded while Veo failed.)
- **Also fixed:** the SDK exception escaped as a **raw traceback** (not a `fail()` reason) and exited 1, so the adapter burned all 3 attempts on a permanent 400. `generate_videos()` and the poll are now wrapped → clean reason on stderr + **4xx (except 429) classified permanent** (exit 2, no retries).
- **Verified:** identical call went `400` → **exit 0, 1.2 MB mp4**, product preserved, aac 48 kHz. Regression test added (`npm test` 32/32).

## 2b. E2E through the Studio — 2026-07-17

Onboarding wizard driven start→finish on a throwaway clone of Kiran (`zz-e2e-test-delete-me`), then reels run through the real UI with real vendors. Test client + all assets deleted afterwards; only `kiran` remains.

| Item | Result |
|---|---|
| **Onboarding wizard** | ✅ All 6 steps. Clone → 4 KB docs copied (`skippedKbDocs: []`), 1 pipeline, 4 avatars, 7 templates. 3 variant pipelines added via presets. Readiness: **"Everything checks out"** (0 errors, 0 warnings). Activated. |
| **Variant 1 (Full E2E)** | ✅ **Rendered.** 8.79s vs 8.8s narration, 1080×1920, aac 48kHz. HeyGen avatar + overlay. `provider_job_ids` persisted. |
| **Variant 5 (`product_promo`, sold)** | ✅ **Rendered.** Narration 10.08s → reel **10.07s = 100% delivered** (was 30% pre-fix). Plan tiled **contiguously, zero gaps**, coverage 100%. Product (teal/purple/orange/"ZORBEX") preserved into the final frame. |
| **Variant 3 (avatar + product)** | ⚠️ HeyGen rendered; **assembly failed on Veo's safety filter** (3 retries). Not a defect — see below. |
| **Variant 6 (product + music)** | ⬜ **Not run.** Its unique path (concat, no VO) is covered by variant 5's concat + the direct Veo native-audio proof, but it has not been rendered. |
| **R1 Studio UI** | ✅ Closed. Plan-driven stepper correct per variant (no Avatar step on variant 5); `productImageLimit` counter rendered `1/3` from Veo's `maxReferenceImages`. |
| **R2 Duck level** | ✅ **Measured on real speech.** Reel mean **−20.2 dB** / max −5.8 dB vs narration solo −17.2 / −3.0. Narration dominant, no clipping. **0.18 is not broken**; loudness of the bed remains a taste call. |
| **R3 `features_product`** | ✅ **Closed.** The creative director emitted `features_product: true` on **both** clips of a product reel, unprompted. |
| **R4 HeyGen product placement** | ✅ **Rebuilt (Route B) + verified.** Old `background` hack removed. Presenter now composited holding the product → `type:'image'` lip-synced render. Proven live end-to-end (§R4). Studio variant-3 run pending. |
| **M2/M4/M5 in production** | ✅ Proven by variant 3's failure: `"blocked by Veo's safety filter (1 filtered) — …"` surfaced (not `Command failed` + base64), retried 3×, stage **failed** instead of shipping a holed reel. |

## 3. Residual risk (accepted, not silent)

| # | Item | Why it's not closed |
|---|---|---|
| ~~R11~~ | ~~Variant 6 never rendered + variant 3 not run through the Studio.~~ | ✅ **CLOSED 2026-07-18** — both rendered E2E through the Studio (§5). |
| R13 | **A `product_image` still contributes silence to a no-VO concat reel.** Variant 6's first 5 s (the real photo) is silent by design (stills are padded with silence), so "product + music" starts quiet — mean −43.5 dB across the reel. | Working as designed, not a defect. If a fully-scored reel is wanted, either avoid `product_image` entries in no-VO reels or add a music bed (deferred feature). |
| ~~R14~~ | ~~**`broll_frequency` selection can fail to persist.**~~ | ✅ **CLOSED 2026-07-24** — the column defaulted to `'Standard'` and the user's choice only landed when `broll_plan` *completed*, so every read before that (the reel record, a resume, an admin retry, a failed plan stage) reported a value nobody chose. `createJob` now writes the normalised label at REEL CREATION (`pipeline/broll.ts` allowlist), and the Architect chip persists via the already-allowlisted `PATCH /api/jobs/[id]` before navigating. Both candidate mechanisms closed. Studio verification still owed. |
| **R15** | **Which route a product STILL should take is undecided.** The `broll_plan` prompt keeps `"features_product": true` to `media_type: "video"`. That routing is shipped and proven, but the old wording justified it with a false technical claim ("a generated still CANNOT be conditioned on the photos") — `nanobanana_generator.py` *can* condition a still on the photos, `veo_imagen.ts` routes image + refs to it, and `assemble-video` already passes both. The wording is now true; the underlying question is not answered. | Deliberately deferred (story §4 puts it out of scope). It is a product trade-off, not a technical one: a reference-conditioned still is a generated frame where option 1 is the exact uploaded photo for free, and stills are padded with silence in a no-VO concat reel (R13). Flagged here **and** at the prompt block in `generate-broll-plan/route.ts`. Any change to that wording needs a before/after `broll_plan` comparison run — a shift in the plan's composition is a regression, not an improvement. |
| R12 | **Veo's safety filter blocks some generated b-roll prompts** (hit on variant 3, 3/3 retries). Content outcome, not a bug — but it means a reel can legitimately fail and need a re-run. | Vendor behaviour. The creative-director KB prompt is the lever if it recurs. |
| R17 | **The new `generate-broll-plan` hard failure is untested and cannot be unit-tested.** In concat mode (`noAvatar`) with neither a narration timeline nor a resolvable ordered duration, the stage now fails `500` instead of tiling against a hardcoded 45 s (`generate-broll-plan/route.ts:147-151`, approved at GATE 2 amendment 5). No test covers it. | The condition lives in route-level code, which needs the DB and a client config to reach — the suite is dependency-free and may not touch either. Only reachable on a reel whose `pipeline_id` is orphaned, so it was also not reachable in the authorized verification budget. **Recorded as unverified, not as passing** (criterion 47). Provable only by pointing a reel at a deleted pipeline in a live run. |
| R16 | **Assemble warnings are not persisted.** `POST /api/assemble-video` returns `warnings: string[]` (currently only the no-VO ordered-duration shortfall) and the Studio shows them on the Final screen, but nothing is written to the row — a resumed reel will not re-display them. | Accepted. No criterion needs persistence, and a column for a warning string is schema surface this change does not need. |
| R6 | Veo 3.1 Fast returns **720×1280**, not 1080×1920; assembly upscales. | Vendor output size. Accepted. |
| R7 | `acme-product-co` Cloudinary leftover (deleted client, 4 KB). | Needs the explicit `prefix` sweep. Run dry first. |
| R8 | nano banana returns 768×1344 (~1.6% crop); `image_size:'2K'` ignored. | Accepted deviation. |
| R9 | `getJobStagePlan` falls back to the full sequence on a corrupt plan. | Deliberate; all rows backfilled. |
| R10 | `veo_imagen` slug now covers 3 generators (misnomer). | Won't fix — needs a data migration for no gain. |

## R4 — HeyGen product placement — ✅ BUILT (Route B) + verified end-to-end; Studio E2E pending

**Your ask:** the product must be *in* the avatar video (held/presented) — not a `background`. **Done.**

**Chosen: Route B.** The presenter is composited holding the product (nano banana), then HeyGen Avatar IV (`type:'image'`) animates that still with lip-sync to our ElevenLabs `audio_url`. Product in-hand AND narrated. The old `background` product hack is removed.

**HeyGen API — all confirmed against developers.heygen.com (2026-07-17):**
- `POST /v3/videos` has **three** `type`s: `avatar` (today; lip-syncs to `audio_url`/script), `image` (Avatar IV — animates ONE still with lip-sync to `audio_url` + `motion_prompt`), `cinematic_avatar`.
- **`cinematic_avatar`**: prompt-driven (1–10,000 chars), combines 1–3 avatar looks + a **`references`** array of `{type, asset_id|url}` — **max 3 videos + 9 images**. This is literally "product as a prompt attachment."
- **Assets upload (confirmed):** `POST https://api.heygen.com/v3/assets`, `multipart/form-data`, field `file` (png/jpeg, ≤32 MB), returns **`data.asset_id`**.
- Avatar looks: `GET /v3/avatars/looks`. Polling unchanged (`GET /v3/videos/{id}`).

**🔴 THE FORK (confirmed, not speculation) — `cinematic_avatar` has NO `audio_url`/`voice_id`. It cannot lip-sync.** Kiran's pipeline is ElevenLabs audio → HeyGen lip-syncs to it. So a single HeyGen call cannot give both narrated lip-sync AND product-in-hand. Three routes:

| Route | How | Product in video? | Lip-synced narration? |
|---|---|---|---|
| **A — `cinematic_avatar`** | product photo → `references` array + prompt "presenter holding the product" | ✅ held by presenter | ❌ **none** (no audio at all) |
| **B — `type:'image'` on a combined still** ⭐ | make ONE still of *presenter+product*, then Avatar IV animates it with `audio_url` | ✅ in the still | ✅ yes |
| **C — status quo minus background** | keep `type:'avatar'` talking head; product only via Veo b-roll | ⚠️ only in b-roll cuts, not held | ✅ yes |

Route B is the only one that delivers both. (`cinematic_avatar` = Route A, product but silent; Avatar V doesn't attach products via API — see below. HeyGen's web-studio "Product Placement" is UI-only.)

**BUILT (6 files):**
- `nanobanana_generator.py` — `--persona <path>` composite mode: persona image (person, preserved) + `--ref` products → "presenter holding product" still. Product mode unchanged.
- `adapters/visual/base.ts` — `composePresenterProduct()` (optional) + `PresenterCompositeRequest`.
- `adapters/visual/veo_imagen.ts` — implements it via nano banana `--persona`; retry loop extracted to a shared `runGenerator()`.
- `adapters/avatar/base.ts` — `render({…, presenterImageUrl?})` + optional `getPresenterImage()`. Removed `attachmentImageUrls`.
- `adapters/avatar/heygen.ts` — `getPresenterImage()` (GET `/v2/avatar/{id}/details` → `preview_image_url`, null-safe); `render()` now branches to `type:'image'` when a composite is given. **`background` product hack removed.**
- `generate-avatar/route.ts` — orchestrates: product reel → `getPresenterImage` → download presenter+products → `composePresenterProduct` → upload → render with `presenterImageUrl`. **Graceful fallback:** any composite failure → plain talking head (product still via B-roll), never a failed reel.

**VERIFIED live (2026-07-17):** each production piece exercised against real vendors — nano banana `--persona` (real generator → faithful composite: Kiran's face + ZORBEX preserved), visual adapter `composePresenterProduct` (TS→generator), `getPresenterImage` (URL for real avatar, null for bogus — fallback trigger), and the full chain through the **production `render()`** → HeyGen `type:'image'` → **1080×1920, 48 kHz audio, Kiran holding the product mid-speech (lip-synced)**. `tsc` 0 · `build` 0.

**Reliability note (real, mitigated):** nano banana's person-face compositing returned `IMAGE_OTHER` (empty) under ~15 rapid-fire calls, then worked first-try once throttling cleared → it's **rate-throttle, not a hard block**; one composite per reel is fine, and the graceful fallback covers a miss. Also: the presenter still carries HeyGen's burnt-in "Powered by 1hat.ai" watermark (cosmetic; a cleaner source image would remove it).

**Avatar V (Avatar 5) — checked, does NOT change the fork.** Confirmed against `developers.heygen.com/avatar-v`: `type:'avatar'` + `engine:{type:'avatar_v'}`, **`script`+`voice_id`** (no `audio_url` documented), reference inputs only `motion_prompt` + `reference_look_id` — **no product/scene-image field via API**. Opt-in per look. It's a higher-fidelity lip-sync engine only; no "Route D".

**Remaining:** variant-3 reel through the Studio (part of the next session) to confirm the wiring in situ. The mechanic itself is proven above.

## 4. Deferred (by decision — triggers in doc pack `03`)

**`@google/generative-ai` (Node) is deprecated** — Python already uses the current `google-genai`. Works today; EOL risk. *Trigger: migrate to `@google/genai` before it breaks, or at the next Gemini change.* **Your call: log, don't migrate now.**

**Server-side "a product reel must show the product" check** — `features_product` stays model-driven. **Your call: leave it.** *Trigger: if real b-roll plans start omitting the product.*

Also deferred: 2nd visual provider (Seedance **2.0** — 1.0 has no audio) · per-client API keys · HeyGen webhooks · nano banana for all stills · publish-state lifecycle · caption burning · manual audio · script versioning · cost logging · non-9:16 · template decomposition · RAG.

## 5. Tests — status after the E2E run

| # | Test | Proves | Status |
|---|---|---|---|
| 1 | **Full Kiran reel (variant 1)** through the Studio | R1 + HeyGen avatar + overlay | ✅ **done** (§2b) |
| 2 | **`product_promo` (variant 5)** | M1 fix end-to-end, R2, R3 | ✅ **done** (§2b) — 100% narration, product preserved |
| 3 | **Variant 3 (avatar + product)** | Route B in situ (composite → `type:'image'` lip-sync). | ✅ **DONE 2026-07-18** — job `19dffe36`. Composite made (Kiran holding the real pickle bowl) → HeyGen `type:'image'` → **1080×1920, aac 48 kHz, 15.98 s** vs ~15 s narration. Timeline verified by frame: t=1 s avatar holding product (lip-synced), t=5 s real photo, t=9 s + t=13 s Veo clips with the product preserved. Surfaced + fixed **M12**. |
| 4 | **Variant 6 (product + music)** | concat, no-VO path | ✅ **DONE 2026-07-18** — job `cd59e0d2`. Plan tiled **0→5→10→15, zero gaps**; reel **exactly 15.000 s**, 1080×1920, aac 44.1 kHz. Veo native audio present (mean −43.5 dB / max −9.5 dB). Product preserved in both generated clips. |
| 5 | **Cleanup dry-run** (`{"apply": false}`) then R7 | Orphan predicate live. Read report before `apply:true`. | ✅ **done (v4.1)** — route invoked live; `kiran` clean (0 orphans); `acme-product-co` orphan confirmed (1 asset, **3989 B**, id `…/x8fslkx8qyd5h6jdaqvh`) at `olderThanDays:0`. Predicate sound (protects referenced + recent). `apply:true` delete **pending user** (permanent deletion). |

## 6. Live close-out verification — 2026-07-24 (TEXT + AUDIO only, by budget)

Six Gemini calls + one ElevenLabs synth. **No HeyGen render, no Veo clip, no nano banana composite, no assembly, no Cloudinary upload** — the v5 product photo (`…/product/pxvrso16skaylhbjvkif.webp`) and the v5 defect case (20 s target) were reused so nothing new was created.

Method, stated plainly: each route's prompt construction was mirrored **verbatim** and the **real** adapters were called with the **real** client config and KB docs from the live project. The route shell — `requireUser()`, the stage guards, the DB writes — was **not** exercised (it is cookie-authenticated); those are covered by the unit suite and `tsc`. The Studio-side halves remain `[studio]`.

| Criterion | Result |
|---|---|
| **6** — adapt_voice states target + word budget | ✅ Duration block present; states the 20 s target, the client's 2.5 words/sec, and the 50-word budget it implies. |
| **7** — the 20 s → ~65 s defect | ✅ **FIXED, against real TTS.** v5: 1 850 chars ≈ 65 s. Now: 558 chars, estimated 19.2 s, and **ElevenLabs actually speaks it in 20.08 s — 0.08 s off a 20 s order.** No flag, correctly. |
| **13** — toggle ON ⇒ topics on-product | ✅ **3/3** topics about the uploaded garlic pickle. |
| **14** — toggle OFF ⇒ unchanged | ✅ **0/3** on-product — monsoon fever, dehydration, baby massage. Reproduces the original defect exactly, which is what makes 13 meaningful. |
| **15** — precedence, never suppression | ✅ Research doc still in the prompt in full (9 739 chars); all three topics returned a template, hookType, closeType and duration, and the array parsed. Kiran's pediatric persona survives *inside* the product topics. |
| **21** — reword moved no behaviour | ✅ **Controlled A/B on identical inputs** (same script, timestamps, photo; only the rule wording differs): OLD → 2 entries, 1 `features_product` video, 0 stills, 0 illegal. NEW → **identical**. Zero `image`+`features_product` entries either way. |

**Two findings worth keeping:**
- **The model's self-reported length is not trustworthy** — it claimed 50 words / 20 s where the actual text computes to 44 words / 19.2 s. This is exactly why the Studio estimates from the text and never from `script_meta` (decision 7).
- **`speech_words_per_sec = 2.5` is well calibrated for the ADAPTED (Hinglish) script, not just English** — the estimator landed within **0.88 s** of real TTS. This closes the open question about whether a second per-language rate was needed: it is not.

### Round 2 — live DB + nano banana (2026-07-24)

| Criterion | Result |
|---|---|
| **43** — cross-tenant | ✅ `jobClientMismatch` → **403**, body leaks no tenant id and no reel data; the reel is invisible under a foreign client. |
| **44** — browser cannot change reel BEHAVIOUR | ✅ A **hostile PATCH** flipping `product_overrides_research` + `client_id` + `stage_plan` + `final_video_url` left **every** server-controlled field intact, while the one allowed field (`broll_frequency`) did change — proving the patch executed rather than silently no-op'ing. A patch of only the flag is refused: *"No valid job fields in patch"*. |
| **1/2 at DB level** | ✅ `broll_frequency` persisted **at creation** as "Minimal" — R14 closed where it actually mattered. |
| **40** — composite unchanged | ✅ Produced from a **`.webp` persona** (the format mislabelled `image/jpeg` on 3 of 4 avatars) in 20.2 s → 1.9 MB. **Visually confirmed**: identity preserved, holding the real pickle bowl, head-and-shoulders. |
| **33** — graceful downgrade | ✅ Bogus avatar id → `getPresenterImage` returns `null` (not a throw); null presenter short-circuits to a plain talking head; an unwritable destination **rejects** and the process survives. |

Method: one throwaway job created via the real `createJob` and **deleted afterwards** (confirmed 0 rows remain).

⚠️ **HeyGen's CDN (`files2`/`resource2.heygen.ai`) is unreachable from the dev sandbox — `ECONNRESET`** — while `api.heygen.com` and Cloudinary work. Criterion 40 was therefore proven with a real presenter still transcoded to webp rather than fetched live. Production succeeded on this path in v5, so this is sandbox egress, not a code defect — and it doubles as a live demonstration that the criterion-33 downgrade fires when the CDN is down.

**Still unverified — VIDEO RENDERS ONLY, held by decision, never recorded as passing:** criteria 1–5, 9, 16, 17, 35 (`[studio]`, no DOM harness) · **10** (avatar render half) · **32** (full-reel regression) · the render half of **33**. Everything else is now executed and verified.

## 7. Watch

- **A model's self-reported word count / duration is decoration.** Measure the text. The adapt_voice model over-reported by ~14% on the very run that verified the duration fix.
- **Overlay tolerates gaps; concat does not.** The avatar shows through a gap; in concat a gap is deleted content. Any change to b-roll timing or assembly must keep that distinction. This was M1.
- **Vendor limits are only knowable by calling.** M11 (`negative_prompt` + refs = 400) was invisible to docs, types and `tsc`, and would have failed every product clip. The pack's "built vs works is exactly one test run" framing is what hid it.
- **Retry classification is evidence-based.** Veo's own words: filtered attempts are *"not charged"* and *"try again"* — and the identical call then succeeded. So content refusals retry; only contract/config errors are permanent (exit 2).
- **HeyGen: product-in-video and lip-sync are mutually exclusive in one call.** `cinematic_avatar` (product via `references`) has NO audio; `type:'avatar'`/`image` lip-sync but take one image. Getting both needs a pre-composited presenter+product still (Route B, §R4). Any future "just add the product to the avatar" request hits this wall — don't re-litigate it.
- **Vendor docs drift; in-code "only documented way" comments rot.** `heygen.ts:56` claimed background was the only route to a product — false within months. Re-check vendor capability before trusting an old code comment. The `broll_plan` "a generated still CANNOT be conditioned on the photos" line was the same class of rot (R15).
- **A cap belongs to the model that has it.** `ScriptAdapter.maxInlineImagePayloadBytes` (12 MB raw on Gemini, from its 20 MB whole-request ceiling ÷ the ×4/3 base64 inflation) and `VisualAdapter.maxReferenceImages` are read at the call site, never defaulted in `pipeline/product.ts`. A shared constant is how a new provider silently inherits someone else's ceiling.
- **One photo-size limit means one axis.** The ceiling is the reel's **total** raw photo bytes (`ScriptAdapter.maxInlineImagePayloadBytes`). `/api/uploads` sees one file at a time so it can only refuse a lone file already over that total; the total itself is checked at **`POST /api/jobs`** (`measureProductPayloadBytes` → `productPayloadRefusal`) and again in `fetchProductImages`. Adding a per-file cap on a different axis is how three 5 MB photos pass upload and die at a stage — with the reel row already created and the picker off screen.
- **Uncommitted.** The tree holds the v5 close-out. **Commit before the Studio runs.**

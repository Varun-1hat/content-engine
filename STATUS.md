# STATUS — Kiran Reels

**The living tracker.** State only: what's done, what's open, what to test.
For *why* any of it exists, read the v3 doc pack (`kiran-reels-docs-v3.zip`, user-held) — this file does not duplicate it.
⚠️ The pack predates the live vendor run below and is **stale** wherever the two disagree; this file wins.

| | |
|---|---|
| **Updated** | 2026-07-17 (HeyGen product-placement research — next-todo prep, no code changed) |
| **Branch** | `interface`, HEAD `186db26` — **uncommitted** |
| **Gates** | `tsc` 0 · `next build` 0 (28 pages) · assembly+plan harness **16/16** · generator contract **18/18** |
| **Live DB** | Supabase `oyxpwfpbfqcfbuklnsjq` · migrations `0001`–`0005` applied |
| **Vendors** | ✅ **ElevenLabs, HeyGen v3 and Veo all called live and passing** (2026-07-17) |
| **Deadline** | **2026-11-01** HeyGen v1/v2 retire — code is on v3 and **v3 is now proven**. Handled. |

**HeyGen product placement (R4): ✅ BUILT + verified end-to-end (Route B).** Presenter composited holding the product → HeyGen `type:'image'` lip-synced to our audio. Proven live (Kiran holding ZORBEX, mid-speech). Studio E2E for variant 3 is the only piece left — see §R4 and §5.

## Review checklist

| # | Item | Verdict | Reason |
|---|---|---|---|
| 1 | Gaps causing prod issues | ✅ pass | Every known blocker/major closed and verified. Residual risk is listed below, not silent. |
| 2 | Customizability | ✅ pass | 4-bucket model holds; model ids are DB columns, no redeploy. |
| 3 | Modularity & stage skipping | ✅ pass | Toggles → snapshot → one reader → 409. Text-source rule closed server-side. |
| 4 | All variants work individually & together | 🟠 near-pass | Variants 1 & 5 **rendered E2E through the Studio** (§2b). Variant 3 (Route B product placement) **built + proven live** (§R4), Studio run pending. Variant 6 not yet rendered. |

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

**None known.** Everything inventoried is fixed and verified, or listed below as an explicit, accepted residual.

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
| R11 | **Variant 6 never rendered** + **variant 3 (Route B) not yet run through the Studio.** | Both scheduled for the next Studio session. Route B mechanic already proven live (§R4); this is in-situ confirmation. |
| R12 | **Veo's safety filter blocks some generated b-roll prompts** (hit on variant 3, 3/3 retries). Content outcome, not a bug — but it means a reel can legitimately fail and need a re-run. | Vendor behaviour. The creative-director KB prompt is the lever if it recurs. |
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

**Avatar V (Avatar 5) — checked, does NOT change the fork.** Confirmed against `developers.heygen.com/avatar-v`: it's `type:'avatar'` + `engine:{type:'avatar_v'}` with **`script`+`voice_id`** (no `audio_url` documented — a mismatch with our ElevenLabs `audio_url` path). Its only reference inputs are **`motion_prompt`** and **`reference_look_id`** (another look of the *same* avatar) — **there is NO product/scene-image field in the API**. The "target scene image" on its marketing/research page is not an exposed API surface. It is **opt-in per look** (verify `avatar_v` in `supported_api_engines` via `GET /v3/avatars/looks/{id}`), $0.05/sec. Net: Avatar V is a higher-fidelity lip-sync engine only — it does not attach products, so it adds no "Route D".

**Recommendation:** Route B. **Decision needed from you before any code:** A (product, no voice), B (both, extra generation step), or C (voice, product only in b-roll)? Nothing gets built until you pick.

## 4. Deferred (by decision — triggers in doc pack `03`)

**`@google/generative-ai` (Node) is deprecated** — Python already uses the current `google-genai`. Works today; EOL risk. *Trigger: migrate to `@google/genai` before it breaks, or at the next Gemini change.* **Your call: log, don't migrate now.**

**Server-side "a product reel must show the product" check** — `features_product` stays model-driven. **Your call: leave it.** *Trigger: if real b-roll plans start omitting the product.*

Also deferred: 2nd visual provider (Seedance **2.0** — 1.0 has no audio) · per-client API keys · HeyGen webhooks · nano banana for all stills · publish-state lifecycle · caption burning · manual audio · script versioning · cost logging · non-9:16 · template decomposition · RAG.

## 5. Tests — status after the E2E run

| # | Test | Proves | Status |
|---|---|---|---|
| 1 | **Full Kiran reel (variant 1)** through the Studio | R1 + HeyGen avatar + overlay | ✅ **done** (§2b) |
| 2 | **`product_promo` (variant 5)** | M1 fix end-to-end, R2, R3 | ✅ **done** (§2b) — 100% narration, product preserved |
| 3 | **Variant 3 (avatar + product)** | Route B in situ (composite → `type:'image'` lip-sync). Mechanic already proven live (§R4). | ⬜ Studio run pending |
| 4 | **Variant 6 (product + music)** | concat, no-VO path | ⬜ Studio run pending |
| 5 | **Cleanup dry-run** (`{"apply": false}`) then R7 | Orphan predicate live. Read report before `apply:true`. | ⬜ not run |

## 6. Watch

- **Overlay tolerates gaps; concat does not.** The avatar shows through a gap; in concat a gap is deleted content. Any change to b-roll timing or assembly must keep that distinction. This was M1.
- **Vendor limits are only knowable by calling.** M11 (`negative_prompt` + refs = 400) was invisible to docs, types and `tsc`, and would have failed every product clip. The pack's "built vs works is exactly one test run" framing is what hid it.
- **Retry classification is evidence-based.** Veo's own words: filtered attempts are *"not charged"* and *"try again"* — and the identical call then succeeded. So content refusals retry; only contract/config errors are permanent (exit 2).
- **HeyGen: product-in-video and lip-sync are mutually exclusive in one call.** `cinematic_avatar` (product via `references`) has NO audio; `type:'avatar'`/`image` lip-sync but take one image. Getting both needs a pre-composited presenter+product still (Route B, §R4). Any future "just add the product to the avatar" request hits this wall — don't re-litigate it.
- **Vendor docs drift; in-code "only documented way" comments rot.** `heygen.ts:56` claimed background was the only route to a product — false within months. Re-check vendor capability before trusting an old code comment.
- **Uncommitted.** `0005` is already live and additive, but the tree holds all of v3 + this close-out **plus** today's research-only STATUS edits (no code touched this turn). **Commit before the Studio runs.**

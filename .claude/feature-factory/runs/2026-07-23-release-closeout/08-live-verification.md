# 08 — Live verification

> ## ⟳ ROUND 2 — 2026-07-24: live DB + nano banana authorized (video renders still held)
>
> **Criteria 33, 40, 43, 44 now PASS live.** Gates after: `tsc` 0 · `npm test` **110/110** · lint 170 = baseline · `build` ✓.
>
> ### Live DB (criteria 43, 44) — one throwaway job, created and deleted
> Created a real reel via the real `createJob` on the live project, ran a **hostile PATCH** against it, then deleted it. Confirmed zero residue (`select … where created_by='live-verify-round2'` → 0 rows).
>
> | Assertion | Result |
> |---|---|
> | `broll_frequency` persisted **at creation** as "Minimal" | ✅ — the R14 defect, closed at the DB level |
> | `product_overrides_research` captured at creation | ✅ `true` |
> | **Hostile PATCH** flipping the flag + `client_id` + `stage_plan` + `final_video_url` | ✅ **every server-controlled field held** |
> | …and the one ALLOWED field did change (`broll_frequency` → "High") | ✅ proves the patch really executed, not a silent no-op |
> | PATCH of *only* the behaviour flag | ✅ refused: `"No valid job fields in patch"` |
> | `jobClientMismatch` with a foreign client | ✅ **HTTP 403**, body `{"error":"Job does not belong to this client"}` — leaks no tenant id, no reel data |
> | Reel invisible under the foreign client | ✅ 0 rows |
> | `stage_plan` == pipeline stages (criterion 19 at DB level) | ✅ the toggle removed nothing |
>
> ### Nano banana (criteria 40, 33)
> **Criterion 40 ✅ — and visually confirmed.** The composite was produced from a **`.webp` persona** (the exact format that was being mislabelled `image/jpeg` on 3 of Kiran's 4 avatars) in 20.2 s → 1.9 MB. Inspected directly: Kiran's identity fully preserved (glasses, white shirt, office chair), holding the **actual white ceramic bowl of garlic pickle** at chest height, head-and-shoulders framing so the face stays clear for animation.
>
> **Criterion 33 ✅ to the render boundary** — `getPresenterImage` on a bogus id returns `null` in 1.1 s (not a throw); a null presenter short-circuits the composite to a plain talking head; and an unwritable destination now **rejects** (`Failed to write …: ENOENT`) with the process surviving — the item-6 fix is what makes that catch reachable at all.
>
> ### ⚠️ Environmental finding, worth recording
> **HeyGen's CDN is unreachable from this environment** — both `files2.heygen.ai` and `resource2.heygen.ai` `ECONNRESET` on download, while `api.heygen.com` (the metadata API) works fine and Cloudinary works fine. So criterion 40 could **not** be proven via a live end-to-end HeyGen presenter fetch here. What was proven instead: the presenter URL resolves its **real** extension (`.webp` for Casual, `.jpg` for Formal — item 8 working), and the composite succeeds from a real presenter still transcoded to webp. In production this path succeeded in v5, so this is a sandbox egress limitation, not a code defect — but it is also a live demonstration that the criterion-33 downgrade triggers exactly as designed when the CDN is unavailable.
>
> ### Two MINOR findings fixed in this round
> - **N2 (self-contradictory refusal).** `mb()` now rounds the MEASURED value **up** and a new `mbLimit()` rounds the LIMIT **down**, so an over-limit file always reads as the larger number. 12 MB + 1 byte was *"This photo is 12.0 MB … may total 12.0 MB"*; it now reads **12.1 MB vs 12.0 MB**. The `>` boundary is unchanged (exactly-at-limit still accepted) and a regression test pins it.
> - **`CLAUDE.md` staleness.** `# 32 tests` → `# 109 tests` + the no-glob warning; migrations `0001`–`0006` → `0001`–`0007`. Also folded in the three rules all three builders independently asked for: the **lint red baseline** (170, bar is *no new findings*), **caps belong to the adapter and must be enforced on their own axis**, and **logic that must be testable cannot live in a module importing ffmpeg/`next/server` at load**.

---

## Round 1 — TEXT + AUDIO only

**Date:** 2026-07-24 · **Spend: 6 Gemini calls + 1 ElevenLabs synth.**
No HeyGen render, no Veo clip, no nano banana composite, no assembly, no Cloudinary upload — inside the authorized ceiling exactly.

**Zero new assets created.** Reused the v5 product photo (`kiran/jobs/_incoming/product/pxvrso16skaylhbjvkif.webp`) and the v5 defect case (20 s target on the live `kiran` client), so this re-runs the *exact* scenario that produced a ~65 s script.

## Method, and what it does not cover

Each route's prompt construction was mirrored **verbatim** and the **real** adapters (`getScriptAdapter`, `getVoiceAdapter`) were called with the **real** client config and KB docs loaded from the live project via `loadClientConfig` — including the 9 739-char research doc that caused the original product-blindness, and the live `voice_prompt.md`.

**Not exercised:** the route shell — `requireUser()`, `forbidClientMismatch`, `stageNotInPlan`, `startStage`/`completeStage`, and the DB writes. Those are cookie-authenticated (`src/lib/auth.ts` uses `@supabase/ssr` cookie sessions), so they cannot be driven headlessly. They are covered by the unit suite (criterion 44 pins `filterJobPatch`; criterion 43's no-DB half pins `forbidClientMismatch`) and by `tsc`. The Studio-side halves remain `[studio]`.

---

## Results — all six criteria PASS

| Criterion | Result |
|---|---|
| **6** — adapt_voice states target + word budget | ✅ Duration block present; states the **20 s** target, the client's **2.5** words/sec, and the **50-word** budget it implies. Resolved via the real `resolveOrderedDurationSec`. |
| **7** — the 20 s → ~65 s defect | ✅ **FIXED, verified against real TTS.** v5: 1 850 chars ≈ 65 s. Now: 558 chars, estimated **19.2 s**, and ElevenLabs actually speaks it in **20.08 s — 0.08 s off a 20 s order**. `checkDurationDeviation` correctly returns no flag on both the estimate and the real duration. |
| **13** — toggle ON ⇒ topics on-product | ✅ **3/3** about the uploaded garlic pickle: pickle myths/facts, a problematic-ingredient warning, 3 common mistakes. |
| **14** — toggle OFF ⇒ unchanged | ✅ **0/3** on-product: monsoon fever signs, dehydration, baby massage. Reproduces the original defect exactly — which is what makes 13 meaningful rather than anecdotal. |
| **15** — precedence, never suppression | ✅ Research doc still present in full (9 739 chars). All three topics returned a `primaryTemplate`, `hookType`, `closeType` and `suggestedDuration`, and the array parsed. Kiran's pediatric persona survives *inside* the product topics ("for your family's diet", "young children"). |
| **21** — reword moved no behaviour | ✅ **Controlled A/B on identical inputs.** |

### The 13 / 14 A/B — same photos, same research doc, same model

Only delta: the 659-char precedence clause (prompt 14 384 vs 13 725 chars).

| Override | Topics about the product |
|---|---|
| **ON** | **3 / 3** |
| **OFF** | **0 / 3** |

### The 21 A/B — same script, same timestamps, same photo; only the rule wording differs

| | OLD wording (pre-reword) | NEW wording |
|---|---|---|
| entries | 2 | 2 |
| `product_image` stills | 0 | 0 |
| `features_product` videos | 1 | 1 |
| plain videos | 1 | 1 |
| **illegal `image`+`features_product`** | **0** | **0** |

Composition identical. The reword changed the *rationale* without moving the plan — precisely what criterion 21 required (a measurable shift would have been a **failure** of item 4).

---

## Two findings worth keeping

1. **The model's self-reported length is not trustworthy.** It reported `wordCount: 50, estimatedDuration: "20 sec"` where the actual text computes to **44 words / 19.2 s** — over-reporting by ~14%, on the very run that verified the duration fix. This is exactly why the Studio estimates from the live edit buffer and never from `script_meta` (decision 7). Recorded in STATUS §7 Watch.
2. **`speech_words_per_sec = 2.5` is well calibrated for the ADAPTED (Hinglish) script, not just English.** The estimator landed within **0.88 s** of real TTS output. This closes researcher OQ 5 / story OQ 6 — the single per-client rate is accurate for both, so **no second per-language column is needed**. Config finding, not a code change, exactly as brief §7 anticipated.

---

## Still unverified — by budget, never recorded as passing

| Criteria | Why |
|---|---|
| 1–5, 9, 16, 17, 35 | `[studio]` — no DOM/React harness (out of scope, story §4) |
| 10 (second half) | Needs a paid avatar render |
| 32 (full-reel regression) | Needs a full assembly |
| 33, 40 | Need a nano banana image-generation call |
| 43 | Needs the DB (cross-tenant `jobId` against each route) |

Final tally is unchanged in shape: **28 PASS · 0 FAIL · 19 CANNOT COVER** — but 6 of the 19 "live-text" items are now converted to hard evidence above, leaving the remainder genuinely blocked on either a DOM harness or vendor spend that was not authorized.

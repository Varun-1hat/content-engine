# 07 — Validation report

> ## ⟳ RE-VALIDATED AFTER REWORK ROUND 1 — final state
>
> **0 CRITICAL · 0 IMPORTANT · 2 new MINOR.** All three IMPORTANT findings below are **CLOSED in the code**, verified by reading it rather than the descriptions.
>
> | Finding | Status |
> |---|---|
> | IMPORTANT 1 — criterion 34 axis mismatch | ✅ **CLOSED.** One threshold decision (`productPayloadRefusal`, `>`); `fetchProductImages` delegates to it so the stage path is behaviourally identical; `api/jobs/route.ts:53-67` refuses **before** `createJob` at `:70`, so no row exists and the picker is still in reach. `/api/uploads:49-54` now states the reel-total axis, closing the criterion-36 strain. **The unmeasurable-photo path fails closed** — no branch returns `0`; `tryFetch` returning `null` makes `res?.ok` falsy and it throws. The 400 leaks no URL, no stack, no internal path. |
> | IMPORTANT 2 — STATUS.md stale | ✅ **CLOSED.** `:9` banner restated with the 28/0/19 tally · `:11` 109/109 · `:12` migrations `0001`–`0007` applied · watch item removed · **R17** at `:119` records the untestable `generate-broll-plan` hard-failure as unverified-with-reason (this also closes MINOR 6). |
> | IMPORTANT 3 — Architect double-click | ✅ **CLOSED.** `setIsProceeding(true)` is the first synchronous statement, flushed within the same discrete event; `proceedBusy` drives both `disabled` and the spinner/label, so no window renders enabled while work is pending. **Cannot strand — all four paths checked:** `persistBrollFrequency` cannot reject (its fetch is in `try{}catch{}`); both handlers' `if (!client) return;` early-returns still hit the outer `finally`; both are now awaited so the outer `finally` runs strictly after the inner one. |
>
> **No regressions:** `fetchProductImages`' stage behaviour, per-photo messages, MIME handling and return shape byte-identical · `checkNarrationCoverage` untouched (`0.95`, same message, still throws) · M1 axis untouched · `PATCHABLE_FIELDS` still nine keys · no new file entered the change set · `POST /api/jobs` keeps `requireUser` → `forbidClientMismatch` → `loadClientConfig` in order with the new checks after them.
>
> ### Two NEW minor findings from the rework
>
> **N1. Creation trusts a HEAD `Content-Length`; the stage measures the body.** `product.ts:128-132` vs `:195-196`. If a host's HEAD under-declares relative to its GET body, creation passes and the stage refuses — the criterion-34 shape on a much narrower path. `productImageUrls` is caller-supplied and not validated as originating from `/api/uploads`, so the URL need not be Cloudinary. Not reachable through the Studio. *Fixed looks like:* treat HEAD as advisory — read the body when the declared length is near the limit, or verify the declared total against the fetched total.
>
> **N2. At the boundary, the upload refusal reads as self-contradictory.** `product.ts:92-98` with `mb()` at `:100-102`. `mb()` is `.toFixed(1)`, so a 12 MB + 1 byte file yields *"This photo is 12.0 MB. A reel's product photos may total 12.0 MB … so this one file is over the reel's limit on its own."* Both numbers round to the same string for any file within ~50 KB of the ceiling. The old wording had no such artifact — **new drift from the reword**, cosmetic only. *Fixed looks like:* round the measured value up, or use two decimals within one rounding step of the limit.
>
> ### Earlier MINOR findings after rework
> 1 unchanged · 2 unchanged (`CLAUDE.md` still stale) · 3 unchanged · 4 unchanged · 5 unchanged · **6 FIXED** (R17). **None was made worse.**
>
> **One bounded note, stated for accuracy not as a finding:** two *programmatic* `.click()`s in the same tick would still re-enter, because the DOM `disabled` attribute applies at the end of the event. That is not a human double-click and is outside what the finding described.

---

## Original round-1 report (superseded above, kept for the record)

**0 CRITICAL · 3 IMPORTANT · 6 MINOR.** Findings verified by reading the code, cited at line.

## Directed checks — all pass

| # | Check | Verdict |
|---|---|---|
| 1 | Scope contract (brief §8) | ✅ Every modified/new product file appears in §8. `audio.ts:3,23-25` falls inside §8's explicit carve-out and preserves documented output. **Nothing** on the "Explicitly NOT changing" list was touched. Backend never touched `page.tsx`/`components/`; frontend touched only its two files. *(Two test files outside §8 — MINOR 1.)* |
| 2 | **The M1 axis** | ✅ **CORRECT.** `assemble-video:43` keys the outer branch on `plan.includes('avatar')`; `orderedDurationSec` passed only in the concat arm (`:161-167`); `overlayBrolls` gains no guard. Guard is inside `concatBrolls` (`assembly.ts:178-179`), returns a string, never thrown. The inner `if (audioPath) … else …` is a *yardstick* selection inside already-`noAvatar` territory, **not** a `noAudio` re-keying — both arms demand tiling, satisfying story edge case 9. |
| 3 | `PATCHABLE_FIELDS` not widened | ✅ Same nine keys (`jobs.ts:54-64`); flag absent with reason at `:48-53`; written once at `:127`; read only off the row in `generate-topic:45`. |
| 4 | Two-sided rule | ✅ `duration.ts:120-127` uses `Math.abs(deviation) > TOLERANCE`, words it "over"/"under". `checkDurationOvershoot` exists nowhere in `src/`. Boundaries pinned at `tests/duration.test.ts:123,128`. **Undershoot does flag.** |
| 5 | `checkNarrationCoverage` untouched | ✅ Threshold still `0.95`; message text unchanged; `assembly.ts:168-169` still throws. Seven original cases verbatim. Only the comment changed (decision 17). |
| 6 | Content refusals retryable | ✅ `nanobanana_generator.py:212` uses default `retryable=True`. Only the SDK wrapper (`:191-203`) classifies via `is_retryable_api_error`, `False` for 400–499 except 429. |
| 7 | No duplicated logic | ✅ `wordBudgetFor` **replaced** the inline formula (no second copy exists). `stripUnspokenMarkup` **extracted**; `audio.ts:24` delegates and holds only the whitespace collapse. |
| 8 | Per-model caps | ✅ `MAX_IMAGE_BYTES`/`MAX_IMAGES` return **no matches** under `src/`. All five call sites read from adapters. `product.ts:72-82` requires both options with no defaults. |

**Security / multi-tenancy / patterns / timezone: clean, stated explicitly.** All nine touched routes keep `requireUser()` → `forbidClientMismatch` → inline ownership → `stageNotInPlan` in order. `ui-config` adds two plain numbers, no vendor id. No slug/client-id branching under `src/`. No new timestamp or date logic — correctly not applicable.

---

## CRITICAL — none
No security hole, no tenant-isolation gap, no data-loss risk, no unimplemented criterion.

---

## IMPORTANT — 3

### 1. Criterion 34 not satisfied server-side — the two surfaces measure different axes
`src/app/api/uploads/route.ts:46` · `src/lib/pipeline/product.ts:124-127` · `src/app/api/jobs/route.ts:35-43`

`/api/uploads` enforces 12 MB **per file**; `fetchProductImages` enforces 12 MB as a **per-reel total**; `POST /api/jobs` checks count only. Three 5 MB photos each pass upload, the reel is created, and the first stage that attaches photos throws — **verbatim criterion 34's failure condition**. Only the browser-side pre-check at `page.tsx:335-345` prevents it, and a client-side check is not an enforcement boundary in a codebase whose stated posture is that every guard is application-level. The reel is a dead end once it happens: photos live on the row and the picker is setup-screen-only, so the user must start over.

**Ruling on residual A: genuine gap, IMPORTANT.** Not CRITICAL — the number, its adapter source and its statement before the picker are all correct, the failure is loud and named, and no vendor spend is burned (`fetchProductImages` throws before `script.generate`). Not MINOR — the criterion's own failure mode is reachable through the server with no client cooperation. Also strains 36: the Studio states a *reel total* (`page.tsx:862`) while `/api/uploads:48` refuses with a *per-file* message.

**Fixed:** one total-bytes check on the same axis server-side — sum the reel's photo bytes at `POST /api/jobs` and refuse with `productPayloadLimitMessage`.

### 2. `STATUS.md` contradicts the state it tracks
`STATUS.md:9, :11, :12, :190`

Line 12 still says `0007` "written, **NOT yet applied**" and line 190 "must be applied before the next Studio run" — **it is applied**. Line 11 says `npm test` 75/75 — it is **103/103**. Line 9's banner says "backend half built"; the frontend half is built. Line 12 still lists migrations `0001`–`0006`.

Violates criterion 47 and `CLAUDE.md:147-148` ("Update it when state changes"). The *structure* criterion 47 needs is present (NOT-PROVABLE table, R14 closed, R15/R16 added) — this is staleness of fact, not absence of record. Not CRITICAL: acting on the stale line would re-run an additive `add column`, which errors harmlessly.

**Fixed:** gates → 103/103; migrations → `0001`–`0007` applied; drop the "must be applied" watch item; restate the banner as the full close-out.

### 3. The Architect "Continue" button is clickable for one round trip, and the next thing it does is spend
`src/app/page.tsx:573-577` (button at `:1372-1375`)

```ts
const proceedFromArchitect = async () => {
  await persistBrollFrequency();
  if (hasStage("audio")) handleGenerateAudio();
  else handleGenerateVideoPipeline();
};
```
The only guard is `disabled={isGeneratingAudio || isGeneratingVideoPipeline}`. Both flags are set **inside** the dispatched handlers (`:531`, `:581`) — i.e. *after* the awaited PATCH resolves. For that round trip the button renders enabled and a second click re-enters. **Two ElevenLabs renders** on the audio path; two HeyGen/Veo pipeline runs on the no-VO path.

**Ruling on residual C: real defect, NEWLY INTRODUCED by this change, IMPORTANT.** The brief's premise ("the existing `disabled` covers it") is **factually wrong in this code** — it covered it *before* the await was inserted, because the flag was then set synchronously in the same handler. The cited precedent is not equivalent: `persistScriptEdits`' callers do `setStep(3)`/`backToHome()`, which are idempotent and free. This is the only place in the file where an awaited persist gates a **paid** dispatch.

**Fixed:** set the in-flight flag before the await (or a dedicated `isProceeding` state) so the button is disabled from the click.

---

## MINOR — 6 (reported, not auto-fixed)

1. **Two test files outside §8's contract** — `tests/release-closeout.acceptance.test.ts`, `tests/helpers/node-resolve.mjs`. Both test-only and additive; helper does no stubbing, acceptance file imports only `node:*` + product modules, all HTTP on `127.0.0.1`. Fix: add both rows to §8.
2. **`CLAUDE.md` stale** — `:26` says `# 32 tests` (now 103), `:36` says `0001`–`0006` (now `0007`). Violates CLAUDE.md's own "fix the rule in the same change". Correctly *not* touched by builders (not in §8) — orchestrator-level.
3. **`generate-broll-plan:197` persists the raw body value** — `broll_frequency: brollFrequency ?? null` skips `normalizeBrollFrequency` and an absent field nulls the column item 1 exists to keep populated. Not reachable through shipped UIs; brief §3 item 1 step 5 declared this line unchanged. Fix: `normalizeBrollFrequency(brollFrequency ?? job.broll_frequency)`.
4. **Inline `.jpg` guess survives beside its replacement** — `generate-avatar:61` and `assemble-video:76` keep `path.extname(...) || '.jpg'` for product photos while `:50` correctly uses `extensionFromUrl` for the presenter. Deliberate per the backend summary; recorded as a near-duplicate on the exact class of path M12 came from.
5. **Server-absolute temp path reaches the browser** — `download.ts:95` puts `destPath` (an absolute host path) into an error that travels via `failStage` into `job.error` and the 500 body. Substance is correct per criterion 30; naming the absolute path is incidental. Consistent with pre-existing route habit — drift, not a new class of leak.
6. **The new `generate-broll-plan` hard-failure path is unrecorded** — the 500 at `:147-151` (approved at GATE 2 amendment 5) appears in neither the PASS nor CANNOT COVER table. `resolveOrderedDurationSec → null` is unit-pinned; the route branch is untestable here. Gap in the record, not the code; criterion 47 wants exactly one of two states.

---

## Summary
Categories 3 (security), 5 (patterns), 7 (timezone) and 8 (multi-tenancy) are **clean, stated explicitly not by omission**. Category 6 (duplicate logic) clean on both named items. Category 4 clean on product code — only two additive test files deviate. Category 1 has one partially-satisfied criterion (34); category 2 one recording gap.

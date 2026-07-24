# 06 — Acceptance verification

> ## ⟳ RE-VERIFIED AFTER REWORK ROUND 1 — this header supersedes the run below
>
> ```
> 1..109
> # tests 109   # pass 109   # fail 0   # cancelled 0   # skipped 0   # todo 0
> ```
> Per file: `coverage` 14 · `stages` 17 · `generators` 11 · `duration` 18 · `product` 13 · `download` 6 · `release-closeout.acceptance` 30. Zero `not ok` lines.
> Gates: `tsc` 0 · lint 170 = baseline exactly, zero new · `build` ✓ compiled successfully.
>
> **Final tally unchanged in shape, stronger in substance: 28 PASS · 0 FAIL · 19 CANNOT COVER = 47.**
>
> **Criterion 34 is now closed SERVER-SIDE**, verified by reading the route: `api/jobs/route.ts:53-67` measures the reel's whole photo set and refuses **before `createJob` is called** (`:70`), so no row is created and the user is still on the setup screen with the picker in reach. Same number on both sides (both read `maxInlineImagePayloadBytes` off the same adapter), same photo set (count refusal caps at 3 first; `fetchProductImages` slices by the same number), same rule (both funnel through `productPayloadRefusal`, `>`, so exactly-at-limit is accepted either side).
> The new tests **prove** rather than restate: `34 [creation half]` drives the **real** `measureProductPayloadBytes` over a real socket, establishes the boundary empirically (totals 3 photos to 1200 B, shows the real `fetchProductImages` accepts at exactly that and refuses at −1), asserts the creation refusal string is **byte-identical** to what the stage throws, and pins that an unreadable photo **throws** rather than counting as zero — the failure mode that would have silently re-opened the gap.
> **Criterion 36 strengthened:** the old `"File exceeds 12 MB"` (which read as a second, per-file limit) is gone.
>
> **No regression:** all 28 original acceptance assertions intact and unweakened (file diffed). The **32 original pinned cases are intact** — `git diff` across the three originally-tracked test files shows exactly **one** deleted line, an import statement replaced by a wider one. Zero cases deleted, zero assertions weakened. 32 → 42 in those three files, all passing.
>
> **Two narrow residuals replace the round-1 finding** (both far smaller, neither a FAIL): creation measures HEAD's declared `Content-Length` while the stage measures decoded body bytes (agree for Cloudinary-delivered images; a gzipping CDN could under-count); and reels created *before* this change whose photos already exceed the limit will still meet the stage refusal (pre-existing data, not a new path).
>
> **Scope note for the record:** the backend-engineer edited `tests/release-closeout.acceptance.test.ts`, the verifier's own file. Every one of the 28 assertions was verified intact and the two additions are honest behavioural tests — not raised as a finding, but the verifier's file being writable by a builder is worth a rule.

---

## Original round-1 run (superseded above, kept for the record)

**Test run (verbatim):**
```
1..103
# tests 103
# suites 0
# pass 103
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 35004.7739
```
Per file: `coverage` 14 · `stages` 17 · `generators` 11 · `duration` 18 · `product` 9 · `download` 6 · `release-closeout.acceptance` 28. **All 32 original pinned cases present with unchanged names, assertions and verdicts.**

Gates: `npx tsc --noEmit` exit 0 · `npm run lint` 170 problems = the verified 170 baseline, **zero new** · `npm run build` ✓ compiled successfully.

New files (tests only — no product code touched): `tests/release-closeout.acceptance.test.ts`, `tests/helpers/node-resolve.mjs`, plus the one `package.json` test-script line.

**Tally: 28 PASS · 0 FAIL · 19 CANNOT COVER = 47.**
*(The verifier's own headline said 21/17; its tables are complete and correct — this is the corrected count.)*

---

## PASS — 28

| # | Proved by |
|---|---|
| 6 | Budget moves with the client's configured rate (2.0/2.5/3.0) and with the target; no block when duration is unresolvable. *(unit half; composed prompt is `[live-text]`)* |
| 8 | Real chain `estimateSpokenScript → checkDurationDeviation`; 300-word flags naming 120.0s vs 20s, 45-word does not |
| 8 / decision 4 | **Two-sided ±5 s: −5.1 flags · −5.0 silent · +5.0 silent · +5.1 flags.** "under"/"over" wording asserted; `checkDurationOvershoot` confirmed **absent** |
| 11 | Tied to the **real `prepareScriptForTts`**: header + `[direction]` stripped before the vendor; `<break>`/`<emphasis>` survive as time |
| 12 | null/undefined/0 target across 5 estimates; pipeline-default fallback; `null` never a literal |
| 18 | Composed topic prompt **byte-identical** with no photos, flag on or off, and with photos + flag off |
| 19 | Every preset × voiceover{∅,T,F} × injectScript{∅,T,F}, plus `getJobStagePlan` read-back — toggle changes no stage membership |
| 20 | Inspection: the "CANNOT be conditioned" claim is gone; the operative rule intact verbatim |
| 22 | Inspection: deferred-design comment **at** the prompt block **and** `STATUS.md` §3 **R15** — decision 10's "both places" |
| 23 | Real `veoImagenVisualAdapter.generateClip` routes a still-with-refs to nano banana (exit 2, "cannot be retried"), **not** Imagen; no vendor call |
| 24 | **Real `concatBrolls` + real ffmpeg**: contiguous no-VO plan → warnings `[]`, reel produced |
| 25 | Gappy plan (0–1, 5–6, 10–11 vs 15 s) → warning names 15.0s and 3.0s **and the reel still ships**; returns a string, never throws |
| 26 | **The M1 axis.** Real `overlayBrolls` on a deliberately gappy plan succeeds, no warning channel; a **voiceover** concat reel with `orderedDurationSec: 60` emits nothing — never judged twice (edge case 9) |
| 27 | The M1 shape still **throws** through real `concatBrolls` ("covers only 1.0s of the 3.0s voiceover"), no output; threshold 0.95 and all verdicts re-asserted |
| 28 | `null`/`undefined`/`0`/`NaN` → `null`, **and** a real concat run with `orderedDurationSec: null` warns nothing |
| 29 | **Child process exits 0** — decision 13's uncaught-exception kill is gone; stdout `REJECTED … Failed to write`; no `uncaughtException` on stderr |
| 30 | Two unwritable classes (ENOENT dir, EISDIR); message names destination + OS code, never "Command failed"; pre-existing directory not destroyed |
| 31 | **Story edge case 12**: 20 000 bytes written, socket dropped mid-body → rejects, destination does **not** exist |
| 32 | *(single-download half)* 40-chunk 327 680-byte body byte-identical. **Full-reel regression NOT verified — budget.** |
| 34 | Real `fetchProductImages` over localhost: exactly-at-limit accepted, +1 byte refused, 3×400 B over a 1000 B total refused, same 3 accepted at 1200 B. **See residual 1 below.** |
| 36 | *(unit half)* `Math.floor(bytes/1024/1024)*1024*1024 === bytes` — 12 MB lossless both ways, so the stated number cannot under- or over-promise |
| 37 | *(enforcement half)* 5 URLs, adapter's `maxReferenceImages` (3) reach the model |
| 38 | Full chain: URL ext → Content-Type fallback through a **real download** of an extensionless path (`.webp`, not `.jpg`) → **cross-language** into Python `reference_mime_type("presenter.webp") == image/webp` |
| 39 | Extensionless + `application/octet-stream`/`null`/`undefined`/`text/html` → all `null`; a real extension still beats a wrong Content-Type |
| 41 | Asserts **every `tests/*.test.*` on disk is listed in `package.json`'s test script** and every listed file exists. 32 → 103. The regression pin for the no-glob failure mode |
| 42 | tsc 0 · lint 170 = baseline, zero new · build ✓ |
| 44 | Real `filterJobPatch` strips `product_overrides_research`, `stage_plan`, `client_id`, `pipeline_id`, `current_stage`, `stage_status`, `final_video_url`, `provider_job_ids`, `audio_url`, `avatar_video_url`, `broll_plan`; keeps only `broll_frequency`. Real `updateJob` throws **before any DB access** |
| 45 | `grep -rE "(slug\|client_id\|clientId)\s*===\s*['\"]" src/` returns nothing |
| 46 | **Zero vendor calls made.** ffmpeg/ffprobe are local static binaries; all HTTP is localhost; the one Python invocation exits on its argument contract before any API call |

## FAIL — none. Nothing was weakened to get there.

## CANNOT COVER — 19

| # | Why | What would close it |
|---|---|---|
| 1–5 | `[studio]` — no DOM/React harness (out of scope, story §4); `createJob`'s write needs the DB | Drive the Studio; read the reel record before `broll_plan` runs |
| 7 | `[live-text]` | One live `adapt_voice` run; amendment 2 sets the bar |
| 9 | `[studio]`. Pure half pinned: trimming clears the flag because the estimate is a function of the text | Type in the Studio editor, watch the badge |
| 10 | Frontend half `[studio]`; **avatar/assemble half NOT PROVABLE — paid render** | Studio click-through + a paid render |
| 13, 14, 15 | `[live-text]` — the clause's *shape* is pinned; whether the model *obeys* it is not | Three live `topic` runs (in budget) |
| 16, 17 | `[studio]` | Studio + an admin retry |
| 21 | `[live-text]` before/after comparison. **`npm test`, `tsc`, `lint`, `build` are all blind to this** | A `broll_plan` run diffed against a pre-reword plan |
| 33 | **NOT PROVABLE — the composite is an image-generation call, out of budget.** Partial: `downloadToFile` now rejects instead of killing the process, which is what makes the existing catch reachable at all | A nano banana call |
| 35 | `[studio]`. Inspection confirms it is printed above the picker | Look at the setup screen |
| 40 | **NOT PROVABLE — needs a nano banana call** | One image-generation call |
| 43 | Needs the DB. Partial pinned: `forbidClientMismatch` 403s a foreign client with a body echoing **no tenant id**; `stageNotInPlan` 409s with `["error"]` only | A cross-client `jobId` against each touched route on the live DB |
| 47 | `[inspection]`, and depends on this round's outcome | Orchestrator updates STATUS after this report |

---

## Residuals for the orchestrator (not criterion failures)

1. **⚠️ Criterion 34 residual — the two surfaces measure different axes.** `/api/uploads` enforces 12 MB **per file**; `fetchProductImages` enforces 12 MB **per reel total**. Server-side, three 5 MB photos each pass upload and the reel is then refused at the topic stage — literally "accepted at upload, then rejected for size by a stage". The **only** thing closing it is the Studio's client-side pre-upload total check (`page.tsx:335-345`); `POST /api/jobs` has no total-bytes check. This is what brief §3 item 7 designed and the gate approved, so it was not scored a FAIL — but it is a real server-side gap. Related: `hydrateFromJob` restores `productUrls` but resets `productBytes` to `[]`, so the running total under-counts on a resumed reel (currently unreachable — the picker is setup-screen-only). Owner if pursued: **backend-engineer**.
2. **`/api/uploads` measures the uploaded file; `fetchProductImages` measures the bytes Cloudinary serves back.** If Cloudinary ever re-encodes, the two diverge. Untestable here; watch line.
3. **`STATUS.md` is stale on two facts** — it still says `0007` is "written, NOT yet applied" (it **is** applied) and `npm test` 75/75 (now **103/103**). `CLAUDE.md`'s "32 tests" is also stale. **Criterion 47 depends on this file being right.** Owner: **backend-engineer**.
4. `tests/helpers/node-resolve.mjs` must never be added to the test script — it holds no tests. The criterion-41 assertion is scoped to `*.test.*` so it will not demand it, and still fails loudly the day a real test file is forgotten.
5. Frontend's open item — double-click window on the Architect Continue button → possible double ElevenLabs spend — untestable here, open for final review.

**Verifier's verdict:** the implementation satisfies the story to the limit of what is provable this round — zero failures, and nothing unprovable is recorded as passing.

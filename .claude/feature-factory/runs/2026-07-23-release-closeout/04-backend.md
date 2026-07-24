# 04 — Backend implementation summary

**Gates (independently re-verified by the orchestrator, not taken on trust):**
`npx tsc --noEmit` exit 0 · `npm test` **75/75 pass** (baseline 32) · `npm run lint` 170 problems — **identical to the stashed HEAD baseline of 170**, so net delta zero, all pre-existing `@typescript-eslint/no-explicit-any`. `npm run build` passes, 27 API routes.

**Migration `0007` HAS BEEN APPLIED** to `oyxpwfpbfqcfbuklnsjq` by the orchestrator and verified live:
`product_overrides_research | boolean | NOT NULL | default false`.

---

## 1. Files added or edited

**New**
- `supabase/migrations/0007_product_override_research.sql` — adds `jobs.product_overrides_research boolean not null default false`.
- `src/lib/pipeline/broll.ts` — `BROLL_FREQUENCIES` / `DEFAULT_BROLL_FREQUENCY` / `normalizeBrollFrequency`, the server-side label allowlist `createJob` needs.
- `src/lib/pipeline/duration.ts` — pure: `stripUnspokenMarkup`, `estimateSpokenScript`, `wordBudgetFor`, `resolveOrderedDurationSec`, `checkDurationDeviation`, `DURATION_DEVIATION_TOLERANCE_SEC`. Imports nothing.
- `src/lib/pipeline/download.ts` — `downloadToFile` (now rejects on write failure, deletes the partial), `extensionFromUrl`, `extensionFromMimeType`.
- `tests/duration.test.ts` (18 cases), `tests/product.test.ts` (9), `tests/download.test.ts` (6).

**Edited**
- `src/lib/jobs.ts` — `JobRow.product_overrides_research`; `CreateJobOpts` takes `brollFrequency` + `productOverridesResearch`; both written in the insert; comment on why the flag is **not** in `PATCHABLE_FIELDS` (allowlist unchanged).
- `src/lib/pipeline/coverage.ts` — `MIN_ORDERED_DURATION_COVERAGE` + `checkOrderedDurationCoverage`; stale `:18` comment corrected. `checkNarrationCoverage` byte-identical.
- `src/lib/pipeline/assembly.ts` — `downloadToFile` removed; `concatBrolls` takes `orderedDurationSec` and returns `{ warnings }`; guard in the no-voiceover arm only. `overlayBrolls` untouched.
- `src/lib/pipeline/product.ts` — `productPrecedenceBlock`, `productPayloadLimitMessage`; `fetchProductImages(job, { maxImages, maxTotalBytes })` enforces a **per-reel total**; `MAX_IMAGE_BYTES`/`MAX_IMAGES` deleted; stale `:5-7` comment corrected.
- `src/lib/pipeline/audio.ts` — `prepareScriptForTts` delegates to `stripUnspokenMarkup`; output byte-identical (pinned by a test).
- `src/lib/adapters/script/base.ts` / `gemini.ts` — `ScriptAdapter.maxInlineImagePayloadBytes`; Gemini = `12 * 1024 * 1024` with the 20 MB-whole-request ÷ ×4/3-base64 derivation in a comment.
- `src/lib/generators/base.py` — shared `MIME_BY_EXT` / `reference_mime_type` and `api_error_status` / `describe_api_error` / `is_retryable_api_error`.
- `src/lib/veo_generator.py` — imports all six from `generators.base`; local copies removed. `from veo_generator import reference_mime_type` still resolves (pinned test green).
- `src/lib/nanobanana_generator.py` — uses shared `reference_mime_type`; `generate_content` wrapped so an API 4xx except 429 exits **2**. The "model returned no image" content refusal is **unchanged and still retryable**.
- Routes: `jobs`, `generate-topic`, `generate-english`, `generate-hinglish`, `generate-broll-plan`, `generate-avatar`, `assemble-video`, `uploads`, `clients/[id]/ui-config`.
- `STATUS.md` — R14 closed, **R15** added (deferred product-still question), **R16** added (warnings not persisted), gates line → 75/75, plus the explicit NOT-PROVABLE list.
- `package.json` — the `test` line now lists all six files.

---

## 2. THE API CONTRACT — build the frontend against this, do not guess

### `POST /api/jobs` — MODIFIED
```ts
{ clientId: string; pipelineId: string;
  voiceover?: boolean;                  // default true
  injectedScript?: string;
  productImageUrls?: string[];
  brollFrequency?: string;              // NEW — "Minimal" | "Standard" | "High"
  productOverridesResearch?: boolean }  // NEW — default false
```
Success `201 { job }` — shape unchanged. `job.broll_frequency` is now **always** the normalised choice from the moment the row exists; `job.product_overrides_research` is a `boolean`.

Server rules: `brollFrequency` is normalised against the allowlist — anything unrecognised, wrong-cased (`"minimal"`), non-string, or absent silently becomes `"Standard"`, **never a 400**. `productOverridesResearch` is stored `true` only when it is exactly `true` **and** `productImageUrls.length > 0`; otherwise `false`.

Errors (all unchanged): `400` missing `clientId`; `400` missing `pipelineId`; `400` photo count over `maxReferenceImages`; `400` `PIPELINE_INVALID`; `400` `PLAN_INVALID`; `401`; `403`; `404` unknown/inactive client; `500`.

### `GET /api/clients/[id]/ui-config` — MODIFIED
Gains exactly two top-level fields, both plain numbers, both always present:
```ts
{ …existing…,
  speechWordsPerSec: number,            // NEW — e.g. 2.5
  productImagePayloadLimitMb: number }  // NEW — whole MB, currently 12
```
`productImagePayloadLimitMb = Math.floor(maxInlineImagePayloadBytes / 1024 / 1024)` — the exact number `/api/uploads` and `fetchProductImages` enforce. `productImageLimit` (the photo **count**) is unchanged. No vendor id, model name or provider slug added.

### `POST /api/assemble-video` — MODIFIED
Request unchanged. Success response gains one field:
```ts
{ success: true; finalVideoUrl: string;
  failedClips: { index: number; reason: string }[];
  warnings: string[] }   // NEW — [] on a clean run, always present
```
`warnings` is populated **only** in concat mode **and only when the reel has no voiceover**. It never changes the status code — the reel shipped. Not persisted; a resumed reel will not re-show them (R16).

### `POST /api/uploads` — MODIFIED
Request/response unchanged. Only the size rejection changed: message is now `` `File exceeds ${n} MB` `` where `n` is the adapter-derived whole-MB limit (**12**, not 20). The size check now runs *after* the client lookup, so an unknown client yields `404 'Client not found'` first. Other errors unchanged.

### `POST /api/generate-hinglish`, `POST /api/generate-topic` — MODIFIED (prompt only)
Request/response shapes, guards and errors **all unchanged**. `generate-topic` reads `product_overrides_research` **from the job row and never from the body** — sending it in the body has no effect.

### `POST /api/generate-broll-plan` — MODIFIED
Request/response unchanged. **New failure condition:** in concat mode (`noAvatar`) with neither a narration timeline nor a resolvable ordered duration, the stage fails `500` instead of tiling against a hardcoded 45 s. Only reachable on a reel whose `pipeline_id` is orphaned.

### `PATCH /api/jobs/[id]`, `GET /api/jobs/[id]`, `GET /api/jobs` — UNCHANGED
Route files untouched, `PATCHABLE_FIELDS` untouched. `broll_frequency` is already allowlisted, so the Architect-screen PATCH works with **no server change**. `product_overrides_research` is **filtered out** of a PATCH; a PATCH containing only that field yields `400 "No valid job fields in patch"`.

### Pure helpers the frontend imports directly
```ts
// src/lib/pipeline/duration.ts
estimateSpokenScript(script: string, wordsPerSec: number): { words: number; seconds: number }
checkDurationDeviation(estimatedSec: number, targetSec: number | null | undefined): string | null
resolveOrderedDurationSec(job, pipelines): number | null
DURATION_DEVIATION_TOLERANCE_SEC: 5

// src/lib/pipeline/broll.ts
BROLL_FREQUENCIES: readonly ['Minimal','Standard','High']
```
**Naming, per GATE 2 amendment 1:** the exported name is **`checkDurationDeviation`** — the check is TWO-SIDED. `checkDurationOvershoot` does not exist. It returns a message when `|estimated − target| > 5` in **either** direction (a 20 s target at 12 s flags exactly as one at 27 s does), and `null` for a null/undefined/non-positive target.

---

## 3. Helpers reused

`supabaseAdmin()`, `loadClientConfig()`, `getJob`/`startStage`/`completeStage`/`failStage`/`updateJobInternal`/`stageNotInPlan`, `requireUser`/`forbidClientMismatch`, `getScriptAdapter`/`getVisualAdapter`/`getStorageAdapter`/`extractJson`, `getJobStagePlan`, `hasProduct`/`productBlock`, `checkNarrationCoverage`, `lastTimestampEnd`, `generators.base.fail`/`load_env`/`parse_cli_args`.

Overlap justified: `stripUnspokenMarkup` is the stripping half of `prepareScriptForTts`, **extracted not duplicated** (a test pins the composition byte-for-byte). `checkOrderedDurationCoverage` is a sibling of `checkNarrationCoverage`, not a replacement — different input, different severity, mutually exclusive arms. `downloadToFile` is the same function moved out of `assembly.ts` (which imports ffmpeg at module load, making it untestable) and fixed. `wordBudgetFor` replaced `generate-english`'s inline copy rather than adding a second one.

---

## 4. Not built / flagged

- **`src/app/page.tsx` and `src/components/ScriptDisplay.tsx`** — frontend-engineer's scope. Untouched, confirmed by `git status`.
- **ACCEPTED JUDGEMENT CALL (orchestrator reviewed and upheld):** brief §3 item 5 step 3 reads as an unconditional `checkOrderedDurationCoverage` call inside `concatBrolls`; the builder gated it on `!opts.audioPath` (no-voiceover only). Upheld because CLAUDE.md states that in concat mode the yardstick is `lastTimestampEnd` — **the real TTS end, not the target duration** — so judging a variant-5 (voiceover concat) reel against its ordered duration would emit a false alarm whenever the script came out shorter than ordered; and story edge case 9 explicitly requires such a reel "must not be judged twice". Written as an if/else pair, still inside `concatBrolls` where it cannot be bypassed.
- **`CLAUDE.md`'s "32 tests" line is stale** (now 75). Out of the builder's scope list; the orchestrator will correct it.
- **Deliberate one-byte behaviour change** (brief §7): nanobanana now maps `.gif` → `image/gif` instead of `image/jpeg`. Strictly more correct, practically unreachable.
- **Left alone on purpose:** the product-photo extension lines at `assemble-video:74` and `generate-avatar:43` keep their inline `path.extname(...) || '.jpg'` — switching them to `extensionFromUrl` would change behaviour for non-image extensions, which no criterion asks for.

---

## 5. CLAUDE.md gaps the builder hit (for the final review — do not fold in unasked)

1. **No rule about lint's baseline state.** Lint has 168 pre-existing `no-explicit-any` errors, so "lint must pass" is unachievable and an agent cannot distinguish a rule violation from inherited noise without building a worktree at HEAD and diffing. Suggest recording the bar as *"no new findings"* against a stated baseline.
2. **"Do not hardcode model ids or keys" doesn't cover *limits*.** Decision 18 (caps are per-model) exists nowhere in CLAUDE.md, which is why the tree carried three conflicting numbers (8 MB / 4 / 3). Suggest: *"A vendor limit belongs to the adapter that has it, read at the call site — never a module constant in `pipeline/*`."*
3. **Nothing warns that `assembly.ts` imports ffmpeg at module load**, which silently makes anything exported from it untestable by the dependency-free suite. That single fact is why `downloadToFile` had no test for its process-killing bug.

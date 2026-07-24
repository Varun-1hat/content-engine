# 05 — Frontend implementation summary

**Gates:** `npx tsc --noEmit` exit 0 · `npm run lint` 170 problems — **unmoved from the 170 baseline**, per-file identical too (`page.tsx` 19 errors + 1 warning before and after; `ScriptDisplay.tsx` 1 error before and after), **zero new findings** · `npm test` 75/75 · `npm run build` compiled successfully, 28 pages/routes.

**API contract mismatch: NONE.** Every field the UI needed existed with the name and shape the backend contract stated.

---

## 1. Files edited (exactly two — scope respected)

- `src/app/page.tsx` — setup-screen B-roll frequency picker and product-priority toggle; `openSetup` now resets frequency/avatar/target duration; stated photo-payload limit + pre-upload total-bytes check; `brollFrequency` + `productOverridesResearch` in the create-reel body; `broll_frequency` PATCH on leaving the Architect room; blueprint "Product priority" line; assemble warnings on the Final screen; `product_overrides_research` restored by `hydrateFromJob`; new props to `ScriptDisplay`.
- `src/components/ScriptDisplay.tsx` — words and spoken duration computed from the live edit buffer, shown against the target, with the non-blocking two-sided deviation badge.

`git status` confirms no other file entered the modified set.

---

## 2. Criteria satisfied (story §2 numbering)

- **1, 5** — frequency chosen on the setup screen, travels in `POST /api/jobs`, so the row carries the user's choice from the instant it exists; `openSetup` resets it so no reel inherits another's.
- **2, 3, 4** — the Architect chip persists via `PATCH /api/jobs/[id]` before dispatch, so retry/resume/admin-retry read the user's value.
- **8, 9, 12 (Studio halves)** — `Words:` / `Duration:` recomputed from `editValue` on every keystroke, shown next to `Target: {n}s`, amber badge outside ±5 s, no target line at all when `targetSource === 'none'`.
- **10 (to the authorized boundary)** — the badge is a `<p>`; no `disabled`, no navigation guard, no stage call references it.
- **16, 17, 18** — toggle sits with the voiceover/inject toggles, renders only when `productUrls.length > 0`, defaults OFF, captured at creation, inspectable afterwards on the blueprint screen.
- **35, 36, 37** — the MB limit is printed *above* the file picker from `client.productImagePayloadLimitMb`, the same number is used in the pre-upload total-bytes refusal, and the count check + its `alert()` are byte-identical to before.
- **45** — every new conditional derives from `hasStage()` / `pipelineHasStage()`; no slug or client-id branching.
- **Item 5's Studio half** — assemble warnings render as a non-blocking amber note above the video; the reel still shows.

---

## 3. Endpoints consumed — all matched

| Endpoint | Used for | Matched |
|---|---|---|
| `GET /api/clients/[id]/ui-config` | `speechWordsPerSec`, `productImagePayloadLimitMb` | ✅ both plain numbers, always present |
| `POST /api/jobs` | sends `brollFrequency` (label) + `productOverridesResearch` (boolean) | ✅ `201 { job }` unchanged |
| `PATCH /api/jobs/[id]` | `{ broll_frequency }` from the Architect room | ✅ already allowlisted, no server change |
| `POST /api/assemble-video` | reads the new `warnings: string[]` | ✅ `[]` on a clean run |
| `GET /api/jobs/[id]`, `GET /api/jobs` | `product_overrides_research` off the row | ✅ full row, no change needed |
| `src/lib/pipeline/duration.ts` | `estimateSpokenScript`, `checkDurationDeviation` | ✅ two-sided; `checkDurationOvershoot` correctly absent |
| `src/lib/pipeline/broll.ts` | `BROLL_FREQUENCIES` / `DEFAULT_BROLL_FREQUENCY` | ✅ |

`BROLL_OPTIONS` is now aliased to the server allowlist (`const BROLL_OPTIONS: readonly string[] = BROLL_FREQUENCIES;`) so the picker cannot drift from what the server accepts. Labels and booleans out; numbers in. No vendor id is rendered, stored or submitted.

---

## 4. Flagged by the builder

1. **One extra state not in the checklist: `productBytes: number[]`.** A *total*-payload check needs the byte size of already-selected photos and `productUrls` holds only URLs. Index-aligned with `productUrls`, filtered by the same index on remove, cleared by `openSetup`/`hydrateFromJob`. Justified: inventing sizes from the URLs would have been exactly the fragile workaround the role forbids.
2. **`targetSource` is derived, not stored.** `'reel'` when the reel's plan contains the `script` stage (`generate-english` is the only writer of `target_duration_sec`), else `'pipeline-default'`, else `'none'` — mirroring server-side `resolveOrderedDurationSec`. If a future stage ever writes `target_duration_sec`, this is the line to revisit.
3. **⚠️ Double-click window on the Architect Continue button (OPEN — carried to final review).** `proceedFromArchitect` now awaits the PATCH before dispatching, so the button stays enabled for one network round trip; a fast double-click could fire the audio stage twice, which is **real ElevenLabs spend**. Built as the brief approved ("the existing Continue button's `disabled` covers it"), and the same shape already ships in `persistScriptEdits` on the step-2 Next button. Raised so the decision is conscious rather than inherited.
4. **Not built, by scope:** no test file, no `package.json` change. Component rendering is not testable here (no DOM/React harness, out of scope by story §4), so criteria 1–5, 8–10, 12, 16–18, 35–37 remain `[studio]`-verified only. The pure logic behind them is already unit-pinned backend-side.

---

## 5. CLAUDE.md gaps hit (for final review — do not fold in unasked)

1. **The lint baseline is undocumented** — same gap the backend engineer hit. Without the baseline being handed over in the task, "lint must pass" is unachievable and indistinguishable from a rule violation.
2. **Nothing says which `src/lib/**` modules are browser-safe.** "Vendor ids never reach the browser" covers data, not imports: `pipeline/duration.ts` and `pipeline/broll.ts` are client-importable; `pipeline/assembly.ts` (ffmpeg at module load) and anything touching `supabaseAdmin()` are not.
3. **`CLAUDE.md`'s "32 tests" line is stale** (now 75).

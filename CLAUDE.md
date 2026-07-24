@AGENTS.md

# CLAUDE.md — Kiran Reels

Multi-tenant reel factory: a client config + KB docs go in, a 1080×1920 vertical
reel comes out. Script → voice → avatar → B-roll → ffmpeg assembly, each stage a
route, each vendor an adapter.

## Stack

Next.js 16.2.6 (App Router, React 19.2, TS strict, Tailwind v4) · Supabase
(Postgres + Auth + Storage) · Cloudinary (media) · Python 3.11 generators
(`google-genai`) spawned as subprocesses · fluent-ffmpeg + ffmpeg/ffprobe-static
· Docker → Render.

Vendors: Gemini (script) · ElevenLabs (voice) · HeyGen v3 (avatar) · Veo 3.1 Fast
/ Imagen / nano banana (visual).

## Commands

```
dev:        npm run dev                      # or the kiran-reels-dev preview config
build:      npm run build
typecheck:  npx tsc --noEmit                 # must be 0 before you call anything done
lint:       npm run lint
test:       npm test                         # 109 tests; node --test + type stripping
            # the script lists every test FILE explicitly — there is no glob, so a
            # new tests/*.test.* file must be added to it or it silently never runs
migrate:    no CLI — add supabase/migrations/000N_*.sql, apply via the
            Supabase SQL editor or the Supabase MCP apply_migration
```

- `npm test` needs **Node ≥ 22.6** (`--experimental-strip-types`). The Dockerfile
  is on `node:20`, so the suite runs on the host, not inside the image.
- Python is the **global** interpreter (3.11). The committed `.venv/` is broken —
  it points at another machine's path. `PYTHON_BIN` overrides the binary for local
  dev (`python` on Windows); the image installs `python3`.
- Live project ref `oyxpwfpbfqcfbuklnsjq` (`0001`–`0007` applied). Work on `interface`.
- **`npm run lint` is RED at baseline** — 170 problems (168 `no-explicit-any` + 2 React
  warnings), all pre-existing. The bar is **no NEW findings**, not zero; compare
  against the baseline rather than expecting a clean run.

## The five variants

Presets in `stages.ts`; a client subscribes to them as `client_pipelines` rows.

| # | Preset key | Stages | Assembly | Product |
|---|---|---|---|---|
| 1 | `full_e2e` | all 7 | overlay | no |
| 2 | `client_script` | `adapt_voice` → `assemble` | overlay | no |
| 3 | `avatar_product` | all 7 | overlay | yes (Route B) |
| 5 | `product_promo` | all but `avatar` | concat + VO | yes |
| 6 | `product_music` | topic, script, broll_plan, assemble | concat, no VO | yes |

There is no variant 4: the old "no voiceover" pipeline became the **per-reel**
voiceover toggle. **Overlay tolerates gaps** (the avatar shows through, clips may
start late); **concat does not** — ffmpeg drops the gaps, so a gap is deleted
content. The branch is `noAvatar`, never `noAudio` — keying it wrong was M1, the
truncated-reel bug in the first sold variant.

## Architecture rules

- **`src/lib/pipeline/stages.ts` is the single authority on pipeline shape.** The
  stage list, validation rules, and presets live there; UI steppers, route guards,
  and job progression all *derive* from a stage plan. Never hardcode a stage order
  anywhere else.
- **Which stages run is data, never code.** `client_pipelines.enabled_stages` +
  per-reel toggles (voiceover, inject-script) → snapshotted into `jobs.stage_plan`
  at creation. Skipping a stage is a config question. No `if (client.slug === …)`.
- **Vendors live only behind adapters** — `src/lib/adapters/<domain>/{base,index,
  <provider>}.ts`. Routes call `getVoiceAdapter(c.voice.provider)` etc. A new
  provider = new file + register in `index.ts` + point a client column at its slug.
  Read the `base.ts` contract before implementing one; it is the spec.
- **Retries/backoff belong in the adapter**, not the caller. Assembly fails the
  whole stage on one clip failure, so a transient vendor blip must be absorbed
  where the vendor is called.
- **API routes stay thin and follow one shape:** parse → `requireUser()` /
  `requireAdmin()` → `forbidClientMismatch` → job ownership → `stageNotInPlan` →
  `loadClientConfig` → `startStage` → adapter work → `completeStage` /
  `failStage` in `catch` → clean up temp dirs in `finally`. Vendor-free logic goes
  in `src/lib/pipeline/*` so it is unit-testable.
- **A vendor limit belongs to the adapter that has it, and must be enforced on the
  axis it is defined on.** `ScriptAdapter.maxInlineImagePayloadBytes` (a reel TOTAL)
  and `VisualAdapter.maxReferenceImages` (a count) are read at the call site — never
  re-declared as a constant in `pipeline/*`, and never checked on a different axis.
  A per-file check standing in for a per-request total is how three individually
  legal photos pass upload and then kill the first stage that sends them.
- **Logic that must be unit-testable cannot live in a module that imports ffmpeg or
  `next/server` at load.** `pipeline/assembly.ts` pulls in `fluent-ffmpeg` at module
  scope, so anything exported from it is unreachable from the dependency-free suite —
  that is why `downloadToFile` shipped a process-killing bug with no test. Pure rules
  go in their own `pipeline/*` module (`coverage.ts`, `duration.ts`, `download.ts`).
- **Config over redeploy.** Model ids, voice ids, avatars, durations are DB
  columns; persona/strategy/creative-direction prose lives in the `client-kb`
  Storage bucket (60s cache). A vendor retiring a model must be an admin-panel
  edit. Code carries fallbacks only.
- **Vendor ids never reach the browser.** The Studio sends a human label (avatar,
  template, pipeline name); the route resolves it to the vendor id server-side.
- **Security posture:** RLS is on with *zero* policies — every DB read/write is
  server-side via `supabaseAdmin()` (secret key). The browser gets the publishable
  key and touches nothing. Public `PATCH /api/jobs/[id]` is allowlisted
  (`PATCHABLE_FIELDS`); stage progression, artifact URLs, `stage_plan` and
  `provider_job_ids` are server-only via `updateJobInternal`.
- **Python generators obey the CLI contract in `src/lib/generators/base.py`** —
  import from it (don't re-implement `parse_cli_args`/`load_env`), write to
  `<output_filename>`, report every failure through `fail()` (stderr), keep 9:16.
  Exit **2 = permanent, do not retry** (contract/config errors, and **4xx except
  429**); exit 1 = transient (429/5xx/transport, content refusals).
- **Tests stay dependency-free**: `node --test` + type stripping, no jest/vitest.
  They live outside the app tsconfig, so imports need explicit `.ts` extensions,
  and **no test may call a vendor or the DB** — contract cases must exit before
  the API. Every fix with a live-failure history (M1, M2, M5, M11, M12) is pinned
  by one; keep it that way.
- **Next.js 16, not the one you remember:** middleware is `src/proxy.ts`. Check
  `node_modules/next/dist/docs/` before writing framework code.

## Do not

- **Do not branch on a client** to change pipeline behaviour. Toggles → snapshot →
  one reader → 409 when off-plan.
- **Do not call a vendor SDK or `fetch` a vendor URL from a route or component.**
  Adapter or nothing.
- **Do not hardcode model ids or keys.** Secrets from `process.env` (throw early
  naming the missing var); models from client config.
- **Do not print a generator error to stdout** — the adapter surfaces stderr and
  ignores stdout, so a stdout reason becomes "Command failed" + a base64 dump.
- **Do not shell out with `exec`/string interpolation.** `execFile` + argv array.
- **Do not weaken or bypass the narration-coverage guard** (`MIN_NARRATION_COVERAGE
  = 0.95`, enforced inside `concatBrolls` via `pipeline/coverage.ts`). In concat
  mode the plan must tile `0..lastTimestampEnd` — the **real TTS end**, not the
  target duration — and "frequency" means cut density, not coverage.
- **Do not let a missing/unusable reference image degrade into a text-only
  generation.** An invented product passes every check and is worthless — throw.
- **Do not describe the product's own appearance in a reference-conditioned
  prompt.** The photo carries the product; the prompt describes the shot *around*
  it. Exclusions go in the prompt as an `AVOID:` clause.
- **Do not trust `types.Image.from_file()` MIME inference** (webp is unknown on
  Windows → Veo 400s). Resolve MIME from the explicit extension map.
- **Do not send `negative_prompt` together with `reference_images` to Veo 3.1** —
  hard `400`, and it would hit every product clip.
- **Do not re-litigate "just put the product in the HeyGen avatar video."**
  `cinematic_avatar` takes product references but has no audio; `avatar`/`image`
  lip-sync but take one image. The answer is Route B: composite the presenter
  holding the product (nano banana), then `type:'image'` lip-sync, with a graceful
  downgrade to a plain talking head. See STATUS §R4.
- **Do not "fix" talking-photo avatars.** 3 of Kiran's 4 are `type:talking_photo`;
  HeyGen v3 renders them under `type:'avatar'`, and all four resolve a presenter
  still for Route B. Verified, not a bug.
- **Do not start deferred backlog items opportunistically** — the
  `@google/generative-ai` → `@google/genai` migration, per-client keys, webhooks,
  caption burning, etc. are trigger-gated decisions (STATUS §4), not chores.
- **Do not treat `tsc` + `next build` as proof a vendor path works.** Vendor limits
  are only knowable by calling. Built ≠ works — M11 and M12 were both invisible to
  types, lint, and build, and each would have failed every product reel.
- **Do not spend or destroy without a go-ahead.** Running a stage live costs real
  vendor money, and `cleanup/product-uploads {apply:true}` deletes permanently.
  Dry-run, report, and let the user pull the trigger.
- **Do not commit `.env`, `.venv`, `__pycache__`, or generated media**, and do not
  commit directly to `main`.

## Deeper docs

- `STATUS.md` — the living tracker (done / open / residual risk / what to test).
  **It wins over every other doc where they disagree.** Update it when state changes.
- The versioned doc packs (`kiran-reels-docs-v5.zip`, user-held, not in the repo) —
  the frozen *why* per session; the newest supersedes the rest. STATUS.md is the
  always-current *what*.
- `to_be_executed.md` — the executed v2.1 stage-toggle + onboarding spec.
- `docs/modular_refactor_plan.md` — **superseded**, historical audit only; its
  schema (`tier`, `content_type`, `script_mode`) was dropped in `0004`.
- Contracts worth reading before you touch their area: `src/lib/pipeline/stages.ts`,
  `src/lib/adapters/*/base.ts`, `src/lib/generators/base.py`,
  `supabase/migrations/0001_init.sql`.

Keep this file current with the code: when a rule here stops matching reality,
fix the rule in the same change — a stale rule file is worse than none.

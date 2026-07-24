# Story — Kiran Reels v5 release close-out

**STATUS: APPROVED by the user at GATE 1 on 2026-07-23.** All blocking open questions are resolved — see §5, which now holds DECISIONS, not questions. Build from this file.

**Scope judgement:** eight work items, one outcome — a reel that comes out matching what was ordered, and a visible signal whenever it won't. Written as one story. Items 6 and 8 have no direct client-user-visible behaviour; they sit under this story as its reliability floor (a stage that hangs, or a composite that silently degrades, is a reel that didn't come out as ordered).

---

## 1. User story

> As a **client user** driving the Studio, I want every reel to come out matching what I ordered — the B-roll frequency I picked, the duration I set, the product I uploaded — and to be told before I spend vendor money whenever it won't, so that I stop paying for reels I have to hand-trim, re-run, or throw away.

---

## 2. Acceptance criteria

Verification tags:
`[unit]` provable by the dependency-free `node --test` suite · `[live-text]` provable by a live run of a text stage or ElevenLabs (inside the authorized budget) · `[studio]` provable only by a human driving the Studio and reading the resulting reel record · `[forced-failure]` provable by deliberately breaking a precondition, no vendor call · `[inspection]` **no automated test can exist under this repo's constraints** — provable only by reading the artefact.

### Item 1 — B-roll frequency survives

1. A client user who selects "Minimal" and starts the pipeline gets a reel whose recorded B-roll frequency is "Minimal", visible on the reel record *before* the `broll_plan` stage has run. Fails if the record reads "Standard" at any point after the click. `[studio]`
2. If the `broll_plan` stage fails and is retried, the frequency used on the retry is the one the client user selected, not "Standard". `[studio]` + `[live-text]`
3. A client user who leaves a reel and returns to it (Recent Reels, or a direct reel link) sees the frequency they chose for that reel, not "Standard". `[studio]`
4. An admin retrying a stage on a reel re-uses the frequency recorded on that reel, and that value is the client user's selection — never silently Standard. `[studio]`
5. Across three consecutive reels created in one Studio session with different frequencies chosen, each reel's record carries its own selection — no reel inherits another's. `[studio]`

### Item 2 — duration discipline on adapt_voice

6. On a reel with a chosen target duration, the instruction sent to the `adapt_voice` stage states that target and a word budget derived from the client's configured words-per-second. `[live-text]` for the composed instruction; `[unit]` for the budget calculation if expressible as a pure function.
7. Re-running the defect case — a 20-second target that came back at roughly 65 seconds — produces an adapted script whose estimated spoken duration is within the agreed tolerance of target. Tolerance and run count are **Open question 4**. `[live-text]`
8. Before the `audio` stage runs, the Studio shows the estimated spoken duration of the script that will actually be spoken, next to the target, and visibly flags an overshoot. Fails if a 300-word script on a 20-second target shows no flag, or a 45-word script on a 20-second target shows one. `[studio]`
9. The estimate and flag reflect the script *as currently edited* — after a hand-trim in the Studio editor, a resolved overshoot stops being flagged without leaving the page. `[studio]`
10. The flag never blocks: with an overshoot showing, the client user can still proceed and the reel completes. `[studio]` up to the authorized boundary; the `avatar`/`assemble` half is **not verifiable this round** (decision 5) and must be recorded as such, not as passing.
11. The estimate counts spoken time consistently with what is actually spoken: bracketed direction stripped before the voice vendor costs zero seconds and zero words; markup that *is* sent (breaks, emphasis) is counted as time, not words. `[unit]`
12. On a reel with no recorded target duration (`client_script`, or inject-script), no overshoot is claimed and no misleading number is shown. `[unit]` for the estimator; Studio half `[studio]`. **What it compares against instead is Open question 5.**

### Item 3 — per-reel "product overrides research doc" toggle

13. On a product reel with photos uploaded and the toggle **on**, all three topic suggestions are about the uploaded product. Fails if any suggestion is a generic research-doc topic with no product connection — the exact defect observed. `[live-text]`
14. On the same reel with the toggle **off**, output is indistinguishable from today's. `[live-text]`
15. With the toggle **on**, the topic stage still returns everything it returns today — a template chosen via the decision tree, a hook and a close — and the output parses cleanly. This pins "precedence clause, never suppression". `[live-text]`
16. The toggle sits in the Studio next to the existing voiceover and inject-script toggles, is chosen per reel, and is captured on the reel when the reel is created. `[studio]`
17. Re-running the affected stage later — admin retry, or resumed reel — uses the choice captured on that reel. `[studio]` + `[live-text]`
18. On a reel with no product context whatsoever, the toggle is not offered and topic behaviour is byte-for-byte today's. `[studio]`
   *(A product pipeline with zero photos uploaded is **Open question 8**.)*
19. The toggle changes prompt weighting only: which stages run is unchanged by it. `[unit]`

### Item 4 — reword the B-roll plan rationale (no behaviour change)

20. The `broll_plan` instruction no longer asserts that a generated still cannot be conditioned on the product photos. **`[inspection]` — no prompt text is asserted by any test today; `npm test`, `tsc` and `next build` are all blind to this item.**
21. The steer is intact: on a live `broll_plan` run for a product reel, product-featuring entries still choose the real uploaded photo or a product-conditioned video, in the same proportion as before. A measurable shift is a *failure*. `[live-text]` (subject to **Open question 15**).
22. The design question stays visibly open: a reader who did not do this work can find, in writing, that "which route a product still should take" is undecided and deliberately deferred. **Where that flag lives is Open question 10.** `[inspection]`
23. No generation path changes: a still requested with reference images still goes to the generator that can see them; a generator that cannot condition on an image still refuses permanently. `[unit]`

### Item 5 — duration guard for no-voiceover concat reels

24. A no-voiceover concat reel whose plan tiles the full ordered duration contiguously assembles exactly as today. Fails if the variant-6 shape that produced a clean 15.000-second reel is now rejected. `[unit]`
25. A no-voiceover concat reel whose plan leaves gaps or stops short does not ship silently — the outcome names both ordered and covered seconds. **Refusal vs warning is Open question 11.** `[unit]`
26. The guard does not fire in overlay mode, where gaps are legitimate. This is the M1 axis. `[unit]`
27. Voiceover reels keep today's narration-coverage behaviour unchanged at the existing threshold — every currently passing case passes with the same verdict and message shape. `[unit]`
28. The guard never invents an ordered duration. **Behaviour when unknown is Open question 12.**

### Item 6 — a failed file write fails the stage

29. When writing a downloaded file fails (disk full, permission denied, unwritable path), the stage fails within seconds with a reason naming the write failure. `[forced-failure]`
30. The reason reaching the client user is the write failure itself, not "Command failed" and not a truncated-file symptom downstream. `[forced-failure]`
31. A partially written file is never used as though complete. `[forced-failure]`
32. Successful downloads are unaffected. `[forced-failure]` for a single download; **a full reel regression is outside the authorized budget and must be recorded as unverified.**
33. The presenter-composite downgrade still works — an unfetchable presenter still yields a plain talking head, not a hung stage. `[forced-failure]` up to the render boundary.
   *(Hang vs uncaught crash today is **Open question 13**.)*

### Item 7 — one photo-size limit, stated before upload

34. There is exactly one photo-size limit a client user can hit. Fails if a photo can be accepted at upload then rejected for size by any stage. `[live-text]`
35. That limit is stated in the Studio before the client user chooses a file. `[studio]`
36. The stated limit matches the enforced one, both directions. `[studio]` + `[live-text]`
37. The existing per-reel photo *count* limit continues to be shown and enforced exactly as today. `[studio]`
   *(How the two byte limits are reconciled is **Open question 14**; criteria hold under all three options.)*

### Item 8 — the presenter still declares its real format

38. The presenter still is handed to the composite step declaring the format it actually is (jpeg, png, webp). `[unit]` **only if format resolution is exposed as an importable helper in the style of the existing Veo webp regression; if inline, drops to `[inspection]` + `[live-text]`.**
39. A presenter URL with no usable extension does not produce a confidently wrong declaration. **Open question 16.**
40. Behaviour on the two formats already proven live is unchanged. **Not verifiable this round** (Open question 15); record as unverified.

### Cross-cutting

41. The full test suite passes, the existing 32 pinned cases pass **with unchanged verdicts**, and every new test file actually executes — the count goes up. `[unit]`
42. Typecheck, lint and build are all clean. `[unit]`
43. No item lets one client user read or alter another client's reel, including the new per-reel choices. `[forced-failure]`
44. No item lets the browser change a reel's *behaviour* after creation beyond what is permitted today. `[forced-failure]`
45. No behaviour anywhere branches on which client the reel belongs to. `[inspection]`
46. Verification spend stays inside the authorized budget: text stages and ElevenLabs only. `[inspection]`
47. Every one of the eight items ends in one of exactly two states — verified with evidence named, or unresolved with the reason and residual risk written to the living tracker. `[inspection]`

---

## 3. Edge cases

1. **A reel with no recorded target duration** (`client_script`, inject-script). Meets both item 2's warning and item 5's guard. Blocked on OQ 5 and 12.
2. **A no-voiceover reel whose ordered duration is unknown.** Today a hardcoded fallback stands in silently. Blocked on OQ 12.
3. **A plan that over-covers** — 15 s ordered, 18 s tiled. Nobody has said whether that is a defect. OQ 11 should answer shortfall *and* overshoot.
4. **A product pipeline with zero uploaded photos.** Affects whether item 3's toggle is offered; makes item 7 moot for that reel. Blocked on OQ 8.
5. **A resumed reel.** Must restore frequency, product-override choice, and warning state *for that reel*. Criteria 3, 17.
6. **Starting a new reel immediately after finishing one.** Today frequency, avatar and target duration are not cleared while other fields are. **OQ 3.**
7. **A `broll_plan` stage that failed and is retried.** Criteria 2, 17.
8. **A single-clip plan, and a plan exactly at the coverage threshold.** Criterion 27.
9. **A voiceover reel in concat mode (variant 5).** Two duration rules could apply — must not be judged twice or refused for a reason that already has a guard.
10. **An overlay reel with deliberate gaps.** Must stay legal. Criterion 26.
11. **A photo exactly at the size limit**, and a photo of a type the Studio accepts but the model won't. Second must not look like a size failure.
12. **A download that fails after most of the file is written.** Criterion 31.
13. **A presenter URL with query strings, a CDN path, or no extension.** OQ 16.
14. **Two Studio tabs on the same reel, or an admin retrying while the client user is in the Studio.** Whose choice wins? Capture-at-creation makes it moot for the toggle, not for the frequency chip.
15. **An inactive client.** Nothing should differ.
16. **Items 4 and 5 pulling opposite ways.** Steering harder toward the real photo produces more still entries; stills are padded with silence (R13). The reword must not make it materially worse. Criterion 21 neutralises this by construction.
17. **Variant 2 (`client_script`).** Not run E2E by decision — but its reels are precisely the no-recorded-target case, so OQ 5 and 12 cannot be deferred on the grounds that variant 2 isn't exercised.

---

## 4. Out of scope

- **The entire deferred backlog** — `@google/generative-ai` → `@google/genai`, per-client API keys, webhooks, caption burning, nano banana for all stills, a second visual provider, publish-state lifecycle, manual audio, script versioning, cost logging, non-9:16, template decomposition, RAG.
- **Deciding which route a product still should take.** Item 4 is wording only and stays flagged.
- **A music bed, or any fix for the quiet opening of a no-VO product reel** (R13).
- **Changing the voiceover narration-coverage threshold or rule.**
- **Any hard duration enforcement** — no truncating, no auto-regeneration, no blocking.
- **Reflowing or rewriting the client's KB documents.**
- **General prompt tuning** beyond the three named wordings.
- **Image processing of product photos** beyond the single-limit resolution.
- **Changing how many product photos a reel may carry.**
- **Adding retries, timeouts or backoff anywhere**, beyond making a failed write surface as a failure.
- **Refactoring the Studio's state handling**, or introducing any DOM/React test harness or new framework.
- **RLS policies.**
- **New admin screens, dashboards or reporting.**
- **Running an avatar render, a generated video clip, or a full assembly** for verification; **running variant 2 end to end**.
- **Permanently deleting the known orphaned client asset** (R7).
- **Fixing anything not among the eight items**, including the two stale code comments, unless OQ 17 says otherwise.

---

## 5. DECISIONS (all open questions resolved at GATE 1, 2026-07-23)

These are settled. Build to them. Where the user left an answer blank, the orchestrator's ruling and its basis are marked **[ORCHESTRATOR RULING]**.

1. **(Item 1) Root-cause disambiguation is MOOT.** **[ORCHESTRATOR RULING]** Decision 2 below (settle at reel creation) fixes *both* candidate mechanisms — the column default reading `'Standard'` before `broll_plan` completes, and any stale-closure race — because the value is written before any stage runs. Decision 3 closes the resume/carry-over path. No forensic work on the old job is needed.
2. **(Item 1) B-roll frequency is settled at REEL CREATION**, like the other per-reel choices — captured in the job-creation request and persisted on the row at creation, not at `broll_plan` completion.
3. **(Item 1) Starting a new reel RESETS to defaults** — B-roll frequency, avatar and target duration all reset, matching how the other setup fields already behave.
4. **(Item 2) Tolerance: ±5 seconds around target — BOTH directions.** *(Refined by the user at GATE 2: originally "+5 s overshoot", now two-sided.)* The Studio flags whenever the estimated spoken duration deviates from target by more than 5 seconds in **either** direction — a 20 s target returning 12 s is flagged exactly as one returning 27 s is. The flag is informational: **every re-run is approved manually by the user**, who takes the call to accept or regenerate. Nothing is ever blocked, and nothing is ever auto-regenerated.
   **Consequence for the builders:** the pure check is a two-sided *deviation* check, not an overshoot check. Name it accordingly and give it cases on both sides of target.
   **Consequence for criterion 7's proof standard** (this closes the PM's open question 2): there is no "N consecutive runs within tolerance" bar. The criterion is proven when the flag fires correctly on a deviation beyond ±5 s and stays silent within it; the decision to re-run is the user's, per run.
5. **(Item 2) With no recorded target, compare against the PIPELINE DEFAULT duration.**
6. **(Item 2) Words-per-second is one value per client, applied across all scripts**, set in the admin panel per client. The existing `clients.speech_words_per_sec` column is that value — reuse it for `adapt_voice`. No new column, no separate English/adapted rate.
7. **(Item 2) The live voice prompt DOES already carry length guidance and requires the model to report word count / estimated duration.** The route-level budget must therefore be consistent with the KB doc rather than contradict it, and the Studio's displayed estimate must be computed from the actual script text (not trusted from the model's self-report), so it stays correct after a hand-trim.
8. **(Item 3) The toggle is offered ONLY once product photos are actually attached** (`product_image_urls.length > 0`) — not merely on a product-input pipeline.
9. **(Item 3) The override applies to the TOPIC stage ONLY.** Rationale from the user: the topic decides the script and the b-roll anyway, so the product intent propagates downstream without suppressing anything in those later stages.
10. **(Item 4) The "flagged for later review" marker lives in BOTH places.** **[ORCHESTRATOR RULING]** A new residual-risk row in `STATUS.md` §3 (the project's established convention, R6–R14) *and* a comment at the reworded prompt block. Basis: `CLAUDE.md` warns that in-code "only documented way" comments rot, so the STATUS row is the durable record; but someone editing the prompt will not read STATUS, so the code comment is what stops the question being silently settled. The user's stated intent was "keep it to also be reviewed again — I am not sure which is the right way to proceed."
11. **(Item 5) WARN, do not refuse**, on a short no-voiceover concat reel. The reel still ships; the shortfall is reported naming ordered vs covered seconds.
12. **(Item 5) With no recorded target, the ordered duration is the PIPELINE DEFAULT.** Never a hardcoded literal.
13. **(Item 6) EMPIRICALLY SETTLED — it CRASHES, it does not hang.** Probe (`node`, replicating `downloadToFile`'s exact promise shape, Node 22.11 on Windows): an unwritable destination emits an unhandled `'error'` event on the `WriteStream` → **uncaught exception → process exit**. It never hangs and never rejects. This is more severe than the "hangs to the 100-minute ceiling" framing in the original inventory: in production an uncaught exception takes down the server process and every in-flight reel with it. The fix must attach an `'error'` handler that **rejects** the promise.
14. **(Item 7) EMPIRICALLY SETTLED — the 8 MB per-image cap is SELF-IMPOSED and measures the wrong axis.** Gemini's documented constraint is **20 MB for the TOTAL request** (text + system instructions + all inline image bytes) — not per image, with no per-model variation documented (ai.google.dev/gemini-api/docs/image-understanding). Three 7 MB photos each pass the current 8 MB per-image test and together blow the real 20 MB total. The check must therefore be a **total-payload** check, and per decision 18 its number must come from the model/adapter, not a shared literal.
15. **(Budget) Live calls authorized: TEXT stages and ElevenLabs audio ONLY.** `broll_plan` is a Gemini text call and is therefore **in budget**. A nano banana presenter composite is an image-generation call and is **NOT in budget**. Everything not verifiable within that ceiling is to be collected into an explicit list for a follow-up sweep — recorded as unverified, never as passing.
16. **(Item 8) EMPIRICALLY SETTLED — HeyGen serves `.webp` for 3 of the 4 configured avatars.** Read-only probe of `GET /v2/avatar/{id}/details` for all four of Kiran's avatars: Casual `.webp` (files2.heygen.ai), **Formal `.jpg`** (resource2.heygen.ai), Scrub `.webp`, Studio `.webp`. The URLs **do** carry usable extensions, so URL-derived extension resolution is sound here. This raises item 8's severity: the code hardcodes `presenter.jpg`, so on 3 of 4 avatars a webp is declared `image/jpeg` — M12's exact shape, on the exact same format, surviving only because Gemini is more lenient than Veo.

**Non-blocking, also decided:**

17. **Fix the two stale code comments** as part of "no known defects" (`coverage.ts:18` claiming ffprobe'd durations; `product.ts:5-7` referencing the removed HeyGen `background` hack).
18. **Caps are PER-MODEL, never a shared global.** User directive, and it **applies across the whole program**: a limit belongs to the model/adapter that actually has it, so adding a model brings its own number rather than inheriting a common ceiling. This governs the image-payload limit (decision 14) and the `MAX_IMAGES = 4` vs `maxReferenceImages = 3` drift — the reference-image count must derive from the adapter, not a parallel constant.
19. **Tighten the composite retry classification — PARTIALLY.** **[ORCHESTRATOR RULING]** Wrap the nano banana SDK call the same way `veo_generator.py` was wrapped in M12b, so an **API-level 4xx (except 429)** surfaces the vendor's reason and exits 2 (no retries). But **content refusals stay retryable** ("model returned no image"), because `STATUS.md` and `CLAUDE.md` record that as an evidence-based decision — a filtered generation is not billed and the identical call has been observed to succeed on retry. Basis: this is exactly parallel to M12b and contradicts no documented decision. Decision 16 makes it materially more likely to matter.
20. **The orphan deletion stays SEPARATE** and out of this close-out — the user has already deferred it ("will do later"). Permanent deletion needs its own go-ahead.

---

## 6. Assumptions

- The client user drives all eight items from the Studio; the admin appears only when retrying a stage.
- "Ordered duration" means the target the client user chose for that reel.
- Item 2's warning must reflect the script *as currently edited* — hand-trimming is the very workaround it replaces.
- Item 4 changes no behaviour, so a measurable shift in B-roll plan output after the reword is a **failure** of that item.
- The product-override toggle defaults to off (today's behaviour) on a fresh reel.
- Anything provable only by an avatar render, generated clip or full assembly is recorded as **unverified by decision**, never as passing.
- Every behaviour not named in the eight items stays exactly as today.

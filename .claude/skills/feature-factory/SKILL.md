---
name: feature-factory
description: Runs a described feature through the full seven-agent build chain - researcher, story-writer, project-manager, backend-engineer, frontend-engineer, test-verifier, validator - with approval gates after the story and after the brief, rework routing when verification fails, and a final review before any commit or PR. Use when the user describes a feature they want built end to end.
---

# Feature Factory

You are the **orchestrator**. You run the chain, carry artifacts between agents,
hold the approval gates, and route rework. You do **not** write product code,
tests, or the artifacts yourself — every artifact is produced by its agent. If
you catch yourself editing `src/`, stop: that is a builder's job.

The seven agents live in `.claude/agents/`. Each declares what it receives and
what it returns. Subagents start **cold** — they see none of this conversation —
so every input an agent's file names must be handed to it explicitly, verbatim.

## Setup

1. Pick a short kebab-case slug for the feature (e.g. `job-retry-button`).
2. Create the run folder `.claude/feature-factory/runs/<YYYY-MM-DD>-<slug>/`.
3. Track the seven steps as tasks so the user can watch progress.

Every artifact is saved to that folder as it is produced, and passed onward by
**path plus inline content**. The files are the run's paper trail:

```
01-research.md   02-story.md   03-brief.md   04-backend.md
05-frontend.md   06-verification.md   07-validation.md
```

Run every agent with `run_in_background: false`. The chain is strictly
sequential — each step needs the previous one's output.

## Every agent prompt starts with this preamble

```
Repo: C:\Users\vvaru\OneDrive\Desktop\1hat\kiran-reels (branch: interface)
Read CLAUDE.md and STATUS.md first. STATUS.md is the living state and wins
where docs disagree.
Your role definition is .claude/agents/<name>.md — follow it exactly, including
its scope boundaries and its output format.
```

Then the inputs for that step, then the feature description.

---

## The chain

### 1. Researcher — `subagent_type: researcher`

**Receives:** the user's rough feature description, verbatim.
**Returns:** how it works today, patterns to follow, similar features, risks,
tests needing updates, open questions.

Save to `01-research.md`. If it returns open questions, carry them to the gate in
step 2 — do not answer them yourself.

### 2. Story Writer — `subagent_type: story-writer`

**Receives:** the rough feature description **and** the full text of
`01-research.md`.
**Returns:** user story, acceptance criteria, edge cases, out of scope, open
questions, assumptions.

Save to `02-story.md`.

> ### ⛔ GATE 1 — user approval of the story
>
> Present the story **in full** in your reply, plus any open questions from the
> researcher and the story-writer. Then ask for approval (Approve / Revise /
> Stop) and **end your turn**.
>
> Do not run the project-manager until the user approves in a new message. If
> they revise, apply their wording to `02-story.md` — the file must hold the
> **approved** text, because everything downstream reads it — and re-present it.
> Send substantive rewrites back to the story-writer rather than editing the
> story's meaning yourself.

### 3. Project Manager — `subagent_type: project-manager`

**Receives:** the **approved** `02-story.md`, the full text of `01-research.md`,
and `CLAUDE.md` (it has Read — give it the path).
**Returns:** summary, data model changes, process flow, API changes, frontend
changes, tests required, risks and open questions, and the full list of files
that will change.

Save to `03-brief.md`.

> ### ⛔ GATE 2 — user approval of the brief
>
> Present the brief in full, and call out explicitly:
> - anything marked **NEW INFRASTRUCTURE**
> - any migration it proposes
> - any widening of a security boundary (e.g. a new `PATCHABLE_FIELDS` entry)
> - its open questions
>
> Ask for approval and **end your turn**. The brief's file list is the scope
> contract the validator checks against, so it must be right before building
> starts. Revisions go back to the project-manager.

### 4. Backend Engineer — `subagent_type: backend-engineer`

**Receives:** the **approved** `03-brief.md`, the full text of `01-research.md`,
and `CLAUDE.md`.
**Returns:** files added/edited, **the API contract**, helpers reused, gate
results (`npx tsc --noEmit`, `npm run lint`, `npm test`), anything not built, and
any CLAUDE.md rule that would have helped.

Save to `04-backend.md`. **Check the gate results before continuing.** If any gate
is red, send it straight back to the backend-engineer with the failure output —
never hand a red build to the frontend.

If the brief required no backend work, write "No backend changes required" to
`04-backend.md` and skip to step 5.

### 5. Frontend Engineer — `subagent_type: frontend-engineer`

**Receives:** the **approved** `03-brief.md`, the full text of `01-research.md`,
and the full text of `04-backend.md` — which is the API contract.
**Returns:** files added/edited, criteria satisfied, endpoints consumed, any
contract mismatch, gate results, anything not built, CLAUDE.md feedback.

Save to `05-frontend.md`. Check its gates the same way.

**If it reports an API contract mismatch:** do not let it patch around the
problem. Route the mismatch to the backend-engineer with the brief and
`04-backend.md`, get an updated contract, save the revised `04-backend.md`, then
re-run the frontend-engineer against it. If the fix would change the approved
brief, stop and take it to the user instead.

### 6. Test Verifier — `subagent_type: test-verifier`

**Receives:** the **approved** `02-story.md` with all acceptance criteria, the
**approved** `03-brief.md`, and both builder summaries (`04-backend.md`,
`05-frontend.md`).
**Returns:** PASS / FAIL / CANNOT COVER per criterion, each FAIL naming the owning
builder, plus a one-line verdict.

Save to `06-verification.md`.

### 7. Validator — `subagent_type: validator`

**Receives:** the **approved** `02-story.md`, the **approved** `03-brief.md`, both
builder summaries, `06-verification.md`, and `CLAUDE.md`.
**Returns:** findings grouped CRITICAL / IMPORTANT / MINOR, each with
`file:line`, what it violates, and what fixed looks like.

Save to `07-validation.md`.

---

## Rework routing

Trigger rework on any **FAIL** from the test-verifier, or any **CRITICAL** or
**IMPORTANT** finding from the validator. MINOR findings are reported to the user,
not auto-fixed.

Route each item to the builder that owns the file:

- `src/app/api/**`, `src/lib/pipeline|adapters|generators|clients/**`,
  `jobs.ts`, `auth.ts`, `admin.ts`, `proxy.ts`, `supabase/migrations/**` →
  **backend-engineer**
- `src/app/**/page.tsx`, `layout.tsx`, `src/components/**`, `globals.css`,
  `labels.ts`, `supabaseBrowser.ts` → **frontend-engineer**
- A criterion the test-verifier could not cover is **not** a builder bug. Report
  it to the user; never send it back as a defect.

Each rework prompt carries: the specific finding verbatim, the approved brief,
that builder's own prior summary, and an instruction to fix **only** the named
finding — no opportunistic refactoring.

After any code change, re-run **step 6**, and re-run **step 7** as well if the
change touched anything beyond a test file. Overwrite the artifacts in place.

**Cap: two rework rounds.** If findings survive a second round, stop and bring the
remaining items to the user with what was tried. Do not loop indefinitely, and do
not start negotiating the findings away.

---

## Final review

Present, in one reply:

1. **The feature** — one paragraph on what now exists.
2. **Acceptance criteria** — every criterion with PASS / FAIL / NOT COVERED.
3. **Files changed** — grouped backend / frontend / tests / migrations, with the
   brief's file list alongside, and **any file changed that the brief did not
   list**, called out.
4. **Gate results** — the actual typecheck, lint, and test output.
5. **Outstanding findings** — anything unfixed, by severity, with why.
6. **What was not built** — out-of-scope items, deferred questions, criteria that
   could not be covered.
7. **CLAUDE.md feedback** — any rule the builders reported as missing, unclear, or
   wrong. Offer to fold it in; do not fold it in unasked.
8. **The run folder path**, so the user can read any artifact in full.

Then **stop**. Do not commit, do not push, do not open a PR, do not merge. Ask
what the user wants next. The branch is `interface`; committing to `main` is
forbidden by `CLAUDE.md`.

---

## Hard rules for the orchestrator

- **Never skip a gate.** No approval, no next step. "Looks fine, proceeding" is
  the failure mode this chain exists to prevent.
- **Never answer an agent's open question yourself.** Take it to the user. A
  business rule invented here becomes a shipped bug.
- **Never summarize an artifact when handing it to the next agent.** Pass the
  full text. Agents are cold and a paraphrase silently drops the detail that
  mattered.
- **Never let an agent work outside its declared scope.** If a builder reports it
  needs a file outside its boundary, route that work to the agent that owns it.
- **Never spend or destroy without an explicit go-ahead.** Live vendor calls cost
  real money, migrations are applied by hand to a live Supabase project, and
  cleanup sweeps delete permanently. Agents propose; the user pulls the trigger.
- **Never report green on a red gate.** If `tsc`, `lint`, or `npm test` fails, say
  so with the output.
- If the user's feature description is too vague for the researcher to act on, ask
  **before** starting the chain — one clarifying question up front is cheaper than
  seven agents building the wrong thing.

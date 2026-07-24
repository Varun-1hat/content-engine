-- =============================================================================
-- 0007_product_override_research.sql — per-reel "the product outranks the
-- research doc" choice becomes a job column.
--
-- WHY: on a product reel with photos attached, the topic stage kept suggesting
-- generic research-doc topics with no connection to the uploaded product. The
-- research doc's topic-selection rules outrank the product block that sits
-- beneath it in the same prompt. Which of the two wins is a per-REEL editorial
-- choice, so it belongs on the reel — not in the KB doc (that would change every
-- reel) and not in code (that would be a redeploy per decision).
--
-- WHAT IT REPLACES: nothing. Today there is no way to express the choice at all;
-- the research doc always wins. `false` reproduces exactly that, so every row
-- that already exists and every reel created before the toggle is used behaves
-- byte-for-byte as it does now.
--
-- SCOPE: prompt WEIGHTING on the topic stage only. It removes no stage, so
-- stage_plan is untouched and jobs.stage_plan stays the single snapshot of what
-- this reel runs. It is written ONCE, server-side, by createJob — it is
-- deliberately absent from PATCHABLE_FIELDS (src/lib/jobs.ts), because letting
-- the browser flip a reel's prompt behaviour after creation would mean an admin
-- retry runs under different weighting than the reel was ordered under.
--
-- Additive and reversible:
--   alter table jobs drop column product_overrides_research;
-- =============================================================================

alter table jobs
  add column product_overrides_research boolean not null default false;

comment on column jobs.product_overrides_research is
  'Per-reel: when true (and the reel actually has product photos), the topic stage is told the uploaded product takes precedence over the research doc''s usual topic list. Precedence only — the template decision tree, hook and close still come from the research doc. Written once by createJob; never patchable from the browser.';

-- =============================================================================
-- 0004_drop_legacy.sql — remove the columns the stage-toggle model replaced.
--
-- Run ONLY after 0003 is verified: the per-client 'Default' pipeline backfill
-- (0003 step I) derives from these columns, so dropping them earlier would lose
-- the information needed to reconstruct each client's pipeline.
--
--   tier / content_type / script_mode → client_pipelines.enabled_stages
--                                        (+ client_pipelines.product_input)
--   locale_region                     → dropped entirely; seasonality/region
--                                        context now lives in the research doc.
--
-- locale_language and speech_words_per_sec stay: they are real generation
-- settings (voice adaptation target + duration→word-count heuristic).
-- =============================================================================

alter table clients
  drop column content_type,
  drop column script_mode,
  drop column tier,
  drop column locale_region;

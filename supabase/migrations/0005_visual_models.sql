-- =============================================================================
-- 0005_visual_models.sql — visual model IDs become DB config.
--
-- Script models (model_script / model_structured / model_fallback) have been
-- columns since 0001, so a retired model is an admin-panel edit rather than a
-- redeploy. The VISUAL model ids were hardcoded in the Python generators
-- instead — the same trap the script models were spared. Google has already
-- retired two models out from under this project (gemini-1.5-pro,
-- gemini-2.0-flash), so a hardcoded visual model is a scheduled outage.
--
--   model_visual_video          → veo_generator.py        (b-roll clips)
--   model_visual_image          → imagen_generator.py     (generic stills)
--   model_visual_product_image  → nanobanana_generator.py (stills that must
--                                 show the REAL product — Imagen cannot be
--                                 conditioned on reference photos, so it would
--                                 invent one)
--
-- The defaults reproduce EXACTLY what the generators hardcoded before this
-- migration, so behaviour is unchanged until someone edits them. Additive and
-- reversible: `alter table clients drop column ...` restores the prior schema.
-- =============================================================================

alter table clients
  add column model_visual_video         text not null default 'veo-3.1-fast-generate-preview',
  add column model_visual_image         text not null default 'imagen-3.0-generate-001',
  add column model_visual_product_image text not null default 'gemini-2.5-flash-image';

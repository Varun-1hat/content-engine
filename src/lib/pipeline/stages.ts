import type { ClientPipeline } from '../clients/types';

// The stage registry: THE single place the pipeline shape is defined.
// UI steppers, route guards, and job progression all derive from a stage plan.
//
// Two axes decide which stages run for a given reel:
//   1. The client's PIPELINE (admin-configured) — its `enabled_stages` subset.
//      This is where the client "variants" live (full E2E, product-only, …).
//   2. Per-REEL toggles at creation (voiceover on/off, inject-script) — applied
//      by resolveReelStages() and snapshotted into jobs.stage_plan.
// Skipping a stage is always a config/data question, never a code change.

export type StageName =
  | 'topic'       // suggest + pick a topic
  | 'script'      // English/base script generation
  | 'adapt_voice' // adapt/optimize into the client's voice + language
  | 'audio'       // TTS + normalize + upload
  | 'avatar'      // talking-head render (lip-synced to the audio track)
  | 'broll_plan'  // creative-director B-roll timeline
  | 'assemble';   // generate clips + stitch final video

export const STAGE_INFO: Record<StageName, { label: string }> = {
  topic: { label: 'Topic' },
  script: { label: 'Script' },
  adapt_voice: { label: 'Adapt Script' },
  audio: { label: 'Audio' },
  avatar: { label: 'Avatar' },
  broll_plan: { label: 'B-Roll Plan' },
  assemble: { label: 'Assemble' },
};

export const CANONICAL_STAGES: StageName[] = [
  'topic', 'script', 'adapt_voice', 'audio', 'avatar', 'broll_plan', 'assemble',
];

const STAGE_SET = new Set<string>(CANONICAL_STAGES);

/** Keep only known stages, dedupe, and sort into canonical order. */
export function normalizeStages(names: readonly string[]): StageName[] {
  const seen = new Set<StageName>();
  for (const n of names) {
    if (STAGE_SET.has(n)) seen.add(n as StageName);
  }
  return CANONICAL_STAGES.filter((s) => seen.has(s));
}

/**
 * Structural validity of a stage set. Returns human-readable errors (empty = OK).
 * Enforced when an admin saves a pipeline AND when a job's plan is resolved.
 *
 * `scriptSupplied` says whether this reel comes with a user-supplied script. It
 * is only knowable at job resolution — a pipeline with no script stage (e.g. the
 * client-script variant) is perfectly valid, because injection is a per-reel
 * choice — so the text-source rule below is opt-in and pipeline-save skips it.
 */
export function validate(
  names: readonly string[],
  opts: { scriptSupplied?: boolean } = {}
): string[] {
  const errors: string[] = [];
  const unknown = names.filter((n) => !STAGE_SET.has(n));
  if (unknown.length) errors.push(`Unknown stage(s): ${unknown.join(', ')}`);

  const stages = normalizeStages(names);
  if (stages.length === 0) {
    errors.push('A pipeline must enable at least one stage.');
    return errors;
  }
  const has = (s: StageName) => stages.includes(s);

  // Avatar is lip-synced to the audio track — it needs one.
  if (has('avatar') && !has('audio')) {
    errors.push('The avatar stage requires the audio stage (the talking head is lip-synced to the audio).');
  }
  // Assembly overlays/stitches onto an avatar base OR concatenates B-roll — it
  // needs at least one visual source.
  if (has('assemble') && !has('avatar') && !has('broll_plan')) {
    errors.push('The assemble stage requires either the avatar stage or the B-roll plan stage (nothing to assemble otherwise).');
  }
  // These stages all consume a script, and the script stage is what produces one
  // — unless the user supplies their own for this reel. Without either, they get
  // a 400 ("Missing script") at the stage itself, after the earlier stages have
  // already been paid for. Same reasoning as the assemble rule: refuse the plan
  // up front rather than dead-end partway through.
  if (opts.scriptSupplied !== undefined && !has('script') && !opts.scriptSupplied) {
    const needsScript = (['adapt_voice', 'audio', 'broll_plan'] as StageName[]).filter(has);
    if (needsScript.length) {
      const labels = needsScript.map((s) => STAGE_INFO[s].label).join(', ');
      errors.push(
        `The ${labels} stage(s) need a script: enable the Script stage, or supply your own script for this reel.`
      );
    }
  }
  return errors;
}

// Preset definitions that prefill the admin toggle editor. Storage is always
// the raw `enabled_stages` set — presets are a convenience, not a type.
export interface PipelinePreset {
  key: string;
  label: string;
  stages: StageName[];
  productInput: boolean;
}

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    key: 'full_e2e',
    label: 'Full E2E (script → avatar + voice → b-roll)',
    stages: ['topic', 'script', 'adapt_voice', 'audio', 'avatar', 'broll_plan', 'assemble'],
    productInput: false,
  },
  {
    key: 'client_script',
    label: 'Client-supplied script (optimize → avatar + voice → b-roll)',
    stages: ['adapt_voice', 'audio', 'avatar', 'broll_plan', 'assemble'],
    productInput: false,
  },
  {
    key: 'avatar_product',
    label: 'Avatar + product',
    stages: ['topic', 'script', 'adapt_voice', 'audio', 'avatar', 'broll_plan', 'assemble'],
    productInput: true,
  },
  {
    key: 'product_promo',
    label: 'Product only (no avatar, with voiceover)',
    stages: ['topic', 'script', 'adapt_voice', 'audio', 'broll_plan', 'assemble'],
    productInput: true,
  },
  {
    key: 'product_music',
    label: 'Product ad, no voiceover (video + music)',
    stages: ['topic', 'script', 'broll_plan', 'assemble'],
    productInput: true,
  },
];

/** A pipeline's ordered stage list. */
export function getStagePlan(pipeline: Pick<ClientPipeline, 'enabled_stages'>): StageName[] {
  return normalizeStages(pipeline.enabled_stages);
}

/** A job's snapshotted stage plan; empty/missing falls back to the full sequence. */
export function getJobStagePlan(job: { stage_plan?: string[] | null }): StageName[] {
  const plan = normalizeStages(job.stage_plan ?? []);
  return plan.length > 0 ? plan : [...CANONICAL_STAGES];
}

/**
 * Apply per-reel choices to a pipeline's stage set:
 *   - voiceover=false  → drop adapt_voice, audio, and avatar (avatar needs audio).
 *   - injectScript=true → drop topic and script (the user supplies the script).
 */
export function resolveReelStages(
  pipelineStages: readonly string[],
  opts: { voiceover?: boolean; injectScript?: boolean } = {}
): StageName[] {
  let stages = normalizeStages(pipelineStages);
  if (opts.voiceover === false) {
    stages = stages.filter((s) => s !== 'adapt_voice' && s !== 'audio' && s !== 'avatar');
  }
  if (opts.injectScript) {
    stages = stages.filter((s) => s !== 'topic' && s !== 'script');
  }
  return stages;
}

export function nextStage(plan: StageName[], current: StageName): StageName | null {
  const idx = plan.indexOf(current);
  if (idx === -1 || idx === plan.length - 1) return null;
  return plan[idx + 1];
}

export function isStageInPlan(plan: readonly StageName[], stage: StageName): boolean {
  return plan.includes(stage);
}

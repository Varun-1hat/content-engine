import type { ClientConfig, Tier } from '../clients/types';

// The stage registry: THE single place the pipeline shape is defined.
// UI steppers, route guards, and job progression all derive from getStagePlan().
// Skipping a step for a client is a config question (tier / content_type /
// locale / avatar rows), never a code change.

export type StageName =
  | 'topic'       // suggest + pick a topic
  | 'script'      // English script generation
  | 'adapt_voice' // adapt into the client's voice/language (e.g. Hinglish)
  | 'audio'       // TTS + normalize + upload
  | 'avatar'      // talking-head render
  | 'broll_plan'  // creative-director B-roll timeline
  | 'assemble';   // generate clips + stitch final video

export const STAGE_INFO: Record<StageName, { label: string }> = {
  topic: { label: 'Topic' },
  script: { label: 'Script' },
  adapt_voice: { label: 'Voice Adapt' },
  audio: { label: 'Audio' },
  avatar: { label: 'Avatar' },
  broll_plan: { label: 'B-Roll Plan' },
  assemble: { label: 'Assemble' },
};

const FULL_ORDER: StageName[] = ['topic', 'script', 'adapt_voice', 'audio', 'avatar', 'broll_plan', 'assemble'];

// The last pipeline stage included in each tier.
const TIER_LAST_STAGE: Record<Tier, StageName> = {
  script_only: 'adapt_voice',
  audio_only: 'audio',
  avatar_only: 'avatar',
  full_production: 'assemble',
  scenario_premium: 'assemble',
};

export function getStagePlan(
  client: Pick<ClientConfig, 'tier' | 'contentType' | 'scriptMode' | 'locale' | 'avatars'>
): StageName[] {
  let plan = [...FULL_ORDER];

  // 'polish' clients bring their own draft — no topic-discovery step.
  if (client.scriptMode === 'polish') plan = plan.filter((s) => s !== 'topic');

  // Plain-English clients need no voice-adaptation pass.
  if (client.locale.language === 'english') plan = plan.filter((s) => s !== 'adapt_voice');

  // No talking head: product/visual content, or a client with zero avatar rows.
  // Assembly currently requires an avatar base video to overlay onto, so it is
  // dropped too — the plan must never promise a stage the pipeline can't run.
  // (broll_plan stays: it's a standalone deliverable. A b-roll-only assembly
  // path is a future assembly feature; re-enable here when it exists.)
  if (client.contentType === 'product_visual' || client.avatars.length === 0) {
    plan = plan.filter((s) => s !== 'avatar' && s !== 'assemble');
  }

  // Cut at the tier's last stage (compare against FULL_ORDER, since the
  // tier's nominal last stage may itself have been filtered out above).
  const cutoff = FULL_ORDER.indexOf(TIER_LAST_STAGE[client.tier]);
  return plan.filter((s) => FULL_ORDER.indexOf(s) <= cutoff);
}

export function nextStage(plan: StageName[], current: StageName): StageName | null {
  const idx = plan.indexOf(current);
  if (idx === -1 || idx === plan.length - 1) return null;
  return plan[idx + 1];
}

export function isStageInPlan(plan: StageName[], stage: StageName): boolean {
  return plan.includes(stage);
}

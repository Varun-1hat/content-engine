import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validate,
  normalizeStages,
  resolveReelStages,
  getJobStagePlan,
  nextStage,
  PIPELINE_PRESETS,
  CANONICAL_STAGES,
} from '../src/lib/pipeline/stages.ts';

// Protects the pipeline-shape authority: the stage-plan validation rules
// (including the "m1" server-side text-source rule) and the per-reel toggle axis.

const preset = (k: string): string[] => {
  const p = PIPELINE_PRESETS.find((x) => x.key === k);
  if (!p) throw new Error(`no such preset: ${k}`);
  return p.stages;
};

// --- validate(): structural rules ------------------------------------------
test('full_e2e is structurally valid', () => {
  assert.deepEqual(validate(preset('full_e2e')), []);
});

test('product_promo (the sold variant) is valid', () => {
  assert.deepEqual(validate(preset('product_promo')), []);
});

test('product_music is valid', () => {
  assert.deepEqual(validate(preset('product_music')), []);
});

test('an empty stage set is rejected', () => {
  assert.ok(validate([]).length > 0);
});

test('unknown stages are reported', () => {
  assert.ok(validate(['topic', 'frobnicate']).some((e) => /Unknown stage/.test(e)));
});

test('assemble with no visual source (no avatar, no broll_plan) is rejected', () => {
  const errs = validate(['topic', 'script', 'adapt_voice', 'audio', 'assemble']);
  assert.ok(errs.some((e) => /assemble stage requires/.test(e)));
});

test('avatar without audio is rejected (the talking head is lip-synced to audio)', () => {
  const errs = validate(['topic', 'script', 'adapt_voice', 'avatar', 'assemble']);
  assert.ok(errs.some((e) => /avatar stage requires the audio stage/.test(e)));
});

// --- validate(): the "m1" text-source rule (opt-in at job resolution) -------
test('client_script saves without a script (pipeline-save skips the text-source rule)', () => {
  assert.deepEqual(validate(preset('client_script')), []);
});

test('client_script is REFUSED at job creation when no script is supplied', () => {
  const errs = validate(preset('client_script'), { scriptSupplied: false });
  assert.ok(errs.some((e) => /need a script/.test(e)));
});

test('client_script is accepted at job creation when a script IS supplied', () => {
  assert.deepEqual(validate(preset('client_script'), { scriptSupplied: true }), []);
});

// --- resolveReelStages(): the per-reel toggle axis --------------------------
test('voiceover=false drops adapt_voice, audio and avatar', () => {
  const r = resolveReelStages(preset('full_e2e'), { voiceover: false });
  assert.ok(!r.includes('adapt_voice') && !r.includes('audio') && !r.includes('avatar'));
  assert.ok(r.includes('broll_plan') && r.includes('assemble'));
});

test('injectScript=true drops topic and script', () => {
  const r = resolveReelStages(preset('full_e2e'), { injectScript: true });
  assert.ok(!r.includes('topic') && !r.includes('script'));
});

// --- normalizeStages / getJobStagePlan / nextStage --------------------------
test('normalizeStages dedupes and sorts into canonical order', () => {
  assert.deepEqual(normalizeStages(['assemble', 'topic', 'topic', 'audio']), ['topic', 'audio', 'assemble']);
});

test('getJobStagePlan falls back to the full canonical sequence on an empty plan', () => {
  assert.deepEqual(getJobStagePlan({ stage_plan: [] }), CANONICAL_STAGES);
});

test('getJobStagePlan honors a snapshotted plan', () => {
  assert.deepEqual(getJobStagePlan({ stage_plan: ['topic', 'assemble'] }), ['topic', 'assemble']);
});

test('nextStage returns the following stage, and null at the end', () => {
  assert.equal(nextStage(['topic', 'audio', 'assemble'], 'audio'), 'assemble');
  assert.equal(nextStage(['topic', 'audio', 'assemble'], 'assemble'), null);
});

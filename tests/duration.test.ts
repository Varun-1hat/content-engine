import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DURATION_DEVIATION_TOLERANCE_SEC,
  checkDurationDeviation,
  estimateSpokenScript,
  resolveOrderedDurationSec,
  stripUnspokenMarkup,
  wordBudgetFor,
} from '../src/lib/pipeline/duration.ts';

// Protects the duration-discipline rules: the adapt_voice stage's word budget,
// the estimate the Studio shows for the script AS EDITED, and the two-sided
// ±5s deviation flag. The defect this pins is a 20s reel coming back at ~65s
// with nothing anywhere saying so.

// --- wordBudgetFor ----------------------------------------------------------
test('wordBudgetFor(20, 2.5) is 50', () => {
  assert.equal(wordBudgetFor(20, 2.5), 50);
});

test('wordBudgetFor rounds the way the script stage has always rounded', () => {
  // Math.round, matching generate-english's original inline formula exactly, so
  // the two stages ask for the same length instead of drifting apart.
  assert.equal(wordBudgetFor(45, 2.5), 113);
  assert.equal(wordBudgetFor(30, 2.4), 72);
});

// --- estimateSpokenScript ---------------------------------------------------
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');

test('a 45-word script at 2.5 words/sec estimates ~18s', () => {
  const est = estimateSpokenScript(words(45), 2.5);
  assert.equal(est.words, 45);
  assert.equal(est.seconds, 18);
});

test('bracketed direction is stripped before TTS, so it costs 0 words and 0 seconds', () => {
  const plain = estimateSpokenScript(words(10), 2.5);
  const directed = estimateSpokenScript(`[warm, smiling] ${words(10)} [pause]`, 2.5);
  assert.deepEqual(directed, plain);
});

test('a section header costs 0 words and 0 seconds', () => {
  const plain = estimateSpokenScript(words(10), 2.5);
  const headed = estimateSpokenScript(`THE HOOK:\n${words(10)}`, 2.5);
  assert.deepEqual(headed, plain);
});

test('<break time="1.5s"/> adds 1.5s and zero words', () => {
  const est = estimateSpokenScript(`${words(10)} <break time="1.5s"/> ${words(10)}`, 2.5);
  assert.equal(est.words, 20);
  assert.equal(est.seconds, 20 / 2.5 + 1.5);
});

test('<break time="500ms"/> adds 0.5s', () => {
  const est = estimateSpokenScript(`${words(10)} <break time="500ms"/>`, 2.5);
  assert.equal(est.words, 10);
  assert.equal(est.seconds, 10 / 2.5 + 0.5);
});

test('<emphasis> costs zero words but the text it wraps is counted', () => {
  const est = estimateSpokenScript(`<emphasis level="strong">never do this</emphasis>`, 2.5);
  assert.equal(est.words, 3);
});

test('stripUnspokenMarkup + a whitespace collapse reproduces prepareScriptForTts', () => {
  // prepareScriptForTts (audio.ts) is unimportable here — it pulls in ffmpeg at
  // module load — so this pins the composition instead. audio.ts now delegates
  // to stripUnspokenMarkup and must stay byte-identical to this.
  const raw = 'THE HOOK:\n[warm]  Never   ignore this.\n\nEXPLANATION:\n[soft] It matters. ';
  const composed = stripUnspokenMarkup(raw).replace(/\s+/g, ' ').trim();
  assert.equal(composed, 'Never ignore this. It matters.');
});

// --- resolveOrderedDurationSec ----------------------------------------------
const PIPELINES = [
  { id: 'p-1', duration_default_sec: 45 },
  { id: 'p-2', duration_default_sec: 30 },
];

test('resolveOrderedDurationSec prefers the reel\'s own target over the pipeline default', () => {
  assert.equal(
    resolveOrderedDurationSec({ target_duration_sec: 20, pipeline_id: 'p-1' }, PIPELINES),
    20
  );
});

test('resolveOrderedDurationSec falls back to the matching pipeline default', () => {
  assert.equal(
    resolveOrderedDurationSec({ target_duration_sec: null, pipeline_id: 'p-2' }, PIPELINES),
    30
  );
});

test('resolveOrderedDurationSec returns null with no target AND no matching pipeline', () => {
  assert.equal(
    resolveOrderedDurationSec({ target_duration_sec: null, pipeline_id: 'gone' }, PIPELINES),
    null
  );
  assert.equal(resolveOrderedDurationSec({ target_duration_sec: null, pipeline_id: null }, []), null);
});

// --- checkDurationDeviation -------------------------------------------------
test('the tolerance is ±5 seconds', () => {
  assert.equal(DURATION_DEVIATION_TOLERANCE_SEC, 5);
});

test('a 300-word script on a 20s target is flagged, naming both numbers', () => {
  const est = estimateSpokenScript(words(300), 2.5);
  const msg = checkDurationDeviation(est.seconds, 20);
  assert.ok(msg, 'expected a deviation message');
  assert.match(msg!, /120\.0s/);
  assert.match(msg!, /20s/);
  assert.match(msg!, /over/);
});

test('a 45-word script on a 20s target is NOT flagged (2s of deviation is inside tolerance)', () => {
  const est = estimateSpokenScript(words(45), 2.5);
  assert.equal(checkDurationDeviation(est.seconds, 20), null);
});

test('exactly target + 5.0s does not flag; target + 5.1s does', () => {
  assert.equal(checkDurationDeviation(25.0, 20), null);
  assert.ok(checkDurationDeviation(25.1, 20));
});

test('the check is TWO-SIDED: exactly target - 5.0s does not flag; target - 5.1s does', () => {
  // A 20s target coming back at 12s is as wrong as one coming back at 27s.
  assert.equal(checkDurationDeviation(15.0, 20), null);
  const under = checkDurationDeviation(14.9, 20);
  assert.ok(under, 'expected an undershoot to be flagged too');
  assert.match(under!, /under/);
  assert.match(checkDurationDeviation(12, 20)!, /under/);
});

test('a null target returns null — no target, no claim', () => {
  assert.equal(checkDurationDeviation(65, null), null);
  assert.equal(checkDurationDeviation(65, undefined), null);
  assert.equal(checkDurationDeviation(65, 0), null);
});

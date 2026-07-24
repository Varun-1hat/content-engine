import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNarrationCoverage,
  checkOrderedDurationCoverage,
  MIN_NARRATION_COVERAGE,
  MIN_ORDERED_DURATION_COVERAGE,
} from '../src/lib/pipeline/coverage.ts';

// Protects the variant-5 "M1" fix: a concat reel whose clips don't tile the
// narration would ship truncated (30s script -> 9s reel, marked "done"). The
// guard must refuse that plan and accept a contiguous one.

test('MIN_NARRATION_COVERAGE is 0.95', () => {
  assert.equal(MIN_NARRATION_COVERAGE, 0.95);
});

test('the exact variant-5 bug shape (30s narration, 9s of clips) is refused', () => {
  const err = checkNarrationCoverage([3, 3, 3], 30);
  assert.ok(err, 'expected a refusal message');
  assert.match(err!, /covers only 9\.0s of the 30\.0s voiceover/);
});

test('a contiguous tiling plan (30s of clips over 30s narration) is accepted', () => {
  assert.equal(checkNarrationCoverage([10, 10, 10], 30), null);
});

test('coverage exactly at the 95% threshold is accepted', () => {
  // 28.5 / 30 = 0.95 — not BELOW the threshold, so it passes.
  assert.equal(checkNarrationCoverage([28.5], 30), null);
});

test('coverage just below the threshold is refused', () => {
  assert.ok(checkNarrationCoverage([28.4], 30));
});

test('over-coverage (the bed runs past the narration) is accepted', () => {
  assert.equal(checkNarrationCoverage([40], 30), null);
});

test('a single clip that tiles the whole narration is accepted', () => {
  assert.equal(checkNarrationCoverage([30], 30), null);
});

// --- The no-voiceover half: ordered-duration coverage ------------------------
// Same axis (noAvatar, never noAudio — that mis-keying was M1), but with no
// narration to measure against, so the ordered duration is the yardstick. It
// WARNS instead of throwing: a short no-VO reel is degraded, not cut
// mid-sentence, so the reel still ships.

test('MIN_ORDERED_DURATION_COVERAGE is 0.95', () => {
  assert.equal(MIN_ORDERED_DURATION_COVERAGE, 0.95);
});

test('the proven variant-6 shape (0→5→10→15 over a 15s order) yields NO warning', () => {
  assert.equal(checkOrderedDurationCoverage([5, 5, 5], 15), null);
});

test('a no-VO plan covering 12s of a 15s order warns, naming ordered AND covered', () => {
  const warning = checkOrderedDurationCoverage([5, 4, 3], 15);
  assert.ok(warning, 'expected a shortfall warning');
  assert.match(warning!, /15\.0s/);
  assert.match(warning!, /12\.0s/);
});

test('the ordered-duration guard RETURNS a string — it never throws', () => {
  // Decision 11: warn, do not refuse. If this ever throws, a short no-VO reel
  // stops shipping and the guard has changed severity.
  assert.doesNotThrow(() => checkOrderedDurationCoverage([1], 60));
  assert.equal(typeof checkOrderedDurationCoverage([1], 60), 'string');
});

test('over-coverage (18s tiled against a 15s order) yields no warning', () => {
  assert.equal(checkOrderedDurationCoverage([18], 15), null);
});

test('an unknown ordered duration yields null — the guard never invents one', () => {
  assert.equal(checkOrderedDurationCoverage([1, 1], null), null);
  assert.equal(checkOrderedDurationCoverage([1, 1], undefined), null);
  assert.equal(checkOrderedDurationCoverage([1, 1], 0), null);
});

test('a single clip exactly at the ordered duration is accepted', () => {
  assert.equal(checkOrderedDurationCoverage([15], 15), null);
  // ...and so is coverage exactly at the 95% threshold.
  assert.equal(checkOrderedDurationCoverage([14.25], 15), null);
  assert.ok(checkOrderedDurationCoverage([14.2], 15));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNarrationCoverage, MIN_NARRATION_COVERAGE } from '../src/lib/pipeline/coverage.ts';

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

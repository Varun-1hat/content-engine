// Narration-coverage guard for concat assembly — extracted from concatBrolls so
// the rule that prevents a truncated reel is independently unit-testable (it is
// the fix for the variant-5 "M1" defect, the sold product reel).
//
// In concat mode (no avatar) the clips ARE the whole video: ffmpeg's concat
// filter DROPS the gaps between them, so the reel's length is the SUM of the clip
// durations, not the span they cover. When a voiceover is mixed in, -shortest then
// cuts the narration to that summed length — a reel that stops mid-sentence,
// reported as success. A plan that doesn't tile enough of the narration must be
// refused, not shipped.

/** A concat reel must cover at least this much of the voiceover before we accept it. */
export const MIN_NARRATION_COVERAGE = 0.95;

/**
 * Returns an actionable error message when the summed clip coverage falls short
 * of the narration, or null when the plan tiles enough of it. Pure: no ffmpeg and
 * no I/O — the caller builds the PLANNED slot durations (end - start per clip,
 * concatBrolls) and passes them in. Only the narration length is measured for
 * real (ffprobe); the clip side is the plan, because that is what the assembly
 * command is about to enforce with `-t`.
 */
export function checkNarrationCoverage(clipDurations: number[], narrationSec: number): string | null {
  const coverageSec = clipDurations.reduce((sum, d) => sum + d, 0);
  if (coverageSec < narrationSec * MIN_NARRATION_COVERAGE) {
    return (
      `The B-roll plan covers only ${coverageSec.toFixed(1)}s of the ${narrationSec.toFixed(1)}s voiceover, ` +
      `so the reel would be cut off mid-sentence. With no avatar the clips are the entire video and must tile ` +
      `the full narration contiguously — regenerate the B-roll plan.`
    );
  }
  return null;
}

// --- The no-voiceover half of the same rule ---------------------------------
//
// With a voiceover, the narration is the statement of how long the reel is and
// checkNarrationCoverage above judges against it. With NO voiceover there is no
// narration to measure, so the only statement of how long the reel was supposed
// to be is the duration that was ORDERED for it. Concat still drops the gaps, so
// an under-tiled plan still means a short reel — but a 12s reel where 15s was
// ordered is degraded, not broken (nothing is cut mid-sentence), so this WARNS
// and the reel ships. Same axis as above: noAvatar, never noAudio.

/** A no-voiceover concat reel should tile at least this much of the ordered duration. */
export const MIN_ORDERED_DURATION_COVERAGE = 0.95;

/**
 * Returns a warning naming the ordered and covered seconds when a no-voiceover
 * concat plan under-tiles what was ordered, or null when it tiles enough (or
 * over-tiles — over-coverage is accepted, matching checkNarrationCoverage).
 *
 * NEVER throws and never refuses: the caller collects the string and ships the
 * reel. A null ordered duration returns null — the guard does not invent one.
 */
export function checkOrderedDurationCoverage(
  clipDurations: number[],
  orderedDurationSec: number | null | undefined
): string | null {
  if (
    typeof orderedDurationSec !== 'number' ||
    !Number.isFinite(orderedDurationSec) ||
    orderedDurationSec <= 0
  ) {
    return null;
  }

  const coverageSec = clipDurations.reduce((sum, d) => sum + d, 0);
  if (coverageSec < orderedDurationSec * MIN_ORDERED_DURATION_COVERAGE) {
    return (
      `This reel was ordered at ${orderedDurationSec.toFixed(1)}s but the B-roll plan only covers ` +
      `${coverageSec.toFixed(1)}s. With no avatar and no voiceover the clips are the entire video and ` +
      `concat drops the gaps, so the finished reel is shorter than ordered — regenerate the B-roll plan ` +
      `if the full length matters.`
    );
  }
  return null;
}

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
 * no I/O — the caller measures the real durations (ffprobe) and passes them in.
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

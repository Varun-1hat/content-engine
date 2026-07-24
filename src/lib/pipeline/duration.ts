// Duration discipline — pure, no ffmpeg, no next/server, no Supabase.
//
// Deliberately imports NOTHING: audio.ts (which owns the TTS text preparation
// this file mirrors) pulls in fluent-ffmpeg/ffmpeg-static at module load, which
// would make the estimator unimportable from the dependency-free test suite.
// The direction of the dependency is therefore audio.ts -> here.
//
// Two consumers:
//   * the adapt_voice route, which states the ordered duration and the word
//     budget derived from it in the prompt;
//   * the Studio, which estimates the spoken length of the script AS CURRENTLY
//     EDITED and flags a deviation from what was ordered. The estimate must be
//     computed from the text, never taken from the model's self-reported
//     wordCount/estimatedDuration — that is stale the moment anyone hand-trims.

/** A reel's spoken length may deviate from the ordered duration by this much, either way. */
export const DURATION_DEVIATION_TOLERANCE_SEC = 5;

/**
 * Remove everything that is stripped before the voice vendor ever sees it:
 * section headers (THE HOOK:, ...) and bracketed direction ([warm], [pause]).
 *
 * This is the exact stripping prepareScriptForTts (audio.ts) performs, factored
 * out so the estimate counts what is ACTUALLY spoken. prepareScriptForTts
 * composes this with a whitespace collapse and must stay byte-identical.
 */
export function stripUnspokenMarkup(raw: string): string {
  return raw.replace(/^[A-Z0-9\s]+:/gm, '').trim().replace(/\[.*?\]/g, '');
}

/** `<break time="1.5s"/>` / `time="500ms"` — sent to the vendor, so it costs TIME. */
const BREAK_TAG = /<break\b[^>]*\btime\s*=\s*["']?\s*([\d.]+)\s*(ms|s)\b[^>]*>/gi;
/** Any other markup tag (`<emphasis>`, `</emphasis>`, `<phoneme …>`): zero words, zero time. */
const MARKUP_TAG = /<[^>]*>/g;

export interface SpokenEstimate {
  /** Words actually spoken (markup tags cost nothing; the text they wrap counts). */
  words: number;
  /** Spoken seconds: words / wordsPerSec, plus explicit break time. */
  seconds: number;
}

/**
 * Estimate how long a script will take to speak, at the client's configured
 * words-per-second (clients.speech_words_per_sec).
 *
 * Counts consistently with what the voice vendor receives:
 *   - headers and [bracketed direction] are stripped before TTS -> 0 words, 0 s;
 *   - `<break time="…"/>` IS sent -> its time counts, its tag is not a word;
 *   - `<emphasis>text</emphasis>` IS sent -> the tag is not a word, `text` is.
 */
export function estimateSpokenScript(script: string, wordsPerSec: number): SpokenEstimate {
  const rate = Number.isFinite(wordsPerSec) && wordsPerSec > 0 ? wordsPerSec : 1;
  const spoken = stripUnspokenMarkup(script ?? '');

  let breakSeconds = 0;
  BREAK_TAG.lastIndex = 0;
  for (const match of spoken.matchAll(BREAK_TAG)) {
    const value = parseFloat(match[1]);
    if (!Number.isFinite(value)) continue;
    breakSeconds += match[2].toLowerCase() === 'ms' ? value / 1000 : value;
  }

  const words = spoken
    .replace(MARKUP_TAG, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  return { words, seconds: round1(words / rate + breakSeconds) };
}

/**
 * Words that fit a duration at the client's pacing. Same formula and same
 * rounding as the script stage has always used, so the two stages ask for the
 * same length rather than drifting apart.
 */
export function wordBudgetFor(durationSec: number, wordsPerSec: number): number {
  return Math.round(durationSec * wordsPerSec);
}

/**
 * What length this reel was ORDERED at.
 *
 * The reel's own target wins; when it has none (a reel whose plan has no script
 * stage — client-supplied script, or inject-script — never records one) the
 * pipeline it is bound to supplies its default. Returns null when neither
 * exists: callers must never invent a duration, and a hardcoded literal is
 * exactly what this replaces.
 */
export function resolveOrderedDurationSec(
  job: { target_duration_sec?: number | null; pipeline_id?: string | null },
  pipelines: readonly { id: string; duration_default_sec?: number | null }[] = []
): number | null {
  const target = job.target_duration_sec;
  if (typeof target === 'number' && Number.isFinite(target) && target > 0) return target;

  const pipeline = job.pipeline_id ? pipelines.find((p) => p.id === job.pipeline_id) : undefined;
  const fallback = pipeline?.duration_default_sec;
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) return fallback;

  return null;
}

/**
 * Two-sided: flag whenever the estimated spoken duration deviates from the
 * ordered duration by more than the tolerance in EITHER direction — a 20 s
 * target coming back at 12 s is as wrong as one coming back at 27 s.
 *
 * Returns a message or null. INFORMATIONAL ONLY: nothing is blocked, disabled or
 * regenerated on the strength of it. Every re-run is the user's call.
 * A null target returns null — no target, no claim.
 */
export function checkDurationDeviation(
  estimatedSec: number,
  targetSec: number | null | undefined
): string | null {
  if (typeof targetSec !== 'number' || !Number.isFinite(targetSec) || targetSec <= 0) return null;
  if (!Number.isFinite(estimatedSec)) return null;

  const deviation = estimatedSec - targetSec;
  if (Math.abs(deviation) <= DURATION_DEVIATION_TOLERANCE_SEC) return null;

  return (
    `This script reads at about ${estimatedSec.toFixed(1)}s — ` +
    `${Math.abs(deviation).toFixed(1)}s ${deviation > 0 ? 'over' : 'under'} the ${targetSec}s ordered for this reel ` +
    `(tolerance ±${DURATION_DEVIATION_TOLERANCE_SEC}s).`
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

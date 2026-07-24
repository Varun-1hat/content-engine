import type { CharacterAlignment } from '../adapters/voice/base';
import { getFfmpeg } from './ffmpeg';
import { stripUnspokenMarkup } from './duration';

// Vendor-free audio pipeline: text preprocessing, alignment parsing, and
// ffmpeg normalization. Extracted from generate-audio/route.ts unchanged.

export interface SentenceTimestamp {
  text: string;
  start: number;
  end: number;
  marker: string;
}

/**
 * Prepare a UI script for TTS: strip section headers (THE HOOK:, ...),
 * emotion/pause brackets, and excess whitespace.
 *
 * The stripping half lives in ./duration (which imports no ffmpeg) so the
 * Studio's spoken-duration estimate counts exactly what the voice vendor
 * receives. Output is byte-identical to the previous inline implementation.
 */
export function prepareScriptForTts(raw: string): string {
  return stripUnspokenMarkup(raw).replace(/\s+/g, ' ').trim();
}

/**
 * Collapse per-character alignment into sentence-level timestamps,
 * mathematically adjusted for the ffmpeg atempo speed applied afterwards.
 */
export function alignmentToSentenceTimestamps(
  alignment: CharacterAlignment,
  globalSpeed = 1.0
): SentenceTimestamp[] {
  const timestamps: SentenceTimestamp[] = [];
  let currentText = '';
  let currentStart = -1;

  for (let i = 0; i < alignment.characters.length; i++) {
    const char = alignment.characters[i];
    const startSec = alignment.character_start_times_seconds[i];
    const endSec = alignment.character_end_times_seconds[i];

    if (currentStart === -1 && char.trim() !== '') {
      currentStart = startSec;
    }

    currentText += char;

    const isPunctuation = ['.', '!', '?', '\n'].includes(char);
    const isEnd = i === alignment.characters.length - 1;
    const nextIsSpaceOrEnd = isEnd || [' ', '\n'].includes(alignment.characters[i + 1]);

    if ((isPunctuation && nextIsSpaceOrEnd) || isEnd) {
      if (currentText.trim() !== '') {
        timestamps.push({
          text: currentText.trim(),
          start: parseFloat((currentStart / globalSpeed).toFixed(2)),
          end: parseFloat((endSec / globalSpeed).toFixed(2)),
          marker: 'default',
        });
      }
      currentText = '';
      currentStart = -1;
    }
  }

  return timestamps;
}

/**
 * Speed-adjust and loudness-normalize (social-media standard -16 LUFS).
 * atempo stays mathematically synced with alignmentToSentenceTimestamps().
 */
export function normalizeAudio(inputPath: string, outputPath: string, globalSpeed = 1.0): Promise<void> {
  const ffmpeg = getFfmpeg();
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilter([`atempo=${globalSpeed.toFixed(4)}`, 'loudnorm=I=-16:TP=-1.5:LRA=11'])
      .audioBitrate('128k')
      .on('end', () => resolve())
      .on('error', reject)
      .save(outputPath);
  });
}

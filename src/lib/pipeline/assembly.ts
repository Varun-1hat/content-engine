import fs from 'fs';
import { getFfmpeg, hasAudioStream, getDurationSeconds } from './ffmpeg';

// Vendor-free assembly: download helper + ffmpeg overlay/stitch logic.
// Extracted from assemble-video/route.ts unchanged in behavior.

export interface BrollPlacement {
  localPath: string;
  start: number;
  end: number;
  isImage: boolean;
}

/** Stream a remote file to disk without buffering it in memory. */
export async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url} (${res.status})`);

  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
  }
  fileStream.end();
  await new Promise<void>((resolve) => fileStream.on('finish', () => resolve()));
}

/**
 * Overlay B-roll clips onto the base (avatar) video at their timestamps,
 * scaled/cropped to 1080x1920, preserving the base video's audio.
 */
export function overlayBrolls(
  basePath: string,
  clips: BrollPlacement[],
  outputPath: string
): Promise<void> {
  const ffmpeg = getFfmpeg();
  let command = ffmpeg(basePath);

  const usable = clips.filter((c) => c.localPath && fs.existsSync(c.localPath));

  for (const clip of usable) {
    if (clip.isImage) {
      command = command.input(clip.localPath).inputOptions(['-loop', '1']);
    } else {
      command = command.input(clip.localPath);
    }
  }

  const complexFilter: any[] = [];
  let lastOutput = '[0:v]';
  let inputIdx = 1;

  usable.forEach((clip, i) => {
    const outId = `[out_${i}]`;
    const scaledId = `[scaled_${i}]`;

    complexFilter.push({
      filter: 'setpts',
      options: `PTS-STARTPTS+${clip.start}/TB`,
      inputs: `[${inputIdx}:v]`,
      outputs: `[pts_${i}]`,
    });
    complexFilter.push({
      filter: 'scale',
      options: '1080:1920:force_original_aspect_ratio=increase',
      inputs: `[pts_${i}]`,
      outputs: `[scale_tmp_${i}]`,
    });
    complexFilter.push({
      filter: 'crop',
      options: '1080:1920',
      inputs: `[scale_tmp_${i}]`,
      outputs: scaledId,
    });
    complexFilter.push({
      filter: 'overlay',
      options: { enable: `between(t,${clip.start},${clip.end})`, eof_action: 'pass' },
      inputs: [lastOutput, scaledId],
      outputs: outId,
    });

    inputIdx++;
    lastOutput = outId;
  });

  if (complexFilter.length > 0) {
    command = command.complexFilter(complexFilter, lastOutput);
  }

  return new Promise((resolve, reject) => {
    command
      .outputOptions(['-map 0:a?', '-y']) // preserve base (avatar) audio
      .videoCodec('libx264')
      .audioCodec('aac')
      .on('end', () => resolve())
      .on('error', (err, _stdout, stderr) => {
        console.error('FFmpeg stderr:', stderr);
        reject(err);
      })
      .save(outputPath);
  });
}

// Every segment's audio is normalised to this before concat — the concat filter
// requires identical sample rate / channel layout across inputs.
const AUDIO_RATE = 44100;
const AUDIO_LAYOUT = 'stereo';
const AUDIO_FORMAT = `aformat=sample_rates=${AUDIO_RATE}:channel_layouts=${AUDIO_LAYOUT}`;

// How far the clips' own audio is ducked under a voiceover. The narration has to
// stay intelligible; the generated ambience/music sits beneath it. A plain
// amplitude multiplier: 1.0 leaves the bed untouched, 0 silences it.
const DUCK_UNDER_VOICEOVER = 0.18;

// A concat reel must cover at least this much of the voiceover before we accept
// it. The slack absorbs rounding in the plan; anything below is a reel that stops
// mid-sentence.
const MIN_NARRATION_COVERAGE = 0.95;

/**
 * Concatenate B-roll clips into a single 1080x1920 video — the assembly path
 * for reels with NO avatar base (product-only / no-voiceover).
 *
 * Audio: the clips' OWN audio is preserved (Veo 3.1 always generates audio, and
 * that ambience/music is the soundtrack for a no-voiceover reel). Segments with
 * no audio stream of their own — stills, product photos — are padded with
 * silence so the concat filter sees a uniform stream count. When a voiceover is
 * supplied it is mixed on top and the clip audio is ducked beneath it.
 */
export async function concatBrolls(
  clips: BrollPlacement[],
  opts: { audioPath?: string },
  outputPath: string
): Promise<void> {
  const ffmpeg = getFfmpeg();
  const usable = clips
    .filter((c) => c.localPath && fs.existsSync(c.localPath))
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  if (usable.length === 0) throw new Error('No usable B-roll clips to assemble');

  // An image never has audio; a video might not (not every provider generates
  // it). Probe rather than assume — referencing a missing [i:a] aborts ffmpeg.
  const segmentHasAudio = await Promise.all(
    usable.map((clip) => (clip.isImage ? Promise.resolve(false) : hasAudioStream(clip.localPath)))
  );

  let command = ffmpeg();
  const durations: number[] = [];
  usable.forEach((clip) => {
    const dur = Math.max(0.5, (clip.end ?? 0) - (clip.start ?? 0));
    durations.push(dur);
    if (clip.isImage) {
      command = command.input(clip.localPath).inputOptions(['-loop', '1', '-t', String(dur)]);
    } else {
      command = command.input(clip.localPath).inputOptions(['-t', String(dur)]);
    }
  });

  // Concat drops the gaps between clips: the reel's length is the SUM of these
  // durations, not the span they cover. With a voiceover, -shortest then cuts the
  // narration off at that length — a reel that stops mid-sentence, reported as a
  // success. That is the one thing assembly must never do, so refuse a plan that
  // doesn't tile the narration rather than ship a truncated reel.
  if (opts.audioPath) {
    const narrationSec = await getDurationSeconds(opts.audioPath);
    const coverageSec = durations.reduce((sum, d) => sum + d, 0);
    if (coverageSec < narrationSec * MIN_NARRATION_COVERAGE) {
      throw new Error(
        `The B-roll plan covers only ${coverageSec.toFixed(1)}s of the ${narrationSec.toFixed(1)}s voiceover, ` +
          `so the reel would be cut off mid-sentence. With no avatar the clips are the entire video and must tile ` +
          `the full narration contiguously — regenerate the B-roll plan.`
      );
    }
  }

  // Silence inputs for the segments that have no audio of their own.
  const silenceInputIdx: Record<number, number> = {};
  let nextInputIdx = usable.length;
  usable.forEach((_clip, i) => {
    if (segmentHasAudio[i]) return;
    command = command
      .input(`anullsrc=r=${AUDIO_RATE}:cl=${AUDIO_LAYOUT}`)
      .inputFormat('lavfi')
      .inputOptions(['-t', String(durations[i])]);
    silenceInputIdx[i] = nextInputIdx++;
  });

  const voiceoverIdx = opts.audioPath ? nextInputIdx++ : -1;
  if (opts.audioPath) command = command.input(opts.audioPath);

  const complexFilter: any[] = [];
  const segments: string[] = [];
  usable.forEach((_clip, i) => {
    complexFilter.push({ filter: 'scale', options: '1080:1920:force_original_aspect_ratio=increase', inputs: `[${i}:v]`, outputs: `[s0_${i}]` });
    complexFilter.push({ filter: 'crop', options: '1080:1920', inputs: `[s0_${i}]`, outputs: `[s1_${i}]` });
    complexFilter.push({ filter: 'setsar', options: '1', inputs: `[s1_${i}]`, outputs: `[s2_${i}]` });
    complexFilter.push({ filter: 'fps', options: '30', inputs: `[s2_${i}]`, outputs: `[v${i}]` });

    // Normalise each segment's audio so concat sees uniform streams.
    const audioSrc = segmentHasAudio[i] ? `[${i}:a]` : `[${silenceInputIdx[i]}:a]`;
    complexFilter.push({ filter: AUDIO_FORMAT, inputs: audioSrc, outputs: `[a${i}]` });

    segments.push(`[v${i}]`, `[a${i}]`);
  });

  // a=1 keeps the clips' audio, which is the whole point.
  complexFilter.push({
    filter: 'concat',
    options: { n: usable.length, v: 1, a: 1 },
    inputs: segments,
    outputs: ['[vout]', '[aconcat]'],
  });

  let audioOut = '[aconcat]';
  if (voiceoverIdx >= 0) {
    // Duck the clip bed, then mix the narration over it. dropout_transition=0
    // stops amix from ramping the bed's volume when one input ends.
    complexFilter.push({ filter: 'volume', options: String(DUCK_UNDER_VOICEOVER), inputs: '[aconcat]', outputs: '[abed]' });
    complexFilter.push({ filter: AUDIO_FORMAT, inputs: `[${voiceoverIdx}:a]`, outputs: '[avo]' });
    complexFilter.push({
      filter: 'amix',
      options: { inputs: 2, duration: 'longest', dropout_transition: 0, normalize: 0 },
      inputs: ['[abed]', '[avo]'],
      outputs: '[amixed]',
    });
    audioOut = '[amixed]';
  }

  return new Promise((resolve, reject) => {
    command
      .complexFilter(complexFilter, [])
      .outputOptions(['-map', '[vout]', '-map', audioOut, '-shortest', '-y'])
      .videoCodec('libx264')
      .audioCodec('aac')
      .on('end', () => resolve())
      .on('error', (err, _stdout, stderr) => {
        console.error('FFmpeg stderr:', stderr);
        reject(err);
      })
      .save(outputPath);
  });
}

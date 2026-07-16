import fs from 'fs';
import { getFfmpeg } from './ffmpeg';

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

/**
 * Concatenate B-roll clips into a single 1080x1920 video — the assembly path
 * for reels with NO avatar base (product-only / no-voiceover). Clips play
 * back-to-back in start order, each for (end - start) seconds. An optional audio
 * track (voiceover, or music) is muxed over the top; without one the reel is
 * silent (music, when wanted, is expected to be baked into the generated clips
 * by the visual provider's prompt).
 */
export function concatBrolls(
  clips: BrollPlacement[],
  opts: { audioPath?: string },
  outputPath: string
): Promise<void> {
  const ffmpeg = getFfmpeg();
  const usable = clips
    .filter((c) => c.localPath && fs.existsSync(c.localPath))
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  if (usable.length === 0) throw new Error('No usable B-roll clips to assemble');

  let command = ffmpeg();
  usable.forEach((clip) => {
    const dur = Math.max(0.5, (clip.end ?? 0) - (clip.start ?? 0));
    if (clip.isImage) {
      command = command.input(clip.localPath).inputOptions(['-loop', '1', '-t', String(dur)]);
    } else {
      command = command.input(clip.localPath).inputOptions(['-t', String(dur)]);
    }
  });

  const hasAudio = !!opts.audioPath;
  if (hasAudio) command = command.input(opts.audioPath!);

  const complexFilter: any[] = [];
  const segments: string[] = [];
  usable.forEach((_clip, i) => {
    complexFilter.push({ filter: 'scale', options: '1080:1920:force_original_aspect_ratio=increase', inputs: `[${i}:v]`, outputs: `[s0_${i}]` });
    complexFilter.push({ filter: 'crop', options: '1080:1920', inputs: `[s0_${i}]`, outputs: `[s1_${i}]` });
    complexFilter.push({ filter: 'setsar', options: '1', inputs: `[s1_${i}]`, outputs: `[s2_${i}]` });
    complexFilter.push({ filter: 'fps', options: '30', inputs: `[s2_${i}]`, outputs: `[v${i}]` });
    segments.push(`[v${i}]`);
  });
  complexFilter.push({ filter: 'concat', options: { n: usable.length, v: 1, a: 0 }, inputs: segments, outputs: '[vout]' });

  return new Promise((resolve, reject) => {
    const audioIdx = usable.length; // audio input follows all the video inputs
    command
      .complexFilter(complexFilter, '[vout]')
      .outputOptions(hasAudio ? ['-map', `${audioIdx}:a`, '-shortest', '-y'] : ['-an', '-y'])
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

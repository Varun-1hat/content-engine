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

import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import path from 'path';

let configured = false;

// Next.js Turbopack sometimes resolves the static binary paths to '\ROOT\...',
// so fall back to the real node_modules location.
function repair(resolved: string | undefined, pkg: string, binary: string): string | undefined {
  if (resolved && resolved.includes('ROOT')) {
    const idx = resolved.replace(/\\/g, '/').indexOf(`/${pkg}/`);
    const tail = idx >= 0 ? resolved.slice(idx + pkg.length + 2) : binary;
    return path.join(process.cwd(), 'node_modules', pkg, tail);
  }
  return resolved;
}

// Shared, configured fluent-ffmpeg instance.
export function getFfmpeg(): typeof ffmpeg {
  if (!configured) {
    const exe = process.platform === 'win32' ? '.exe' : '';
    const ffmpegPath = repair(ffmpegStatic as unknown as string, 'ffmpeg-static', `ffmpeg${exe}`);
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

    // ffmpeg-static ships ffmpeg only, so ffprobe comes from its own package.
    // Without it fluent-ffmpeg looks for `ffprobe` on PATH, which exists on
    // neither this box nor the Docker image (it installs no ffmpeg via apt).
    const ffprobePath = repair(ffprobeStatic.path, 'ffprobe-static', path.join('bin', process.platform, process.arch, `ffprobe${exe}`));
    if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

    configured = true;
  }
  return ffmpeg;
}

/** True when the file has at least one audio stream. */
export function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    getFfmpeg().ffprobe(filePath, (err, data) => {
      if (err) return reject(new Error(`ffprobe failed for ${filePath}: ${err.message}`));
      resolve((data.streams ?? []).some((s) => s.codec_type === 'audio'));
    });
  });
}

/** Container duration in seconds. */
export function getDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    getFfmpeg().ffprobe(filePath, (err, data) => {
      if (err) return reject(new Error(`ffprobe failed for ${filePath}: ${err.message}`));
      const duration = data.format?.duration;
      if (typeof duration !== 'number' || !Number.isFinite(duration)) {
        return reject(new Error(`ffprobe returned no duration for ${filePath}`));
      }
      resolve(duration);
    });
  });
}

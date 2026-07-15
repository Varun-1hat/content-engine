import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import path from 'path';

let configured = false;

// Shared, configured fluent-ffmpeg instance.
// Next.js Turbopack sometimes resolves ffmpeg-static's path to '\ROOT\...',
// so fall back to the real node_modules location.
export function getFfmpeg(): typeof ffmpeg {
  if (!configured) {
    let resolved = ffmpegStatic as unknown as string;
    if (resolved && resolved.includes('ROOT')) {
      const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
      resolved = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', binary);
    }
    if (resolved) ffmpeg.setFfmpegPath(resolved);
    configured = true;
  }
  return ffmpeg;
}

import fs from 'fs';
import path from 'path';

// Streaming download + image-format resolution.
//
// This lives OUTSIDE assembly.ts on purpose: assembly.ts imports
// fluent-ffmpeg/ffmpeg-static at module load, which makes it unimportable from
// the dependency-free test suite. The download path is where a stage silently
// dies, so it has to be testable.

/** Image extensions we are willing to declare a MIME type for. */
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** The reverse map, canonicalised: one extension per MIME type. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * The image extension a URL actually carries, or null.
 *
 * Null, not a guess: naming a downloaded file `.jpg` because we could not tell
 * is how a webp ends up declared `image/jpeg` to a model (M12's exact shape —
 * Veo rejects it outright, Gemini merely tolerates it). Query strings and
 * fragments are ignored; an extensionless CDN path yields null.
 */
export function extensionFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split('#')[0].split('?')[0];
  }
  const ext = path.extname(pathname).toLowerCase();
  return ext in MIME_BY_EXT ? ext : null;
}

/** The extension for a response Content-Type, or null when it names no image we handle. */
export function extensionFromMimeType(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? null;
}

export interface DownloadResult {
  /** The response Content-Type, lower-cased with parameters stripped, or null. */
  contentType: string | null;
}

/**
 * Stream a remote file to disk without buffering it in memory.
 *
 * The 'error' listener is load-bearing, not defensive. A WriteStream that cannot
 * open or write its destination (missing directory, permission denied, disk
 * full) emits 'error'; with no listener that is an UNHANDLED 'error' event,
 * which in Node is an uncaught exception — verified empirically: the process
 * exits, taking every other reel in flight with it. It has to reject so the
 * stage fails with the write error as its reason.
 *
 * On any failure the partial file is deleted before the error propagates: a
 * truncated file that looks complete is worse than no file, because nothing
 * downstream can tell.
 */
export async function downloadToFile(url: string, destPath: string): Promise<DownloadResult> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url} (${res.status})`);

  const body = res.body;
  const fileStream = fs.createWriteStream(destPath);
  const reader = body.getReader();

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      fileStream.on('error', (err: Error) => {
        // Stop pulling the body: there is nowhere left to put it.
        void reader.cancel().catch(() => {});
        settle(new Error(`Failed to write ${destPath}: ${err.message}`));
      });
      fileStream.on('finish', () => settle());

      void (async () => {
        while (!settled) {
          const { done, value } = await reader.read();
          if (done) break;
          fileStream.write(value);
        }
        if (!settled) fileStream.end();
      })().catch((err: unknown) => {
        fileStream.destroy();
        settle(
          err instanceof Error
            ? new Error(`Failed to download ${url}: ${err.message}`)
            : new Error(`Failed to download ${url}: ${String(err)}`)
        );
      });
    });
  } catch (err) {
    try {
      fs.rmSync(destPath, { force: true });
    } catch {
      // Best effort — the original failure is the one worth reporting.
    }
    throw err;
  }

  const contentType = res.headers.get('content-type');
  return { contentType: contentType ? contentType.split(';')[0].trim().toLowerCase() : null };
}

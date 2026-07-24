import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  downloadToFile,
  extensionFromMimeType,
  extensionFromUrl,
} from '../src/lib/pipeline/download.ts';

// Protects the download path. Two failures live here:
//   * an unwritable destination emitted an UNHANDLED 'error' on the WriteStream
//     — an uncaught exception that exits the process, taking every in-flight
//     reel with it. It must reject, and leave no partial file behind.
//   * the presenter still was always named .jpg, so a webp (3 of 4 HeyGen
//     avatars) was declared image/jpeg to the compositor — M12's exact shape.
//
// No vendor and no DB: the success case binds a localhost port with the built-in
// node:http, which is the only network this suite touches.

// --- extensionFromUrl -------------------------------------------------------
test('the four real HeyGen presenter URL shapes resolve their true extension', () => {
  assert.equal(
    extensionFromUrl('https://files2.heygen.ai/avatar/v3/abc123/full/2.2/preview_talk_1.webp'),
    '.webp'
  );
  assert.equal(
    extensionFromUrl('https://resource2.heygen.ai/avatar/v3/def456/preview_target.jpg'),
    '.jpg'
  );
  assert.equal(
    extensionFromUrl('https://files2.heygen.ai/avatar/v3/ghi789/preview_talk_2.webp?Expires=1784&Signature=x%2Fy'),
    '.webp'
  );
  assert.equal(
    extensionFromUrl('https://files2.heygen.ai/avatar/v3/jkl012/preview_talk_3.WEBP#frag'),
    '.webp'
  );
});

test('an extensionless CDN path yields null, not a confident .jpg', () => {
  assert.equal(extensionFromUrl('https://cdn.example.com/assets/9f3ab21c0e'), null);
  assert.equal(extensionFromUrl('https://cdn.example.com/assets/9f3ab21c0e?format=auto'), null);
  // A non-image extension is also "no usable image extension".
  assert.equal(extensionFromUrl('https://cdn.example.com/assets/thing.bin'), null);
});

// --- extensionFromMimeType --------------------------------------------------
test('extensionFromMimeType maps the image types we handle and nothing else', () => {
  assert.equal(extensionFromMimeType('image/webp'), '.webp');
  assert.equal(extensionFromMimeType('image/png'), '.png');
  assert.equal(extensionFromMimeType('image/jpeg'), '.jpg');
  assert.equal(extensionFromMimeType('image/jpeg; charset=binary'), '.jpg');
  assert.equal(extensionFromMimeType('application/octet-stream'), null);
  assert.equal(extensionFromMimeType(null), null);
  assert.equal(extensionFromMimeType(undefined), null);
});

// --- downloadToFile ---------------------------------------------------------
const BODY = Buffer.from('kiran-reels download fixture — exact bytes matter');

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': String(BODY.length) });
      res.end(BODY);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}/presenter`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test('a successful download writes the exact bytes and reports the content type', async () => {
  const server = await startServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-ok-'));
  const dest = path.join(dir, 'out.bin');
  try {
    const result = await downloadToFile(server.url, dest);
    assert.deepEqual(fs.readFileSync(dest), BODY);
    assert.equal(result.contentType, 'image/webp');
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unwritable destination REJECTS with the write failure, it does not crash', async () => {
  const server = await startServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-fail-'));
  // A path under a directory that does not exist: the WriteStream cannot open.
  const dest = path.join(dir, 'no-such-dir', 'out.bin');
  try {
    await assert.rejects(
      () => downloadToFile(server.url, dest),
      (err: Error) => {
        assert.match(err.message, /Failed to write/);
        assert.match(err.message, /ENOENT|EACCES|EPERM/);
        return true;
      }
    );
    // ...and nothing partial is left where the file was going.
    assert.equal(fs.existsSync(dest), false);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-2xx response throws before anything is written', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end('nope');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const port = (server.address() as { port: number }).port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-404-'));
  const dest = path.join(dir, 'out.bin');
  try {
    await assert.rejects(() => downloadToFile(`http://127.0.0.1:${port}/x`, dest), /404/);
    assert.equal(fs.existsSync(dest), false);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

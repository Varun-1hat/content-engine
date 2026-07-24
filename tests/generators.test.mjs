import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Protects the generator CLI contract (src/lib/generators/base.py) that the
// visual adapter depends on: every deliberate failure reports on STDERR (M2) and
// carries the right exit code (M5) — 2 = permanent (don't retry), 1 = transient.
// None of these tests makes a real API call: each generator exits on a contract
// violation BEFORE it would call the vendor. A dummy key satisfies the
// "is it set" check where a case needs to reach past it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(__dirname, '..', 'src', 'lib');
const PY = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

// Run from a scratch cwd with no .env so base.load_env()'s .env fallback can't
// smuggle a real key into a case that is supposed to have none.
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'gentest-'));
const OUT = path.join(CWD, 'out.bin');

const NO_KEY_ENV = (() => {
  const e = { ...process.env };
  delete e.GEMINI_API_KEY;
  delete e.VEO_API_KEY;
  return e;
})();
const DUMMY_KEY = { GEMINI_API_KEY: 'dummy-not-used-no-api-call-is-made' };

const b64 = (s) => Buffer.from(s).toString('base64');

function run(script, args, extraEnv = {}) {
  try { fs.rmSync(OUT, { force: true }); } catch {}
  const res = spawnSync(PY, [path.join(LIB, script), ...args], {
    cwd: CWD,
    env: { ...NO_KEY_ENV, ...extraEnv },
    encoding: 'utf8',
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', error: res.error };
}

test('imagen REFUSES --ref: permanent exit 2, reason on stderr, nothing on stdout, no file', () => {
  const r = run('imagen_generator.py', [b64('a shot'), b64(''), OUT, '--base64', '--ref', 'x.png'], DUMMY_KEY);
  assert.equal(r.error, undefined, 'python should be runnable');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cannot condition/i);
  assert.equal(r.stdout.trim(), '');
  assert.ok(!fs.existsSync(OUT));
});

test('nanobanana REFUSES missing --ref: permanent exit 2 on stderr', () => {
  const r = run('nanobanana_generator.py', [b64('a shot'), b64(''), OUT, '--base64'], DUMMY_KEY);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /requires at least one --ref/i);
});

test('veo fails a missing reference file: permanent exit 2 on stderr', () => {
  const r = run('veo_generator.py', [b64('a shot'), b64(''), OUT, '--base64', '--ref', path.join(CWD, 'nope.png')], DUMMY_KEY);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /reference image not found/i);
});

test('veo missing API key: permanent exit 2, clear reason on stderr', () => {
  const r = run('veo_generator.py', [b64('a shot'), b64(''), OUT, '--base64'], {});
  assert.equal(r.code, 2);
  assert.match(r.stderr, /GEMINI_API_KEY or VEO_API_KEY is not set/);
});

test('imagen missing API key: permanent exit 2 on stderr', () => {
  const r = run('imagen_generator.py', [b64('a shot'), b64(''), OUT, '--base64'], {});
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is not set/);
});

test('nanobanana missing API key: permanent exit 2 on stderr', () => {
  const r = run('nanobanana_generator.py', [b64('a shot'), b64(''), OUT, '--base64', '--ref', 'x.png'], {});
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is not set/);
});

test('a usage error (too few args) goes to stderr and exits non-zero', () => {
  const r = run('imagen_generator.py', [], {});
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Usage:/);
});

test('Veo reference images resolve an explicit MIME type per extension (webp included)', () => {
  // Regression guard. types.Image.from_file() infers the MIME type from Python's
  // `mimetypes` registry, which does NOT know .webp on Windows: mime_type comes
  // back None, the SDK omits `mimeType`, and Veo rejects the whole call with
  //   400 INVALID_ARGUMENT "Image field doesn't have expected
  //   `bytesBase64Encoded` or `mimeType` fields"
  // That failed EVERY product clip for any reel whose product photo was a webp —
  // the common case for product photography, and accepted by /api/uploads.
  const libPath = LIB.replace(/\\/g, '/');
  const code = [
    'import sys',
    `sys.path.insert(0, "${libPath}")`,
    'from veo_generator import reference_mime_type',
    'print(reference_mime_type("a.webp"), reference_mime_type("b.PNG"), reference_mime_type("c.jpeg"), reference_mime_type("d.bin"))',
  ].join('\n');
  const res = spawnSync(PY, ['-c', code], { cwd: CWD, env: NO_KEY_ENV, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'image/webp image/png image/jpeg image/jpeg');
});

test('nano banana resolves the SAME explicit MIME map (presenter stills are webp)', () => {
  // HeyGen serves .webp for 3 of the 4 configured avatars, and the presenter
  // still is handed to this generator as a file — so the type it declares comes
  // from the extension. An inline ternary here (or a hardcoded presenter.jpg
  // upstream) declares image/jpeg for a webp: M12's exact shape, one file over.
  // Importable via the shared generators.base, so both generators agree.
  const libPath = LIB.replace(/\\/g, '/');
  const code = [
    'import sys',
    `sys.path.insert(0, "${libPath}")`,
    'from nanobanana_generator import reference_mime_type',
    'print(reference_mime_type("a.webp"), reference_mime_type("b.PNG"), reference_mime_type("c.jpeg"), reference_mime_type("d.bin"))',
  ].join('\n');
  const res = spawnSync(PY, ['-c', code], { cwd: CWD, env: NO_KEY_ENV, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'image/webp image/png image/jpeg image/jpeg');
});

test('is_retryable_api_error: 4xx (except 429) is permanent, everything else retries', () => {
  // The adapter spends 3 attempts on a retryable failure. A 400 from the vendor
  // is a contract/config error — the identical request is rejected identically,
  // so retrying only burns time. 429 and 5xx and anything unclassifiable may
  // clear on their own. (A CONTENT refusal is a different thing and stays
  // retryable — that is evidence-based and is NOT what this classifies.)
  const libPath = LIB.replace(/\\/g, '/');
  const code = [
    'import sys',
    `sys.path.insert(0, "${libPath}")`,
    'from generators.base import is_retryable_api_error',
    'class ApiErr(Exception):',
    '    def __init__(self, code): self.code = code',
    'print(is_retryable_api_error(ApiErr(400)), is_retryable_api_error(ApiErr(404)), '
      + 'is_retryable_api_error(ApiErr(429)), is_retryable_api_error(ApiErr(500)), '
      + 'is_retryable_api_error(Exception("connection reset")))',
  ].join('\n');
  const res = spawnSync(PY, ['-c', code], { cwd: CWD, env: NO_KEY_ENV, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'False False True True True');
});

test('base64 prompt round-trips through the shared CLI parser (no crash on decode)', () => {
  // A prompt with quotes/newlines must survive --base64; it still refuses on the
  // --ref contract, proving the arg was parsed, not that a real call happened.
  const r = run('imagen_generator.py', [b64('he said "hi"\nline two'), b64('blurry'), OUT, '--base64', '--ref', 'x.png'], DUMMY_KEY);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cannot condition/i);
});

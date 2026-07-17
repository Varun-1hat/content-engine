import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import type { VisualAdapter } from './base';

// execFile, not exec: arguments go straight to the process as an argv array, so
// nothing is parsed by a shell. Paths and model ids are server-controlled but
// can still contain characters a shell would mangle (a quote in a model id used
// to break the command outright).
const execFileAsync = util.promisify(execFile);

/**
 * Run one Python generator with retry/backoff and the exit-code contract.
 * Shared by clip generation and presenter compositing so both get identical
 * resilience (stderr surfaced, exit 2 = don't retry, partial files cleaned up).
 */
async function runGenerator(scriptFile: string, args: string[], outPath: string, label: string): Promise<string> {
  const scriptPath = path.join(process.cwd(), 'src', 'lib', scriptFile);
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { stderr } = await execFileAsync(PYTHON_BIN, [scriptPath, ...args], { maxBuffer: 10 * 1024 * 1024 });
      if (!fs.existsSync(outPath)) {
        throw new Error(
          `${scriptFile} exited cleanly but produced no file at ${outPath}` +
            (stderr?.trim() ? ` — stderr: ${stderr.trim().slice(0, 500)}` : '')
        );
      }
      return outPath;
    } catch (err: any) {
      // Generators report every failure on stderr (base.py fail()); that is the
      // reason a human needs. err.message alone is "Command failed" + argv dump.
      const detail = err?.stderr?.trim() || err?.message || String(err);
      lastErr = new Error(detail.slice(0, 500));
      console.warn(`${scriptFile} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErr.message}`);
      // A partial/corrupt file must not be mistaken for success by the next existsSync.
      try { if (fs.existsSync(outPath)) fs.rmSync(outPath, { force: true }); } catch {}
      if (err?.code === EXIT_PERMANENT) {
        throw new Error(`${label} failed and cannot be retried: ${lastErr.message}`);
      }
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${lastErr?.message}`);
}

// The Docker image installs `python3`; PYTHON_BIN overrides for local dev
// (e.g. `python` on Windows).
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

// Per the base contract, resilience lives in the adapter — the caller makes one
// call. Assembly fails the whole stage on a clip failure, so a transient vendor
// blip must be absorbed here rather than costing the user a whole reel.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

// The generators' retry contract (src/lib/generators/base.py): exit 2 means the
// call cannot succeed — a safety block, a contract violation, a missing key.
// Retrying those spends real money on a certain failure, so stop immediately.
// Everything else may be a transient blip and is retried.
const EXIT_PERMANENT = 2;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Veo 3.1 accepts at most 3 asset reference images (3.1 Lite accepts none).
// https://ai.google.dev/gemini-api/docs/veo
const MAX_REFERENCE_IMAGES = 3;

// Fallbacks for a client row predating the model columns (migration 0005).
// These are exactly what the generators used to hardcode.
const DEFAULT_MODELS = {
  video: 'veo-3.1-fast-generate-preview',
  image: 'imagen-3.0-generate-001',
  productImage: 'gemini-2.5-flash-image',
};

/**
 * Three Google generators behind one provider slug. Which one runs is decided
 * by what the shot needs, not by config:
 *
 *   video                    → veo_generator.py        (Veo; refs supported)
 *   still, no references     → imagen_generator.py     (Imagen; cheap + fine)
 *   still, WITH references   → nanobanana_generator.py (Gemini 2.5 Flash Image)
 *
 * That last route exists because Imagen cannot be conditioned on an image, so
 * it would invent a product. Rather than refuse the shot, hand it to a model
 * that can actually see the photos.
 */
export const veoImagenVisualAdapter: VisualAdapter = {
  maxReferenceImages: MAX_REFERENCE_IMAGES,

  async generateClip({ prompt, negativePrompt, mediaType, outPath, referenceImages, models }) {
    const refs = (referenceImages ?? []).slice(0, MAX_REFERENCE_IMAGES);
    const isImage = mediaType === 'image';

    let scriptFile: string;
    let model: string;
    if (!isImage) {
      scriptFile = 'veo_generator.py';
      model = models?.video || DEFAULT_MODELS.video;
    } else if (refs.length > 0) {
      scriptFile = 'nanobanana_generator.py';
      model = models?.productImage || DEFAULT_MODELS.productImage;
    } else {
      scriptFile = 'imagen_generator.py';
      model = models?.image || DEFAULT_MODELS.image;
    }
    // Base64-encode the prompts: they are free text and the generators decode
    // them with --base64.
    const b64Prompt = Buffer.from(prompt || '').toString('base64');
    const b64Neg = Buffer.from(negativePrompt || '').toString('base64');

    const args = [
      b64Prompt,
      b64Neg,
      outPath,
      '--base64',
      '--model',
      model,
      ...refs.flatMap((p) => ['--ref', p]),
    ];

    return runGenerator(scriptFile, args, outPath, `${mediaType} generation`);
  },

  // Presenter + product → one composite still, via nano banana in --persona
  // mode (person preserved, products placed). Feeds HeyGen type:'image'.
  async composePresenterProduct({ presenterImagePath, productImagePaths, prompt, outPath, models }) {
    if (productImagePaths.length === 0) {
      throw new Error('composePresenterProduct requires at least one product image');
    }
    const model = models?.productImage || DEFAULT_MODELS.productImage;
    const products = productImagePaths.slice(0, MAX_REFERENCE_IMAGES);

    const args = [
      Buffer.from(prompt || '').toString('base64'),
      Buffer.from('').toString('base64'),
      outPath,
      '--base64',
      '--model',
      model,
      '--persona',
      presenterImagePath,
      ...products.flatMap((p) => ['--ref', p]),
    ];

    return runGenerator('nanobanana_generator.py', args, outPath, 'presenter composite');
  },
};

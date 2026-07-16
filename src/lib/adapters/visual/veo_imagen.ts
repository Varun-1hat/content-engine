import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import type { VisualAdapter } from './base';

const execAsync = util.promisify(exec);

// The Docker image installs `python3`; PYTHON_BIN overrides for local dev
// (e.g. `python` on Windows).
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

// Per the base contract, resilience lives in the adapter — the caller makes one
// call. Assembly fails the whole stage on a clip failure, so a transient vendor
// blip must be absorbed here rather than costing the user a whole reel.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const veoImagenVisualAdapter: VisualAdapter = {
  async generateClip({ prompt, negativePrompt, mediaType, outPath }) {
    const scriptFile = mediaType === 'image' ? 'imagen_generator.py' : 'veo_generator.py';
    const scriptPath = path.join(process.cwd(), 'src', 'lib', scriptFile);

    // Base64-encode args to bypass shell escaping issues (esp. Windows)
    const b64Prompt = Buffer.from(prompt || '').toString('base64');
    const b64Neg = Buffer.from(negativePrompt || '').toString('base64');

    const cmd = `${PYTHON_BIN} "${scriptPath}" "${b64Prompt}" "${b64Neg}" "${outPath}" --base64`;

    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
        if (!fs.existsSync(outPath)) {
          // The generator exited 0 without producing a file. Its stderr is the
          // only clue as to why, so carry it into the error.
          throw new Error(
            `${scriptFile} exited cleanly but produced no file at ${outPath}` +
              (stderr?.trim() ? ` — stderr: ${stderr.trim().slice(0, 500)}` : '')
          );
        }
        return outPath;
      } catch (err: any) {
        // execAsync rejects with stderr attached on a non-zero exit; surface it
        // instead of the generic "Command failed" message.
        const detail = err?.stderr?.trim() || err?.message || String(err);
        lastErr = new Error(detail.slice(0, 500));
        console.warn(`${scriptFile} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErr.message}`);
        // A partial/corrupt file from a failed attempt must not be mistaken for
        // a success by the next existsSync check.
        try { if (fs.existsSync(outPath)) fs.rmSync(outPath, { force: true }); } catch {}
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
      }
    }

    throw new Error(`${mediaType} generation failed after ${MAX_ATTEMPTS} attempts: ${lastErr?.message}`);
  },
};

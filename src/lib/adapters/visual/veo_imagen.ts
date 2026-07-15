import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import type { VisualAdapter } from './base';

const execAsync = util.promisify(exec);

// The Docker image installs `python3`; PYTHON_BIN overrides for local dev
// (e.g. `python` on Windows).
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

export const veoImagenVisualAdapter: VisualAdapter = {
  async generateClip({ prompt, negativePrompt, mediaType, outPath }) {
    const scriptFile = mediaType === 'image' ? 'imagen_generator.py' : 'veo_generator.py';
    const scriptPath = path.join(process.cwd(), 'src', 'lib', scriptFile);

    // Base64-encode args to bypass shell escaping issues (esp. Windows)
    const b64Prompt = Buffer.from(prompt || '').toString('base64');
    const b64Neg = Buffer.from(negativePrompt || '').toString('base64');

    const cmd = `${PYTHON_BIN} "${scriptPath}" "${b64Prompt}" "${b64Neg}" "${outPath}" --base64`;
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });

    if (!fs.existsSync(outPath)) {
      throw new Error(`${scriptFile} completed but produced no file at ${outPath}`);
    }
    return outPath;
  },
};

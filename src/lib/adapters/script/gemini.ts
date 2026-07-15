import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ScriptAdapter, ScriptGenerateOptions } from './base';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callModel(genAI: GoogleGenerativeAI, model: string, opts: ScriptGenerateOptions): Promise<string> {
  const m = genAI.getGenerativeModel({
    model,
    ...(opts.system ? { systemInstruction: opts.system } : {}),
    ...(opts.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  });
  const result = await m.generateContent(opts.prompt);
  return result.response.text();
}

// Replaces the five drifted copies of the Gemini call:
// retry(3, 1s) on the primary model, then one shot on the fallback model.
export const geminiScriptAdapter: ScriptAdapter = {
  async generate(opts) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    const genAI = new GoogleGenerativeAI(apiKey);

    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await callModel(genAI, opts.model, opts);
      } catch (err) {
        lastErr = err as Error;
        console.warn(`Gemini ${opts.model} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErr.message}`);
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
      }
    }

    if (opts.fallbackModel) {
      console.warn(`Falling back to ${opts.fallbackModel}...`);
      try {
        return await callModel(genAI, opts.fallbackModel, opts);
      } catch (err) {
        lastErr = err as Error;
      }
    }

    throw new Error(
      `Script generation failed after ${MAX_ATTEMPTS} attempts on ${opts.model}` +
        (opts.fallbackModel ? ` and fallback ${opts.fallbackModel}` : '') +
        `: ${lastErr?.message}`
    );
  },
};

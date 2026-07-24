import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
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
  // Gemini takes an ordered parts array. Images go first so the model reads the
  // product before the instructions that reference it.
  const parts: Part[] = [
    ...(opts.images ?? []).map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    })),
    { text: opts.prompt },
  ];
  const result = await m.generateContent(parts);
  return result.response.text();
}

// Gemini's documented ceiling is 20 MB for the WHOLE request — prompt text,
// system instruction and every inline image together — not per image
// (ai.google.dev/gemini-api/docs/image-understanding). Inline images travel
// base64-encoded, which inflates them by 4/3, so 12 MB of raw photo bytes is
// ~16 MB on the wire and leaves ~4 MB of the 20 MB for the prompt and the KB
// prose that ships with it. Raw bytes, because that is what a user can measure
// on their own files.
const MAX_INLINE_IMAGE_PAYLOAD_BYTES = 12 * 1024 * 1024;

// Replaces the five drifted copies of the Gemini call:
// retry(3, 1s) on the primary model, then one shot on the fallback model.
export const geminiScriptAdapter: ScriptAdapter = {
  maxInlineImagePayloadBytes: MAX_INLINE_IMAGE_PAYLOAD_BYTES,

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

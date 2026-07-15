// =============================================================================
// VISUAL (B-roll / product clip) ADAPTER — base contract
//
// To add a new provider (e.g. runway, seedance):
//   1. Create ./<provider>.ts exporting a `const <provider>VisualAdapter: VisualAdapter`.
//   2. Register it in ./index.ts under its slug.
//   3. Point a client at it: clients.visual_provider = '<slug>'.
//
// Rules every implementation must follow:
//   - API keys from process.env ONLY; throw early with the env-var name.
//   - Output must be 9:16. Write the clip to req.outPath and return that path;
//     the assembly pipeline reads it from disk.
//   - mediaType 'video' vs 'image' both must be handled (an image is overlaid
//     as a still). Throw if the provider supports neither.
//   - A provider MAY shell out to a script (see src/lib/generators/base.py for
//     the CLI contract the Python generators follow) or call an HTTP API
//     directly — the caller only sees this interface.
// =============================================================================

export interface VisualClipRequest {
  prompt: string;
  negativePrompt?: string;
  mediaType: 'video' | 'image';
  outPath: string;
}

export interface VisualAdapter {
  /** Returns the local path of the generated clip (same as req.outPath). */
  generateClip(req: VisualClipRequest): Promise<string>;
}

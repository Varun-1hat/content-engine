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
//   - referenceImages: when set, the generated clip MUST actually depict THAT
//     subject. A provider that cannot condition generation on an image must
//     THROW — never silently fall back to generating from the text prompt
//     alone. A product ad that renders an invented product looks fine, passes
//     every check, and is worthless; a thrown error is recoverable.
//   - Resilience (retries/backoff) lives HERE, not in the caller: assembly
//     fails the whole stage on a clip failure, so a transient vendor blip must
//     be absorbed by the adapter.
// =============================================================================

/**
 * Model ids from the client's config (DB columns, not code). A provider uses
 * whichever keys apply to it and falls back to its own defaults for the rest —
 * so adding a provider that has no separate "product still" model costs
 * nothing.
 */
export interface VisualModels {
  video?: string;
  image?: string;
  /** Stills that must depict the REAL product (reference-conditioned). */
  productImage?: string;
}

export interface VisualClipRequest {
  prompt: string;
  negativePrompt?: string;
  mediaType: 'video' | 'image';
  outPath: string;
  /**
   * Local paths to images the clip must depict (e.g. this reel's product
   * photos). The generated subject must match these — see the contract rule
   * above. Never more than the adapter's maxReferenceImages.
   */
  referenceImages?: string[];
  models?: VisualModels;
}

/**
 * Composite a real presenter (a person) holding/presenting the product into ONE
 * still — the input to an avatar provider that animates a photo with lip-sync
 * (HeyGen type:'image'). This is how a product ends up IN the avatar shot
 * (held), not behind it as a flat backdrop.
 */
export interface PresenterCompositeRequest {
  /** The avatar's real still — the person whose identity must be preserved. */
  presenterImagePath: string;
  /** Product photo(s) to place in the presenter's hand / frame. */
  productImagePaths: string[];
  /** Scene direction (background, mood). NOT the product's appearance. */
  prompt: string;
  outPath: string;
  models?: VisualModels;
}

export interface VisualAdapter {
  /**
   * How many reference images this provider can actually use. The Studio reads
   * it to cap uploads, so what a user uploads is exactly what gets used —
   * nothing is silently truncated. This is per-provider on purpose: Veo 3.1
   * takes 3, another provider will take a different number, and switching
   * provider must not require a UI change.
   */
  maxReferenceImages: number;
  /** Returns the local path of the generated clip (same as req.outPath). */
  generateClip(req: VisualClipRequest): Promise<string>;
  /**
   * OPTIONAL presenter+product compositing (see PresenterCompositeRequest).
   * Returns the local path of the composite, or throws. A provider that cannot
   * composite people omits this method; the avatar stage then renders a plain
   * talking head and the product appears via B-roll instead — a graceful
   * downgrade, never a failed reel.
   */
  composePresenterProduct?(req: PresenterCompositeRequest): Promise<string>;
}

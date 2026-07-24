import type { ScriptImageInput } from '../adapters/script/base';

// Per-reel product context. Product photos are uploaded per reel (not a stored
// catalog); their Cloudinary URLs live on the job row. When present, the reel is
// a product promo — the photos are passed to the text model alongside the
// prompt, downloaded by the avatar stage for the presenter composite (Route B),
// and used by assembly both as direct stills ("product_image" placements) and as
// reference images that keep a generated clip on the real product.

export function hasProduct(job: { product_image_urls?: string[] | null }): boolean {
  return (job.product_image_urls?.length ?? 0) > 0;
}

/**
 * Prompt context appended to topic/script/b-roll prompts for product reels.
 * Only ever paired with fetchProductImages() — the wording promises the model
 * images, so the caller must actually attach them.
 */
export function productBlock(job: { product_image_urls?: string[] | null }): string {
  const n = job.product_image_urls?.length ?? 0;
  if (n === 0) return '';
  return `

=== PRODUCT REEL ===
This is a product promo. ${n} reference product photo(s) of the EXACT product are included with this request — look at them. The content MUST centre on showcasing that product: describe only features you can actually SEE in the photos, and keep every visual consistent with them (same product, colour, form, branding). Never invent a feature, material, colour or claim that is not visible in the photos.`;
}

/**
 * Per-reel PRECEDENCE clause for the topic stage, never a suppression clause.
 *
 * The research doc's topic-selection rules sit above the product block in the
 * same prompt and outrank it, which is why a product reel could come back with
 * three generic research-doc topics. This states which one wins WHEN THEY
 * DISAGREE — and only for choosing the topic. The template decision tree, the
 * mixed-template check, and hook/close extraction stay governed by the research
 * doc exactly as they are today, so the stage still returns everything it
 * returns today and still parses.
 *
 * Returns '' unless the reel BOTH has photos and had the choice made on it: a
 * flag with no photos is not a product reel, and a product reel where the user
 * did not ask for this behaves byte-for-byte as before.
 */
export function productPrecedenceBlock(job: {
  product_image_urls?: string[] | null;
  product_overrides_research?: boolean | null;
}): string {
  if (!hasProduct(job) || job.product_overrides_research !== true) return '';
  return `

=== PRODUCT PRIORITY (TOPIC SELECTION ONLY) ===
For THIS reel the uploaded product is the subject. Every one of the 3 topics you propose must be about that product — how it is used, the benefit it delivers, the problem it solves, or the audience it is for. Where the research document's usual topic list and the uploaded product point in different directions, the product wins the topic choice.
Everything else in the research document still governs this reel exactly as always: run the same topic analysis, the same template decision tree, the same mixed-template check, and the same hook & close extraction — applied to the product topics you have chosen.`;
}

/**
 * The one photo-size limit a user can hit, stated in the units they see on
 * their own files (raw MB). Exported so the message can be asserted without a
 * network call — and so the Studio, /api/uploads, POST /api/jobs and the stage
 * check all say the same number.
 */
export function productPayloadLimitMessage(totalBytes: number, maxTotalBytes: number): string {
  return (
    `This reel's product photos total ${mb(totalBytes)} MB, over the ${mbLimit(maxTotalBytes)} MB ` +
    `this client's script model accepts for one request. Remove a photo or use smaller files.`
  );
}

/**
 * The ONE size decision, in one place: same axis (the reel's total raw photo
 * bytes), same comparison (`>`, so a reel exactly at the limit is accepted),
 * same wording wherever it is made.
 *
 * `POST /api/jobs` makes it before the reel row exists — the only moment the
 * user can still remove a photo, since the picker is setup-screen-only.
 * `fetchProductImages` makes it again on the bytes it actually downloaded, so
 * the stage is still self-defending. Two surfaces, one rule: a photo accepted
 * at upload can never be rejected for size by a stage.
 */
export function productPayloadRefusal(totalBytes: number, maxTotalBytes: number): string | null {
  return totalBytes > maxTotalBytes ? productPayloadLimitMessage(totalBytes, maxTotalBytes) : null;
}

/**
 * The single-file arm of that same rule, for /api/uploads — which sees one file
 * at a time and has no reel to total against yet.
 *
 * The ceiling is a per-reel TOTAL, so a lone file already over it can never be
 * part of a usable reel and is refused on arrival. The message names the axis it
 * is measuring, so this refusal and the Studio's "a reel can carry N MB of
 * product photos in total" cannot be read as two different limits.
 */
export function productPhotoTooLargeMessage(fileBytes: number, maxTotalBytes: number): string {
  return (
    `This photo is ${mb(fileBytes)} MB. A reel's product photos may total ${mbLimit(maxTotalBytes)} MB ` +
    `for this client's script model, so this one file is over the reel's limit on its own. ` +
    `Use a smaller file.`
  );
}

/**
 * Bytes as MB for a user-facing message.
 *
 * The MEASURED value rounds UP and the LIMIT rounds down (`mbLimit`), so a file
 * that is over the ceiling always reads as a bigger number than the ceiling.
 * Plain `.toFixed(1)` on both made the refusal contradict itself at the
 * boundary: 12 MB + 1 byte rendered as "This photo is 12.0 MB … may total
 * 12.0 MB … so this one file is over the reel's limit on its own."
 */
function mb(bytes: number): string {
  return (Math.ceil((bytes / 1024 / 1024) * 10) / 10).toFixed(1);
}

/** The limit itself: rounded DOWN, so we never state a ceiling above the real one. */
function mbLimit(bytes: number): string {
  return (Math.floor((bytes / 1024 / 1024) * 10) / 10).toFixed(1);
}

/** Thrown when a photo's size cannot be established at all. */
export const PRODUCT_PHOTO_UNREADABLE = 'PRODUCT_PHOTO_UNREADABLE';

/**
 * Total raw bytes of a reel's product photos, measured on the stored files
 * themselves so the number is the same one fetchProductImages will measure
 * later. Used by POST /api/jobs, which knows the reel's whole photo set — the
 * per-file check at upload cannot see three individually-fine photos that
 * together blow the request ceiling.
 *
 * HEAD first (the storage CDN answers with Content-Length); a missing or
 * unusable Content-Length falls back to reading the body, because a guess here
 * re-opens the gap this exists to close. Throws when a photo cannot be measured
 * at all — that photo would have failed the stage that attaches it anyway, and
 * refusing before the row exists leaves the user on the setup screen with the
 * picker still in reach.
 */
export async function measureProductPayloadBytes(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;
  const sizes = await Promise.all(urls.map(measureRemoteBytes));
  return sizes.reduce((sum, n) => sum + n, 0);
}

async function measureRemoteBytes(url: string): Promise<number> {
  const head = await tryFetch(url, { method: 'HEAD' });
  if (head?.ok) {
    const declared = Number(head.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > 0) return declared;
  }
  const res = await tryFetch(url);
  if (!res?.ok) {
    throw new Error(`${PRODUCT_PHOTO_UNREADABLE}: ${url} (HTTP ${res?.status ?? 'no response'})`);
  }
  return (await res.arrayBuffer()).byteLength;
}

async function tryFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}

export interface FetchProductImagesOptions {
  /** How many photos the model may receive — from the adapter, never a local constant. */
  maxImages: number;
  /**
   * The largest TOTAL of raw photo bytes for one request — from the SCRIPT
   * adapter (ScriptAdapter.maxInlineImagePayloadBytes), because the script model
   * is what receives them inline. A per-image cap measures the wrong axis: three
   * photos each under the per-image limit can still blow the request ceiling.
   */
  maxTotalBytes: number;
}

/**
 * Download this reel's product photos and return them as inline model input.
 * Throws if a photo can't be fetched: a product reel whose model never saw the
 * product is worse than a failed stage, because the failure is invisible until
 * a client watches the reel.
 *
 * Both limits are supplied by the CALLER, read off the adapters at the call
 * site. They are per-model facts, so they must not be defaulted here — a shared
 * constant in this module would be exactly the global ceiling that stops a new
 * model bringing its own number.
 */
export async function fetchProductImages(
  job: { product_image_urls?: string[] | null },
  opts: FetchProductImagesOptions
): Promise<ScriptImageInput[]> {
  const urls = (job.product_image_urls ?? []).slice(0, opts.maxImages);
  if (urls.length === 0) return [];

  const fetched = await Promise.all(
    urls.map(async (url) => {
      let res: Response;
      try {
        res = await fetch(url);
      } catch (err: any) {
        throw new Error(`Could not fetch product photo ${url}: ${err?.message ?? err}`);
      }
      if (!res.ok) {
        throw new Error(`Could not fetch product photo ${url} (HTTP ${res.status})`);
      }

      const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
      if (!mimeType.startsWith('image/')) {
        throw new Error(`Product photo ${url} is not an image (${mimeType})`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      return { base64: buf.toString('base64'), mimeType, byteLength: buf.byteLength };
    })
  );

  const totalBytes = fetched.reduce((sum, f) => sum + f.byteLength, 0);
  const refusal = productPayloadRefusal(totalBytes, opts.maxTotalBytes);
  if (refusal) throw new Error(refusal);

  return fetched.map(({ base64, mimeType }) => ({ base64, mimeType }));
}

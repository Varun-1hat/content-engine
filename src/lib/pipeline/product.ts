import type { ScriptImageInput } from '../adapters/script/base';

// Per-reel product context. Product photos are uploaded per reel (not a stored
// catalog); their Cloudinary URLs live on the job row. When present, the reel is
// a product promo — the photos are passed to the model alongside the prompt, and
// the avatar/assembly stages consume them too (HeyGen background / B-roll image
// placements).

// Product photos come from our own Cloudinary folder (uploaded via /api/uploads,
// which is image-only and caps at 20 MB). The cap here is a belt-and-braces
// guard on the model payload, not a trust boundary.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 4;

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
 * Download this reel's product photos and return them as inline model input.
 * Throws if a photo can't be fetched: a product reel whose model never saw the
 * product is worse than a failed stage, because the failure is invisible until
 * a client watches the reel.
 */
export async function fetchProductImages(job: {
  product_image_urls?: string[] | null;
}): Promise<ScriptImageInput[]> {
  const urls = (job.product_image_urls ?? []).slice(0, MAX_IMAGES);
  if (urls.length === 0) return [];

  return Promise.all(
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
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(
          `Product photo ${url} is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB — over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB model limit.`
        );
      }
      return { base64: buf.toString('base64'), mimeType };
    })
  );
}

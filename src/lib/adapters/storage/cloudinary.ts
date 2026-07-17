import { v2 as cloudinary } from 'cloudinary';
import type { StorageAdapter, StoredAsset } from './base';

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary env vars missing (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET)');
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  configured = true;
}

// Cloudinary's Admin API caps a listing page at 500.
const PAGE_SIZE = 500;

export const cloudinaryStorageAdapter: StorageAdapter = {
  async list(prefix, resourceType = 'image') {
    ensureConfigured();
    const assets: StoredAsset[] = [];
    let nextCursor: string | undefined;
    do {
      const res: any = await cloudinary.api.resources({
        type: 'upload',
        resource_type: resourceType,
        prefix,
        max_results: PAGE_SIZE,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      });
      for (const r of res.resources ?? []) {
        assets.push({
          publicId: r.public_id,
          url: r.secure_url,
          createdAt: r.created_at,
          bytes: r.bytes ?? 0,
        });
      }
      nextCursor = res.next_cursor;
    } while (nextCursor);
    return assets;
  },

  async remove(publicIds, resourceType = 'image') {
    ensureConfigured();
    if (publicIds.length === 0) return 0;
    let deleted = 0;
    // delete_resources takes at most 100 ids per call.
    for (let i = 0; i < publicIds.length; i += 100) {
      const batch = publicIds.slice(i, i + 100);
      const res: any = await cloudinary.api.delete_resources(batch, { resource_type: resourceType });
      deleted += Object.values(res.deleted ?? {}).filter((v) => v === 'deleted').length;
    }
    return deleted;
  },

  upload(buffer, { folder, resourceType = 'video' }) {
    ensureConfigured();
    return new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: resourceType, folder },
        (error, result) => {
          if (error) return reject(error);
          if (result) return resolve(result.secure_url);
          reject(new Error('Unknown Cloudinary error'));
        }
      );
      uploadStream.end(buffer);
    });
  },
};

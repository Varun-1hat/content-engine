import { v2 as cloudinary } from 'cloudinary';
import type { StorageAdapter } from './base';

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

export const cloudinaryStorageAdapter: StorageAdapter = {
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

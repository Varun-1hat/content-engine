// =============================================================================
// STORAGE (media hosting) ADAPTER — base contract
//
// To add a new provider (e.g. s3, mux):
//   1. Create ./<provider>.ts exporting a `const <provider>StorageAdapter: StorageAdapter`.
//   2. Register it in ./index.ts under its slug.
//   3. Point a client at it: clients.storage_provider = '<slug>', with the
//      client's folder namespace in clients.storage_folder_prefix.
//
// Rules every implementation must follow:
//   - Credentials from process.env ONLY; throw early with the env-var name.
//   - Return a publicly fetchable HTTPS URL — downstream vendors (HeyGen etc.)
//     download media from this URL, so it cannot require auth headers.
//   - Respect the folder namespace passed in; never invent paths.
//   - list/remove are OPTIONAL (only the cleanup route needs them). Implement
//     both or neither. `remove` must delete exactly the ids it is given and
//     nothing else — the caller has already decided what is safe to delete.
// =============================================================================

export interface UploadOptions {
  folder: string;
  resourceType?: 'video' | 'image' | 'raw';
}

export interface StoredAsset {
  /** Provider-side id used for deletion. */
  publicId: string;
  url: string;
  /** ISO-8601. */
  createdAt: string;
  bytes: number;
}

export interface StorageAdapter {
  upload(buffer: Buffer, opts: UploadOptions): Promise<string>;
  /** Every asset under a folder prefix. Optional. */
  list?(prefix: string, resourceType?: 'video' | 'image' | 'raw'): Promise<StoredAsset[]>;
  /** Delete by publicId; returns how many were deleted. Optional. */
  remove?(publicIds: string[], resourceType?: 'video' | 'image' | 'raw'): Promise<number>;
}

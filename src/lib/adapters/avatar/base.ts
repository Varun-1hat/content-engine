// =============================================================================
// AVATAR (talking head) ADAPTER — base contract
//
// To add a new provider (e.g. d-id, synthesia):
//   1. Create ./<provider>.ts exporting a `const <provider>AvatarAdapter: AvatarAdapter`.
//   2. Register it in ./index.ts under its slug.
//   3. Point a client at it: clients.avatar_provider = '<slug>'. Per-look
//      vendor IDs live in client_avatars.avatar_id.
//
// Rules every implementation must follow:
//   - API keys from process.env ONLY; throw early with the env-var name.
//   - Output must be 1080x1920 (9:16 is the product).
//   - Submit + poll internally; the caller gets one promise for the final URL.
//   - Call onSubmitted(providerJobId) as soon as the vendor job id exists, so
//     the caller can persist it (jobs.provider_job_ids) before polling starts —
//     that's what makes a crashed render reconcilable.
// =============================================================================

export interface AvatarRenderOptions {
  avatarId: string;
  audioUrl: string;
  // A pre-composited "presenter holding the product" still (public URL). When
  // set, the provider animates THIS image with lip-sync (product IN the shot,
  // held) instead of rendering the plain avatar_id. Omitted for talking-head
  // reels. Built by the visual adapter's composePresenterProduct().
  presenterImageUrl?: string;
  onSubmitted?: (providerJobId: string) => void | Promise<void>;
}

export interface AvatarRenderResult {
  videoUrl: string;
  providerJobId: string;
}

export interface AvatarAdapter {
  render(opts: AvatarRenderOptions): Promise<AvatarRenderResult>;
  /**
   * OPTIONAL. The avatar's real still image (a public URL), used as the person
   * input when compositing the presenter with a product. A provider that can't
   * supply one omits this; the avatar stage then skips the composite and renders
   * a plain talking head (product still appears via B-roll).
   */
  getPresenterImage?(avatarId: string): Promise<string | null>;
}

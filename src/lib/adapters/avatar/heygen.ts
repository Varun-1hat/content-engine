import type { AvatarAdapter } from './base';

// HeyGen v3 API. Every field, status value and response shape below is taken
// from the published reference — nothing here is inferred:
//   POST /v3/videos          https://developers.heygen.com/reference/create-video
//   GET  /v3/videos/{id}     https://developers.heygen.com/reference/get-video
//   migration + retirement   https://developers.heygen.com/endpoint-version-comparison
//
// We were on POST /v2/video/generate + GET /v1/video_status.get. Both are
// retired on 2026-11-01 ("v1/v2 endpoints remain fully operational through
// October 31, 2026"), so they are migrated here rather than left to break.

const API_BASE = 'https://api.heygen.com';

const POLL_INTERVAL_MS = 5000;
// 15 min ceiling: HeyGen's end-to-end (queue + render + encode) exceeds 5 min
// under load even for short clips. On timeout the render is NOT lost — the
// vendor job id is persisted (jobs.provider_job_ids) for reconciliation.
// Real fix at higher volume: v3 supports callback_url (webhooks) — deferred.
const MAX_POLL_ATTEMPTS = 180; // 180 * 5s = 15 minutes
// A poll that errors is a transient network/vendor blip, not a finished render.
// Tolerate a few in a row, but never loop silently for 15 minutes on a hard
// failure (401/404) — that reports "timed out" and hides the real cause.
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

/** Documented error body: { error: { code, message, param, doc_url } }. */
function errorMessage(body: any, fallback: string): string {
  const e = body?.error;
  if (!e) return fallback;
  if (typeof e === 'string') return e;
  const parts = [e.code, e.message].filter(Boolean).join(': ');
  return parts || fallback;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const heygenAvatarAdapter: AvatarAdapter = {
  async render({ avatarId, audioUrl, attachmentImageUrls, onSubmitted }) {
    const apiKey = process.env.HEYGEN_API_KEY;
    if (!apiKey) throw new Error('HEYGEN_API_KEY is not set');
    if (!avatarId) throw new Error('avatarId is required (no client_avatars row matched)');
    if (!audioUrl) throw new Error('audioUrl is required (the avatar is lip-synced to it)');

    // v3 is a flat, top-level body (v2's nested video_inputs[].character/voice is
    // gone). 9:16 at 1080p is the product.
    const payload: Record<string, unknown> = {
      type: 'avatar',
      avatar_id: avatarId,
      audio_url: audioUrl,
      aspect_ratio: '9:16',
      resolution: '1080p',
    };

    // Product reels: the uploaded photo becomes the scene background, so the
    // presenter is filmed against the product. `background` accepts a public url
    // directly ({ type: 'image', url }) — no asset upload needed. NOTE: a
    // background is the only documented way to get a product into an avatar
    // render; it is NOT a product-placement/overlay feature. Assembly also
    // places the product photos as B-roll, which is what actually guarantees the
    // product appears in the finished reel.
    if (attachmentImageUrls && attachmentImageUrls.length > 0) {
      payload.background = { type: 'image', url: attachmentImageUrls[0] };
    }

    // --- Submit ---------------------------------------------------------------
    let createRes: Response;
    try {
      createRes = await fetch(`${API_BASE}/v3/videos`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      throw new Error(`Could not reach HeyGen: ${err?.message ?? err}`);
    }

    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      throw new Error(
        `HeyGen rejected the render (HTTP ${createRes.status}): ${errorMessage(createBody, 'no error detail returned')}`
      );
    }

    const providerJobId: string | undefined = createBody?.data?.video_id;
    if (!providerJobId) {
      throw new Error(
        `HeyGen returned 200 without a video_id: ${errorMessage(createBody, JSON.stringify(createBody).slice(0, 300))}`
      );
    }
    if (onSubmitted) await onSubmitted(providerJobId);

    // --- Poll -----------------------------------------------------------------
    // Documented statuses: pending | processing | completed | failed (create also
    // returns "waiting"). Anything unrecognised is treated as still-in-progress
    // rather than as a silent success.
    let consecutiveErrors = 0;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      let statusRes: Response;
      try {
        statusRes = await fetch(`${API_BASE}/v3/videos/${providerJobId}`, {
          method: 'GET',
          headers: { 'x-api-key': apiKey },
        });
      } catch (err: any) {
        if (++consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          throw new Error(
            `Lost contact with HeyGen while polling render ${providerJobId}: ${err?.message ?? err}`
          );
        }
        continue;
      }

      // 429 is explicitly retryable and carries Retry-After; anything else in the
      // 4xx range (401 bad key, 404 unknown video) will never resolve by waiting.
      if (statusRes.status === 429) {
        const retryAfter = Number(statusRes.headers.get('retry-after')) || 10;
        await sleep(retryAfter * 1000);
        continue;
      }
      const statusBody = await statusRes.json().catch(() => ({}));
      if (!statusRes.ok) {
        if (statusRes.status >= 400 && statusRes.status < 500) {
          throw new Error(
            `HeyGen render ${providerJobId} could not be polled (HTTP ${statusRes.status}): ${errorMessage(statusBody, 'no error detail returned')}`
          );
        }
        if (++consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          throw new Error(
            `HeyGen kept failing while polling render ${providerJobId} (HTTP ${statusRes.status}): ${errorMessage(statusBody, 'no error detail returned')}`
          );
        }
        continue;
      }
      consecutiveErrors = 0;

      const data = statusBody?.data;
      const status: string | undefined = data?.status;

      if (status === 'completed') {
        const videoUrl: string | undefined = data?.video_url;
        if (!videoUrl) {
          throw new Error(`HeyGen reported render ${providerJobId} completed but returned no video_url`);
        }
        return { videoUrl, providerJobId };
      }
      if (status === 'failed') {
        // Documented failure fields — surface the vendor's reason instead of a
        // generic "generation failed".
        const reason = [data?.failure_code, data?.failure_message].filter(Boolean).join(': ');
        throw new Error(`HeyGen render ${providerJobId} failed${reason ? `: ${reason}` : ' (no reason given)'}`);
      }
    }

    throw new Error(
      `HeyGen render ${providerJobId} did not finish within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60000} minutes (still queued or rendering; the id is saved for reconciliation)`
    );
  },
};

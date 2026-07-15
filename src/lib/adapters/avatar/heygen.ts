import type { AvatarAdapter } from './base';

const POLL_INTERVAL_MS = 5000;
// 15 min ceiling: HeyGen's end-to-end (queue + render + encode) exceeds 5 min
// under load even for short clips. On timeout the render is NOT lost — the
// vendor job id is persisted (jobs.provider_job_ids) for reconciliation.
// Real fix at higher volume: HeyGen webhooks instead of polling (deferred).
const MAX_POLL_ATTEMPTS = 180; // 180 * 5s = 15 minutes

export const heygenAvatarAdapter: AvatarAdapter = {
  async render({ avatarId, audioUrl, onSubmitted }) {
    const apiKey = process.env.HEYGEN_API_KEY;
    if (!apiKey) throw new Error('HEYGEN_API_KEY is not set');
    if (!avatarId) throw new Error('avatarId is required (no client_avatars row matched)');

    // Step 1: submit generation request (9:16 vertical is the product)
    const generateRes = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_inputs: [
          {
            character: {
              type: 'avatar',
              avatar_id: avatarId,
              avatar_style: 'normal',
              version: 'v4',
            },
            voice: {
              type: 'audio',
              audio_url: audioUrl,
            },
          },
        ],
        dimension: { width: 1080, height: 1920 },
      }),
    });

    const generateData = await generateRes.json();
    if (generateData.error || !generateData.data?.video_id) {
      throw new Error(generateData.error?.message || 'Failed to submit HeyGen video generation');
    }

    const providerJobId: string = generateData.data.video_id;
    if (onSubmitted) await onSubmitted(providerJobId);

    // Step 2: poll for completion
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const statusRes = await fetch(
        `https://api.heygen.com/v1/video_status.get?video_id=${providerJobId}`,
        { method: 'GET', headers: { 'X-Api-Key': apiKey } }
      );
      const statusData = await statusRes.json();

      if (statusData.data?.status === 'completed') {
        return { videoUrl: statusData.data.video_url, providerJobId };
      }
      if (statusData.data?.status === 'failed') {
        throw new Error(`HeyGen video generation failed (job ${providerJobId})`);
      }
    }

    throw new Error(`HeyGen video generation timed out (job ${providerJobId})`);
  },
};

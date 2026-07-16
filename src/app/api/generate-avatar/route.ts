import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getAvatarAdapter } from '@/lib/adapters/avatar';
import { getJob, startStage, completeStage, failStage, updateJobInternal, stageNotInPlan } from '@/lib/jobs';

// POST /api/generate-avatar — talking-head render ('avatar' stage).
// The browser sends the LABEL; the server resolves it to the vendor avatar_id
// via client_avatars. Vendor IDs never ship to the browser.
// Body: { clientId, audioUrl, avatarLabel?, jobId? }
export async function POST(req: Request) {
  let jobId: string | undefined;
  try {
    const body = await req.json();
    const { clientId, audioUrl, avatarLabel } = body;
    jobId = body.jobId;

    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;

    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (job.client_id !== clientId) return NextResponse.json({ error: 'Job does not belong to this client' }, { status: 403 });
    const offPlan = stageNotInPlan(job, 'avatar');
    if (offPlan) return offPlan;
    if (!audioUrl) return NextResponse.json({ error: 'Missing audioUrl' }, { status: 400 });

    const c = await loadClientConfig(clientId);

    const avatar = (avatarLabel && c.avatars.find((a) => a.label === avatarLabel)) || c.avatars[0];
    if (!avatar) {
      return NextResponse.json(
        { error: `Client "${c.id}" has no avatars configured (client_avatars is empty)` },
        { status: 400 }
      );
    }

    await startStage(jobId, 'avatar');

    const { videoUrl, providerJobId } = await getAvatarAdapter(c.avatarProvider).render({
      avatarId: avatar.avatar_id,
      audioUrl,
      // Per-reel product photos feature in the render (variant: avatar + product).
      attachmentImageUrls: job.product_image_urls?.length ? job.product_image_urls : undefined,
      // Persist the vendor job id before polling starts so a crashed render
      // can be reconciled from the jobs table.
      onSubmitted: async (pid) => {
        await updateJobInternal(jobId!, { provider_job_ids: { [c.avatarProvider]: pid } });
      },
    });

    await completeStage(jobId, 'avatar', {
      avatar_video_url: videoUrl,
      avatar_label: avatar.label,
    });

    return NextResponse.json({ success: true, avatarVideoUrl: videoUrl, providerJobId });
  } catch (error: any) {
    console.error('Avatar Render Error:', error);
    if (jobId) await failStage(jobId, 'avatar', error).catch(() => {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getAvatarAdapter } from '@/lib/adapters/avatar';
import { getVisualAdapter } from '@/lib/adapters/visual';
import { getStorageAdapter } from '@/lib/adapters/storage';
import { downloadToFile, extensionFromUrl, extensionFromMimeType } from '@/lib/pipeline/download';
import { getJob, startStage, completeStage, failStage, updateJobInternal, stageNotInPlan } from '@/lib/jobs';
import type { ResolvedClient } from '@/lib/clients/types';

/**
 * Product + avatar reel: composite the presenter holding the product into one
 * still, so HeyGen animates the product IN the shot (type:'image') instead of
 * putting it behind a letterboxed avatar. Returns the composite's public URL, or
 * null to fall back to a plain talking head (the product still appears via
 * B-roll). NEVER throws — a composite that fails must downgrade, not fail the
 * reel.
 */
async function buildPresenterComposite(
  c: ResolvedClient,
  avatarId: string,
  productUrls: string[]
): Promise<string | null> {
  const avatarAdapter = getAvatarAdapter(c.avatarProvider);
  const visual = getVisualAdapter(c.visual.provider);
  // Both capabilities are optional; without either, downgrade cleanly.
  if (!avatarAdapter.getPresenterImage || !visual.composePresenterProduct) return null;

  let tempDir = '';
  try {
    const presenterUrl = await avatarAdapter.getPresenterImage(avatarId);
    if (!presenterUrl) return null;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presenter-'));

    // The presenter still must be named for what it ACTUALLY is: the compositor
    // resolves its MIME type from the file extension, so a hardcoded
    // 'presenter.jpg' declares image/jpeg for every avatar — and HeyGen serves
    // .webp for 3 of Kiran's 4. That is M12's exact shape (a webp declared jpeg),
    // surviving only because Gemini is more lenient about it than Veo.
    // URL extension first, then the response's own Content-Type; if neither is
    // usable we THROW rather than guess — the catch below turns that into the
    // graceful plain-talking-head downgrade, which is strictly better than a
    // confidently wrong declaration.
    const downloadPath = path.join(tempDir, 'presenter.download');
    const { contentType } = await downloadToFile(presenterUrl, downloadPath);
    const presenterExt = extensionFromUrl(presenterUrl) ?? extensionFromMimeType(contentType);
    if (!presenterExt) {
      throw new Error(
        `Could not determine the presenter still's image format (URL "${presenterUrl}" carries no known image extension, Content-Type was "${contentType ?? 'none'}").`
      );
    }
    const presenterPath = path.join(tempDir, `presenter${presenterExt}`);
    fs.renameSync(downloadPath, presenterPath);

    const productPaths: string[] = [];
    for (const [i, url] of productUrls.slice(0, visual.maxReferenceImages).entries()) {
      const ext = path.extname(new URL(url).pathname).toLowerCase() || '.jpg';
      const p = path.join(tempDir, `product_${i}${ext}`);
      await downloadToFile(url, p);
      productPaths.push(p);
    }

    const outPath = path.join(tempDir, 'composite.png');
    await visual.composePresenterProduct({
      presenterImagePath: presenterPath,
      productImagePaths: productPaths,
      prompt: 'clean modern studio background, soft even lighting, product clearly visible',
      outPath,
      models: c.visual.models,
    });

    const folderPrefix = c.storage.folderPrefix || c.slug;
    return await getStorageAdapter(c.storage.provider).upload(fs.readFileSync(outPath), {
      folder: `${folderPrefix}/jobs/_incoming/presenter`,
      resourceType: 'image',
    });
  } catch (err: any) {
    // Downgrade, don't fail: the reel still renders as a talking head and the
    // product appears via B-roll. Log so the flakiness is visible.
    console.warn(`Presenter composite failed, falling back to plain avatar: ${err?.message ?? err}`);
    return null;
  } finally {
    if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  }
}

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

    // Product reel: try to composite the presenter holding the product so it's
    // IN the render. Falls back to null (plain talking head) if unavailable or
    // if the composite fails — the product still appears via B-roll either way.
    const productUrls = job.product_image_urls ?? [];
    const presenterImageUrl = productUrls.length
      ? await buildPresenterComposite(c, avatar.avatar_id, productUrls)
      : null;

    const { videoUrl, providerJobId } = await getAvatarAdapter(c.avatarProvider).render({
      avatarId: avatar.avatar_id,
      audioUrl,
      presenterImageUrl: presenterImageUrl ?? undefined,
      // Persist the vendor job id before polling starts so a crashed render
      // can be reconciled from the jobs table. Merge rather than replace: the
      // column is a map keyed by provider, and a bare assignment would drop any
      // id another provider had already recorded for this reel.
      onSubmitted: async (pid) => {
        await updateJobInternal(jobId!, {
          provider_job_ids: { ...(job.provider_job_ids ?? {}), [c.avatarProvider]: pid },
        });
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

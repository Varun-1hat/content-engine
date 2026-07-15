import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getVisualAdapter } from '@/lib/adapters/visual';
import { getStorageAdapter } from '@/lib/adapters/storage';
import { downloadToFile, overlayBrolls, type BrollPlacement } from '@/lib/pipeline/assembly';
import { startStage, completeStage, failStage, logJobEvent, jobClientMismatch } from '@/lib/jobs';

// POST /api/assemble-video — generate B-roll clips + stitch ('assemble' stage).
// Body: { clientId, avatarVideoUrl, brollPlan, jobId? }
export async function POST(req: Request) {
  let jobId: string | undefined;
  let tempDir = '';
  try {
    const body = await req.json();
    const { clientId, avatarVideoUrl, brollPlan } = body;
    jobId = body.jobId;

    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;
    if (jobId) {
      const jobForbidden = await jobClientMismatch(jobId, clientId);
      if (jobForbidden) return jobForbidden;
    }
    if (!avatarVideoUrl || !brollPlan) {
      return NextResponse.json({ error: 'Missing avatarVideoUrl or brollPlan' }, { status: 400 });
    }

    const c = await loadClientConfig(clientId);
    if (jobId) await startStage(jobId, 'assemble');

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-assembly-'));

    // 1. Download the base (avatar) video
    const avatarPath = path.join(tempDir, 'avatar.mp4');
    await downloadToFile(avatarVideoUrl, avatarPath);

    // 2. Generate B-roll clips in parallel via the client's visual provider.
    // Per-clip failures degrade gracefully (clip skipped, avatar shows through).
    const brolls: any[] = Array.isArray(brollPlan) ? brollPlan : brollPlan.broll || [];
    const visual = getVisualAdapter(c.visual.provider);
    const placements: BrollPlacement[] = [];
    const failedClips: number[] = [];

    await Promise.all(
      brolls.map(async (b: any, index: number) => {
        const isImage = b.media_type === 'image';
        const outPath = path.join(tempDir, `broll_${index}${isImage ? '.jpg' : '.mp4'}`);
        try {
          await visual.generateClip({
            prompt: b.veo_prompt || b.prompt || '',
            negativePrompt: b.negative_prompt || '',
            mediaType: isImage ? 'image' : 'video',
            outPath,
          });
          placements.push({
            localPath: outPath,
            start: b.start_second ?? b.start ?? 0,
            end: b.end_second ?? b.end ?? 0,
            isImage,
          });
        } catch (e: any) {
          failedClips.push(index);
          console.error(`Visual generation failed for broll ${index}:`, e?.message || e);
        }
      })
    );

    if (jobId && failedClips.length > 0) {
      await logJobEvent(jobId, 'assemble', 'retried', {
        note: 'clips failed and were skipped',
        failedClips,
      });
    }

    // 3. Stitch
    const outputPath = path.join(tempDir, 'final_output.mp4');
    await overlayBrolls(avatarPath, placements, outputPath);

    // 4. Upload
    const folderPrefix = c.storage.folderPrefix || c.id;
    const finalVideoUrl = await getStorageAdapter(c.storage.provider).upload(
      fs.readFileSync(outputPath),
      { folder: `${folderPrefix}/assembled`, resourceType: 'video' }
    );

    if (jobId) {
      await completeStage(jobId, 'assemble', { final_video_url: finalVideoUrl });
    }

    return NextResponse.json({ success: true, finalVideoUrl, failedClips });
  } catch (error: any) {
    console.error('Assemble Error:', error);
    if (jobId) await failStage(jobId, 'assemble', error).catch(() => {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

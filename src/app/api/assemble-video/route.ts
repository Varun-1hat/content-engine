import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getVisualAdapter } from '@/lib/adapters/visual';
import { getStorageAdapter } from '@/lib/adapters/storage';
import { downloadToFile, overlayBrolls, concatBrolls, type BrollPlacement } from '@/lib/pipeline/assembly';
import { getJob, startStage, completeStage, failStage, stageNotInPlan } from '@/lib/jobs';
import { getJobStagePlan } from '@/lib/pipeline/stages';

// POST /api/assemble-video — generate B-roll clips + stitch ('assemble' stage).
// Two modes, chosen by the job's plan:
//   * avatar in plan  -> OVERLAY mode: B-roll is overlaid onto the avatar base.
//   * no avatar       -> CONCAT mode: B-roll clips ARE the video; the job's
//                        audio (voiceover) is muxed over, or it's silent.
// Body: { clientId, jobId, avatarVideoUrl?, brollPlan? } (fall back to job row).
export async function POST(req: Request) {
  let jobId: string | undefined;
  let tempDir = '';
  try {
    const body = await req.json();
    const { clientId } = body;
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
    const offPlan = stageNotInPlan(job, 'assemble');
    if (offPlan) return offPlan;

    const plan = getJobStagePlan(job);
    const overlayMode = plan.includes('avatar');
    const plansBroll = plan.includes('broll_plan');
    const avatarVideoUrl = body.avatarVideoUrl ?? job.avatar_video_url;
    const brollPlan = body.brollPlan ?? job.broll_plan;

    if (overlayMode && !avatarVideoUrl) {
      return NextResponse.json({ error: 'Missing avatarVideoUrl (avatar-overlay assembly needs the avatar base video)' }, { status: 400 });
    }
    // A plan without the broll_plan stage is a talking-head reel: the avatar IS
    // the video, so assembly is a pass-through. Only demand a b-roll plan when
    // the reel's plan actually runs the stage that produces one.
    if (plansBroll && !brollPlan) {
      return NextResponse.json({ error: 'Missing brollPlan' }, { status: 400 });
    }

    const c = await loadClientConfig(clientId);
    await startStage(jobId, 'assemble');

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-assembly-'));

    // Resolve/generate each B-roll entry into a local file + placement.
    const brolls: any[] = !brollPlan ? [] : Array.isArray(brollPlan) ? brollPlan : brollPlan.broll || [];
    const visual = getVisualAdapter(c.visual.provider);
    const placements: BrollPlacement[] = [];
    const failedClips: { index: number; reason: string }[] = [];
    const productUrls = job.product_image_urls ?? [];

    await Promise.all(
      brolls.map(async (b: any, index: number) => {
        const start = b.start_second ?? b.start ?? 0;
        const end = b.end_second ?? b.end ?? 0;
        try {
          if (b.media_type === 'product_image') {
            // Direct placement of an uploaded product photo — no generation.
            const idx = b.product_image_index ?? 0;
            const url = productUrls[idx];
            if (!url) throw new Error(`product_image_index ${idx} has no uploaded photo`);
            const outPath = path.join(tempDir, `broll_${index}.jpg`);
            await downloadToFile(url, outPath);
            placements.push({ localPath: outPath, start, end, isImage: true });
            return;
          }
          const isImage = b.media_type === 'image';
          const outPath = path.join(tempDir, `broll_${index}${isImage ? '.jpg' : '.mp4'}`);
          await visual.generateClip({
            prompt: b.veo_prompt || b.prompt || '',
            negativePrompt: b.negative_prompt || '',
            mediaType: isImage ? 'image' : 'video',
            outPath,
          });
          placements.push({ localPath: outPath, start, end, isImage });
        } catch (e: any) {
          failedClips.push({ index, reason: e?.message || String(e) });
          console.error(`Visual generation failed for broll ${index}:`, e?.message || e);
        }
      })
    );

    // A vendor failure must never be silently absorbed into a "done" reel. A
    // clip that failed to generate is missing content, not a stage that wasn't
    // required — so fail the stage and let it be retried. Delivering a reel with
    // holes in it, marked done, is the worse outcome: nobody finds out until a
    // client watches it.
    // (failStage in the catch below logs the 'failed' event — don't double-log.)
    if (failedClips.length > 0) {
      const detail = failedClips
        .sort((a, b) => a.index - b.index)
        .map((f) => `#${f.index + 1}: ${f.reason}`)
        .join(' | ');
      throw new Error(
        `${failedClips.length} of ${brolls.length} B-roll item(s) failed to generate, so the reel was not assembled — ${detail}`
      );
    }

    const outputPath = path.join(tempDir, 'final_output.mp4');

    if (overlayMode) {
      // Overlay B-roll onto the avatar base (preserves the avatar's audio).
      const avatarPath = path.join(tempDir, 'avatar.mp4');
      await downloadToFile(avatarVideoUrl, avatarPath);
      await overlayBrolls(avatarPath, placements, outputPath);
    } else {
      // Concat the clips into the whole video; mux the voiceover if there is one.
      let audioPath: string | undefined;
      if (job.audio_url) {
        audioPath = path.join(tempDir, 'voice.mp3');
        await downloadToFile(job.audio_url, audioPath);
      }
      if (placements.length === 0) throw new Error('No B-roll clips were produced to assemble');
      await concatBrolls(placements, { audioPath }, outputPath);
    }

    const folderPrefix = c.storage.folderPrefix || c.slug;
    const finalVideoUrl = await getStorageAdapter(c.storage.provider).upload(
      fs.readFileSync(outputPath),
      { folder: `${folderPrefix}/assembled`, resourceType: 'video' }
    );

    await completeStage(jobId, 'assemble', { final_video_url: finalVideoUrl });

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

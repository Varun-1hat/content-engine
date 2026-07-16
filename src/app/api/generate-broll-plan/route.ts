import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter, extractJson } from '@/lib/adapters/script';
import { getJob, startStage, completeStage, failStage, stageNotInPlan } from '@/lib/jobs';
import { getJobStagePlan } from '@/lib/pipeline/stages';
import { hasProduct, productBlock, fetchProductImages } from '@/lib/pipeline/product';

// POST /api/generate-broll-plan — creative-director timeline ('broll_plan' stage).
// Visual style/timing rules come from the client's creative-director doc (KB);
// this route owns only the JSON output contract.
// Body: { clientId, jobId, script, timestamps?, brollFrequency?, editorNotes? }

const FREQUENCY_GUIDANCE: Record<string, string> = {
  Minimal: 'Use B-roll sparingly — only the 2-3 most impactful moments. Let the base video carry the reel.',
  Standard: 'Use balanced B-roll coverage following the timing rules.',
  High: 'Cover as many qualifying moments with B-roll as the timing rules allow.',
};

export async function POST(req: Request) {
  let jobId: string | undefined;
  try {
    const body = await req.json();
    const { clientId, script, timestamps, brollFrequency, editorNotes } = body;
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
    const offPlan = stageNotInPlan(job, 'broll_plan');
    if (offPlan) return offPlan;
    if (!script) return NextResponse.json({ error: 'Missing script' }, { status: 400 });

    const c = await loadClientConfig(clientId);
    await startStage(jobId, 'broll_plan');

    const plan = getJobStagePlan(job);
    const noAudio = !plan.includes('audio');       // no narration timeline exists
    const noAvatar = !plan.includes('avatar');     // clips are the whole visual track
    const productReel = hasProduct(job);
    const productCount = job.product_image_urls?.length ?? 0;

    // Optional product-photo placement entry, only offered for product reels.
    const productEntryDoc = productReel
      ? `

For moments that should show the ACTUAL uploaded product photo (not a generated clip), emit an entry of this shape instead (product_image_index is 0..${productCount - 1}):
  { "start_second": 0, "end_second": 3, "duration_seconds": 3, "media_type": "product_image", "product_image_index": 0, "scene": "the product itself", "caption_text": "short caption or null" }`
      : '';

    const systemInstruction = `${c.creativeDirectorPrompt}${productBlock(job)}

CRITICAL INSTRUCTION: Your entire response must be a SINGLE valid JSON array. Do not include markdown code blocks, do not include a human-readable shot map, just the pure JSON array.
Use this format exactly:
[
  {
    "start_second": 4,
    "end_second": 9,
    "duration_seconds": 5,
    "media_type": "video",
    "scene": "plain English — what the shot shows",
    "veo_prompt": "full generation prompt following ALL style rules above",
    "negative_prompt": "exclusions following the negative-prompt rules above",
    "caption_text": "short caption or null"
  }
]${productEntryDoc}`;

    const frequencyLine = FREQUENCY_GUIDANCE[brollFrequency as string]
      ? `\n\nB-ROLL FREQUENCY (user choice: ${brollFrequency}): ${FREQUENCY_GUIDANCE[brollFrequency as string]}`
      : '';
    const editorLine = editorNotes
      ? `\n\nEDITOR / CREATIVE DIRECTOR NOTES from the user (apply where possible): "${editorNotes}"`
      : '';

    // Timing context: use the real audio timeline when there is one, else tell
    // the model to tile the whole target duration contiguously.
    let timingBlock: string;
    if (noAudio) {
      const targetN = job.target_duration_sec ?? 45;
      timingBlock = `There is NO narration timeline for this reel (no voiceover). TARGET DURATION: ${targetN} seconds. Emit clips that tile the full 0..${targetN}s contiguously — each clip's start_second must equal the previous clip's end_second, the first starts at 0, and the last ends at ${targetN}.${noAvatar ? ' These clips ARE the entire visual track (there is no presenter to overlay onto) — vary shot types, angles, and subjects so the reel is visually engaging on its own.' : ''}`;
    } else {
      timingBlock = `Here is the exact mathematically calculated audio timeline for the script (in seconds). You MUST use these exact 'start' and 'end' values when assigning B-rolls to specific sentences so they sync perfectly:
${timestamps ? JSON.stringify(timestamps, null, 2) : 'No precise timestamps available.'}`;
    }

    const userPrompt = `Generate the B-Roll cut list and edit_timeline JSON for the following script:

${script}

${timingBlock}${frequencyLine}${editorLine}`;

    const raw = await getScriptAdapter(c.script.provider).generate({
      system: systemInstruction,
      prompt: userPrompt,
      model: c.script.structuredModel,
      fallbackModel: c.script.fallbackModel,
      json: true,
      images: await fetchProductImages(job),
    });

    let brollPlan: any = extractJson(raw);
    if (!Array.isArray(brollPlan)) {
      console.warn("Creative Director returned an object instead of array. Extracting 'broll' if it exists.");
      brollPlan = brollPlan?.broll ?? [brollPlan];
    }

    await completeStage(jobId, 'broll_plan', {
      broll_plan: brollPlan,
      broll_frequency: brollFrequency ?? null,
      editor_notes: editorNotes ?? null,
    });

    return NextResponse.json({ success: true, plan: brollPlan });
  } catch (error: any) {
    console.error('Creative Director Error:', error);
    if (jobId) await failStage(jobId, 'broll_plan', error).catch(() => {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

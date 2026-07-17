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

// Overlay mode (there is an avatar): the presenter carries the reel, so frequency
// means how much B-roll is laid over them, and gaps are fine — the avatar shows
// through them.
const FREQUENCY_GUIDANCE: Record<string, string> = {
  Minimal: 'Use B-roll sparingly — only the 2-3 most impactful moments. Let the base video carry the reel.',
  Standard: 'Use balanced B-roll coverage following the timing rules.',
  High: 'Cover as many qualifying moments with B-roll as the timing rules allow.',
};

// Concat mode (no avatar): the clips ARE the reel, so coverage is never optional
// — the plan must tile the whole duration either way. Frequency instead decides
// how many distinct shots that duration is cut into.
const CONCAT_FREQUENCY_GUIDANCE: Record<string, string> = {
  Minimal: 'Use few, longer shots — roughly 6-8s each — so the reel breathes.',
  Standard: 'Use balanced shot lengths — roughly 4-6s each.',
  High: 'Use many short cuts — roughly 2-3s each — for a fast, punchy edit.',
};

/** End of the last sentence in the TTS alignment = the narration's real length. */
function lastTimestampEnd(timestamps: unknown): number | null {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return null;
  const end = (timestamps[timestamps.length - 1] as { end?: unknown })?.end;
  return typeof end === 'number' && end > 0 ? Number(end.toFixed(2)) : null;
}

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

    // Product reels get two extra tools: a real-photo placement entry, and a
    // per-clip flag that conditions generation on the actual product photos.
    // The flag is per-clip on purpose — reference images FORCE the product into
    // the shot, so a blanket application would jam it into unrelated b-roll.
    const productEntryDoc = productReel
      ? `

=== PRODUCT REEL — SHOWING THE REAL PRODUCT ===
You have seen the ${productCount} product photo(s) attached to this request. You have three ways to put the product on screen; choose per shot:

1. To show the ACTUAL uploaded photo as a still (no generation, always exact), emit (product_image_index is 0..${productCount - 1}):
  { "start_second": 0, "end_second": 3, "duration_seconds": 3, "media_type": "product_image", "product_image_index": 0, "scene": "the product itself", "caption_text": "short caption or null" }

2. To generate a VIDEO shot that features the real product (the generator is conditioned on the photos, so the product keeps its true appearance), use "media_type": "video" and add "features_product": true. Write the veo_prompt to describe the shot AROUND the product (motion, hands, setting, lighting) — do not describe the product's own appearance, it is taken from the photos.

3. For shots that do NOT contain the product (lifestyle, context, reaction), omit "features_product" or set it false.

RULES:
- "features_product": true is ONLY valid on "media_type": "video". A generated still ("media_type": "image") CANNOT be conditioned on the photos and would invent a different product — use option 1 or 2 instead.
- Never set "features_product": true on a shot that does not actually show the product.`
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

    // In concat mode "how much B-roll" is meaningless — the clips are the whole
    // video, so coverage must be total. Frequency sets cut density instead.
    const frequencyTable = noAvatar ? CONCAT_FREQUENCY_GUIDANCE : FREQUENCY_GUIDANCE;
    const frequencyLine = frequencyTable[brollFrequency as string]
      ? `\n\nB-ROLL FREQUENCY (user choice: ${brollFrequency}): ${frequencyTable[brollFrequency as string]}`
      : '';
    const editorLine = editorNotes
      ? `\n\nEDITOR / CREATIVE DIRECTOR NOTES from the user (apply where possible): "${editorNotes}"`
      : '';

    // Timing context. The axis that decides this is whether there is an AVATAR,
    // not whether there is audio: with no avatar the clips are concatenated into
    // the whole video, and concat DROPS the gaps between them — the reel's length
    // is the SUM of the clip durations, not the span they cover. So in concat mode
    // a gap is not empty screen, it is a shorter reel; and when there is also a
    // voiceover, the narration gets cut off at that shorter length.
    let timingBlock: string;
    if (noAvatar) {
      const narrationEnd = lastTimestampEnd(timestamps);
      const targetN = narrationEnd ?? job.target_duration_sec ?? 45;
      timingBlock = `These clips ARE the entire visual track — there is no presenter to overlay onto. TOTAL DURATION: ${targetN} seconds.
Emit clips that tile the full 0..${targetN}s CONTIGUOUSLY: the first clip starts at 0, every clip's start_second equals the previous clip's end_second, and the last clip ends at exactly ${targetN}. Leave NO gaps — a gap is not empty screen, it is content that gets cut from the reel.
Vary shot types, angles and subjects so the reel is visually engaging on its own.`;
      if (!noAudio) {
        timingBlock += `

This reel HAS a voiceover running the full ${targetN}s, and every second of it must have a clip over it. Below is its exact sentence timeline. Keep tiling 0..${targetN}s contiguously — coverage is not optional — but place your cuts ON these sentence boundaries wherever possible, so each shot matches what is being said over it:
${timestamps ? JSON.stringify(timestamps, null, 2) : 'No precise timestamps available.'}`;
      }
    } else {
      // Overlay mode: B-roll is composited onto the avatar at these timestamps,
      // so gaps are fine — the presenter shows through them.
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

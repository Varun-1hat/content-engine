import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter, extractJson } from '@/lib/adapters/script';
import { getVisualAdapter } from '@/lib/adapters/visual';
import { getJobStagePlan } from '@/lib/pipeline/stages';
import { wordBudgetFor } from '@/lib/pipeline/duration';
import { getJob, startStage, completeStage, failStage, stageNotInPlan } from '@/lib/jobs';
import { productBlock, fetchProductImages } from '@/lib/pipeline/product';

// POST /api/generate-english
// Body: { clientId, topic, forceTemplate?, targetDuration?, revisionNotes?, jobId? }
export async function POST(req: Request) {
  let jobId: string | undefined;
  try {
    const body = await req.json();
    const { clientId, topic, forceTemplate, targetDuration, revisionNotes } = body;
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
    const offPlan = stageNotInPlan(job, 'script');
    if (offPlan) return offPlan;
    if (!topic) return NextResponse.json({ error: 'Topic is required' }, { status: 400 });

    const c = await loadClientConfig(clientId);
    await startStage(jobId, 'script');

    const durationNum = targetDuration ? parseInt(targetDuration) : 45;
    // Shared with adapt_voice (pipeline/duration.ts) so the two stages ask for
    // the same length instead of drifting apart with two copies of the formula.
    const targetWordCount = wordBudgetFor(durationNum, c.speechWordsPerSec);

    const prompt = `${c.researchDoc}${productBlock(job)}

=== TASK ===
You are an expert scriptwriter for short-form videos.
Topic: "${topic}"

Your task is to generate a highly engaging, structural reel script in English based on the Research Document.
${forceTemplate
  ? `CRITICAL: You MUST strictly use the "${forceTemplate}" template structure from the Research Doc.`
  : `First, choose the most appropriate template from the templates listed in the Research Doc for this topic.`}

${revisionNotes ? `USER REVISION NOTES (CRITICAL): The user requested the following changes to the script: "${revisionNotes}". You MUST apply these instructions exactly.` : ''}

DURATION TARGET:
The final script should take exactly ${durationNum} seconds to speak. Assuming a pacing of ${c.speechWordsPerSec} words per second, your English script must be approximately ${targetWordCount} words long. DO NOT pad with fluff, but expand or compress the educational depth to hit this word count naturally.

Write the script entirely in English.

OUTPUT FORMAT:
Return ONLY a strictly valid JSON object matching this exact structure (do NOT wrap in markdown):
{
  "chosenTemplate": "Name of the template used",
  "reasoning": "1 sentence explaining why this template and tone fits the topic perfectly.",
  "englishScript": "The raw script text separated by section headers (e.g., THE HOOK, EXPLANATION, etc). A single formatted string with line breaks."
}`;

    // Photo count from the visual adapter, payload ceiling from the script
    // adapter — each cap read off the model that actually has it.
    const script = getScriptAdapter(c.script.provider);
    const raw = await script.generate({
      prompt,
      model: c.script.model,
      fallbackModel: c.script.fallbackModel,
      json: true,
      images: await fetchProductImages(job, {
        maxImages: getVisualAdapter(c.visual.provider).maxReferenceImages,
        maxTotalBytes: script.maxInlineImagePayloadBytes,
      }),
    });
    const parsed = extractJson<{ chosenTemplate: string; reasoning: string; englishScript: string }>(raw);

    // When this reel's plan has no voice-adaptation stage (English clients, or a
    // per-reel no-voiceover choice), the English script IS the final script —
    // persist it so downstream stages and resume work without an adapt_voice pass.
    const skipsVoiceAdapt = !getJobStagePlan(job).includes('adapt_voice');
    await completeStage(jobId, 'script', {
      topic,
      template: parsed.chosenTemplate,
      target_duration_sec: durationNum,
      english_script: parsed.englishScript,
      ...(skipsVoiceAdapt ? { full_script: parsed.englishScript } : {}),
    });

    return NextResponse.json({
      success: true,
      chosenTemplate: parsed.chosenTemplate,
      reasoning: parsed.reasoning,
      englishScript: parsed.englishScript,
    });
  } catch (error: any) {
    console.error('Error generating english script:', error);
    if (jobId) await failStage(jobId, 'script', error).catch(() => {});
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

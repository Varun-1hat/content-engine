import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter, extractJson } from '@/lib/adapters/script';
import { getStagePlan } from '@/lib/pipeline/stages';
import { startStage, completeStage, failStage, jobClientMismatch } from '@/lib/jobs';

// POST /api/generate-english
// Body: { clientId, topic, forceTemplate?, targetDuration?, revisionNotes?, jobId? }
export async function POST(req: Request) {
  let jobId: string | undefined;
  try {
    const body = await req.json();
    const { clientId, topic, forceTemplate, targetDuration, revisionNotes } = body;
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
    if (!topic) return NextResponse.json({ error: 'Topic is required' }, { status: 400 });

    const c = await loadClientConfig(clientId);
    if (jobId) await startStage(jobId, 'script');

    const durationNum = targetDuration ? parseInt(targetDuration) : 45;
    const targetWordCount = Math.round(durationNum * c.speechWordsPerSec);

    const prompt = `${c.researchDoc}

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

    const raw = await getScriptAdapter(c.script.provider).generate({
      prompt,
      model: c.script.model,
      fallbackModel: c.script.fallbackModel,
      json: true,
    });
    const parsed = extractJson<{ chosenTemplate: string; reasoning: string; englishScript: string }>(raw);

    if (jobId) {
      // When the client's plan has no voice-adaptation stage (English-language
      // clients), the English script IS the final script — persist it so the
      // audio stage and resume work without an adapt_voice pass.
      const skipsVoiceAdapt = !getStagePlan(c).includes('adapt_voice');
      await completeStage(jobId, 'script', {
        topic,
        template: parsed.chosenTemplate,
        target_duration_sec: durationNum,
        english_script: parsed.englishScript,
        ...(skipsVoiceAdapt ? { full_script: parsed.englishScript } : {}),
      });
    }

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

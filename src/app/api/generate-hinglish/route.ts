import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter, extractJson } from '@/lib/adapters/script';
import { resolveOrderedDurationSec, wordBudgetFor } from '@/lib/pipeline/duration';
import { getJob, startStage, completeStage, failStage, stageNotInPlan } from '@/lib/jobs';

// POST /api/generate-hinglish — the voice-adaptation stage ('adapt_voice').
// Route name is legacy; the client's voice prompt (KB) defines the target
// language/persona, which need not be Hinglish.
// Body: { clientId, englishScript, topic?, jobId? }
export async function POST(req: Request) {
  let jobId: string | undefined;
  try {
    const body = await req.json();
    const { clientId, englishScript, topic } = body;
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
    const offPlan = stageNotInPlan(job, 'adapt_voice');
    if (offPlan) return offPlan;
    if (!englishScript) return NextResponse.json({ error: 'English Script is required' }, { status: 400 });

    const c = await loadClientConfig(clientId);
    await startStage(jobId, 'adapt_voice');

    // The stage that adapts the script had no idea how long the reel was ordered
    // to be, so a 20s reel could come back at ~65s of speech. State the target
    // and the word budget it implies, at the client's configured pacing.
    //
    // It is a CONSTRAINT on the output, not a second output contract: the voice
    // prompt (KB) already defines the JSON shape and its own length guidance, and
    // two contracts in one prompt is how they start disagreeing.
    //
    // Omitted entirely when nothing recorded a duration (no target on the reel,
    // no pipeline default) — an invented target is worse than none.
    const orderedDurationSec = resolveOrderedDurationSec(job, c.pipelines);
    const durationBlock =
      orderedDurationSec === null
        ? ''
        : `

DURATION CONSTRAINT:
This reel was ordered at ${orderedDurationSec} seconds of speech. At ${c.speechWordsPerSec} spoken words per second that is about ${wordBudgetFor(orderedDurationSec, c.speechWordsPerSec)} words. Keep the adapted script within that budget — tighten and compress rather than adding material, and do not pad to reach it. This is a length constraint on the output defined above; it does not change that output's format.`;

    const prompt = `${c.voicePrompt}

=== TASK ===
Adapt the following English script into ${c.displayName}'s voice and style, following ALL rules above.
Original Topic: "${topic || 'N/A'}"

Base English Script:
${englishScript}${durationBlock}

Output strictly valid JSON only, exactly matching the required output format defined above. Do not wrap in markdown blocks.`;

    const raw = await getScriptAdapter(c.script.provider).generate({
      prompt,
      model: c.script.model,
      fallbackModel: c.script.fallbackModel,
      json: true,
    });
    const script = extractJson<Record<string, unknown> & { fullScript?: string }>(raw);

    const { fullScript, ...meta } = script;
    await completeStage(jobId, 'adapt_voice', {
      full_script: fullScript ?? null,
      script_meta: meta,
    });

    return NextResponse.json({ success: true, script });
  } catch (error: any) {
    console.error('Error generating voice-adapted script:', error);
    if (jobId) await failStage(jobId, 'adapt_voice', error).catch(() => {});
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

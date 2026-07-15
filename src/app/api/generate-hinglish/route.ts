import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter, extractJson } from '@/lib/adapters/script';
import { startStage, completeStage, failStage, jobClientMismatch } from '@/lib/jobs';

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
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;
    if (jobId) {
      const jobForbidden = await jobClientMismatch(jobId, clientId);
      if (jobForbidden) return jobForbidden;
    }
    if (!englishScript) return NextResponse.json({ error: 'English Script is required' }, { status: 400 });

    const c = await loadClientConfig(clientId);
    if (jobId) await startStage(jobId, 'adapt_voice');

    const prompt = `${c.voicePrompt}

=== TASK ===
Adapt the following English script into ${c.displayName}'s voice and style, following ALL rules above.
Original Topic: "${topic || 'N/A'}"

Base English Script:
${englishScript}

Output strictly valid JSON only, exactly matching the required output format defined above. Do not wrap in markdown blocks.`;

    const raw = await getScriptAdapter(c.script.provider).generate({
      prompt,
      model: c.script.model,
      fallbackModel: c.script.fallbackModel,
      json: true,
    });
    const script = extractJson<Record<string, unknown> & { fullScript?: string }>(raw);

    if (jobId) {
      const { fullScript, ...meta } = script;
      await completeStage(jobId, 'adapt_voice', {
        full_script: fullScript ?? null,
        script_meta: meta,
      });
    }

    return NextResponse.json({ success: true, script });
  } catch (error: any) {
    console.error('Error generating voice-adapted script:', error);
    if (jobId) await failStage(jobId, 'adapt_voice', error).catch(() => {});
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

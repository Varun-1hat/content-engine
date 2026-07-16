import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter } from '@/lib/adapters/script';
import { updateJob, logJobEvent, jobClientMismatch } from '@/lib/jobs';

// POST /api/revise-script
// System prompt = the client's voice prompt, so persona and emotion-tag
// vocabulary always match what generation produced (fixes audit finding #4).
// Body: { clientId, script, prompt, jobId? }
export async function POST(req: Request) {
  try {
    const { clientId, script, prompt, jobId } = await req.json();

    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;
    const jobForbidden = await jobClientMismatch(jobId, clientId);
    if (jobForbidden) return jobForbidden;
    if (!script) return NextResponse.json({ error: 'Script is required' }, { status: 400 });

    const c = await loadClientConfig(clientId);

    const userPrompt = `Here is the current working script:
"""
${script}
"""

=== TASK ===
The user has requested the following revision/enhancement:
"${prompt}"

Rewrite the script to apply these changes perfectly.
Keep the persona, language style, and emotion/pause tag vocabulary defined in your instructions intact — preserve existing tags or add them where appropriate.
Do not add any conversational text or markdown blocks; return ONLY the raw text of the revised script.`;

    const raw = await getScriptAdapter(c.script.provider).generate({
      system: c.voicePrompt,
      prompt: userPrompt,
      model: c.script.model,
      fallbackModel: c.script.fallbackModel,
    });

    // The voice-prompt system context instructs JSON output (same doc the
    // adapt_voice stage uses), so the model may return the full script object
    // rather than raw text. Unwrap fullScript when present; else use raw text.
    let revisedScript = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    if (revisedScript.startsWith('{')) {
      try {
        const parsed = JSON.parse(revisedScript);
        if (parsed && typeof parsed.fullScript === 'string') revisedScript = parsed.fullScript;
      } catch {
        /* not valid JSON — keep the cleaned raw text */
      }
    }

    if (jobId) {
      await updateJob(jobId, { full_script: revisedScript });
      await logJobEvent(jobId, 'adapt_voice', 'retried', { reason: 'user revision' });
    }

    return NextResponse.json({ success: true, revisedScript });
  } catch (error: any) {
    console.error('Error revising script:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

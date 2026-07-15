import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter, extractJson } from '@/lib/adapters/script';
import { startStage, completeStage, failStage, jobClientMismatch } from '@/lib/jobs';

// POST /api/generate-broll-plan — creative-director timeline ('broll_plan' stage).
// Visual style/timing rules come from the client's creative-director doc (KB);
// this route owns only the JSON output contract.
// Body: { clientId, script, timestamps?, brollFrequency?, editorNotes?, jobId? }

const FREQUENCY_GUIDANCE: Record<string, string> = {
  Minimal: 'Use B-roll sparingly — only the 2-3 most impactful moments. Let the avatar carry the video.',
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
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;
    if (jobId) {
      const jobForbidden = await jobClientMismatch(jobId, clientId);
      if (jobForbidden) return jobForbidden;
    }
    if (!script) return NextResponse.json({ error: 'Missing script' }, { status: 400 });

    const c = await loadClientConfig(clientId);
    if (jobId) await startStage(jobId, 'broll_plan');

    // Generic output contract — style rules (incl. negative-prompt content)
    // live in the KB doc above this block.
    const systemInstruction = `${c.creativeDirectorPrompt}

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
]`;

    const frequencyLine = FREQUENCY_GUIDANCE[brollFrequency as string]
      ? `\n\nB-ROLL FREQUENCY (user choice: ${brollFrequency}): ${FREQUENCY_GUIDANCE[brollFrequency as string]}`
      : '';
    const editorLine = editorNotes
      ? `\n\nEDITOR / CREATIVE DIRECTOR NOTES from the user (apply where possible): "${editorNotes}"`
      : '';

    const userPrompt = `Generate the B-Roll cut list and edit_timeline JSON for the following script:

${script}

Here is the exact mathematically calculated audio timeline for the script (in seconds).
You MUST use these exact 'start' and 'end' values when assigning B-rolls to specific sentences so they sync perfectly:
${timestamps ? JSON.stringify(timestamps, null, 2) : 'No precise timestamps available.'}${frequencyLine}${editorLine}`;

    const raw = await getScriptAdapter(c.script.provider).generate({
      system: systemInstruction,
      prompt: userPrompt,
      model: c.script.structuredModel,
      fallbackModel: c.script.fallbackModel,
      json: true,
    });

    let plan: any = extractJson(raw);
    if (!Array.isArray(plan)) {
      console.warn("Creative Director returned an object instead of array. Extracting 'broll' if it exists.");
      plan = plan?.broll ?? [plan];
    }

    if (jobId) {
      await completeStage(jobId, 'broll_plan', {
        broll_plan: plan,
        broll_frequency: brollFrequency ?? null,
        editor_notes: editorNotes ?? null,
      });
    }

    return NextResponse.json({ success: true, plan });
  } catch (error: any) {
    console.error('Creative Director Error:', error);
    if (jobId) await failStage(jobId, 'broll_plan', error).catch(() => {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

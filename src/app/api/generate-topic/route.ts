import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter, extractJson } from '@/lib/adapters/script';
import { getVisualAdapter } from '@/lib/adapters/visual';
import { getJob, stageNotInPlan } from '@/lib/jobs';
import { productBlock, productPrecedenceBlock, fetchProductImages } from '@/lib/pipeline/product';

// POST /api/generate-topic
// Body: { clientId, jobId, query? }
// Content, persona, and topic-selection rules come from the client's research
// doc (KB). This route owns only the task framing and the output contract.
// Seasonality/region context lives in the research doc (no locale_region column).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clientId, jobId, query } = body;

    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;

    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (job.client_id !== clientId) return NextResponse.json({ error: 'Job does not belong to this client' }, { status: 403 });
    const offPlan = stageNotInPlan(job, 'topic');
    if (offPlan) return offPlan;

    const c = await loadClientConfig(clientId);
    const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

    const pastContentBlock = c.pastContent.trim()
      ? `\n\n=== PREVIOUSLY PUBLISHED (avoid repeating these topics/angles) ===\n${c.pastContent}`
      : '';

    // The precedence clause is read off the JOB ROW, never from the request
    // body: it is a per-reel choice captured when the reel was created, so a
    // retry or a resume uses the choice the reel was ordered under. It sits
    // after productBlock so it qualifies the product context it refers to, and
    // the research doc above it stays in full — this changes which topic wins a
    // disagreement, it does not remove anything from the prompt.
    const prompt = `${c.researchDoc}${pastContentBlock}${productBlock(job)}${productPrecedenceBlock(job)}

=== TASK ===
Based on the research document above and the current date/season (${currentMonth}), generate 3 highly viral reel topics for ${c.displayName}.
${(query as string)?.trim()
  ? `The user is interested in the broad topic: "${query}". Generate 3 specific, highly viral angles/hooks specifically related to this topic.`
  : `Pick topics that are most relevant to the current season/date context in the research document or universally highly viral (e.g., safety warnings).`}

CRITICAL STEP: For EACH topic, follow the topic-selection rules in the research document exactly (topic analysis, template decision tree, mixed-template check, hook & close extraction).

Requirements:
1. Provide exactly 3 short, punchy topic ideas (maximum 1 sentence each).
2. Provide reasoning mapping "perfectForYou" (array of 2-3 points) and "audienceWantsThis" (1-2 sentences).
3. Output the exact template names decided by the decision tree (primary, and secondary or null).
4. Output the hookType and closeType per the research document's rules for the primary template.
5. Provide a "templateReasoning" string (1-2 sentences) justifying why this template combination fits the topic.
6. Suggest a target duration in seconds (e.g. "30", "45", "60").
7. Return ONLY a valid JSON array of objects. Do NOT wrap in markdown blocks.

Output Format:
[
  {
    "topic": "One-sentence topic",
    "reasoning": {
      "perfectForYou": ["..."],
      "audienceWantsThis": "..."
    },
    "primaryTemplate": "Exact template name",
    "secondaryTemplate": null,
    "templateReasoning": "Why this template fits.",
    "hookType": "Type B",
    "closeType": "ALWAYS Share CTA",
    "suggestedDuration": "60"
  }
]`;

    // Both caps come from the adapters that actually have them: the visual
    // provider decides how many photos are usable, the script model decides how
    // many raw bytes it will take in one request.
    const script = getScriptAdapter(c.script.provider);
    const raw = await script.generate({
      prompt,
      model: c.script.structuredModel,
      fallbackModel: c.script.fallbackModel,
      json: true,
      images: await fetchProductImages(job, {
        maxImages: getVisualAdapter(c.visual.provider).maxReferenceImages,
        maxTotalBytes: script.maxInlineImagePayloadBytes,
      }),
    });

    const topics = extractJson<unknown[]>(raw);
    if (!Array.isArray(topics) || topics.length === 0) {
      throw new Error('Invalid response format from AI');
    }

    return NextResponse.json({ success: true, topics });
  } catch (error: any) {
    console.error('Error generating topics:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

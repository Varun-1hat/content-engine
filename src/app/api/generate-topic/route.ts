import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getScriptAdapter, extractJson } from '@/lib/adapters/script';

// GET /api/generate-topic?client=<id>&query=<optional focus>
// Content, persona, and topic-selection rules come from the client's research
// doc (KB). This route owns only the task framing and the output contract.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client');
    if (!clientId) {
      return NextResponse.json({ error: '?client= is required' }, { status: 400 });
    }
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;

    const query = url.searchParams.get('query') || '';

    const c = await loadClientConfig(clientId);
    const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    const regionName =
      new Intl.DisplayNames(['en'], { type: 'region' }).of(c.locale.region) ?? c.locale.region;

    const pastContentBlock = c.pastContent.trim()
      ? `\n\n=== PREVIOUSLY PUBLISHED (avoid repeating these topics/angles) ===\n${c.pastContent}`
      : '';

    const prompt = `${c.researchDoc}${pastContentBlock}

=== TASK ===
Based on the research document above and the current date/season in ${regionName} (${currentMonth}), generate 3 highly viral reel topics for ${c.displayName}.
${query
  ? `The user is interested in the broad topic: "${query}". Generate 3 specific, highly viral angles/hooks specifically related to this topic.`
  : `Pick topics that are most relevant to the current season in ${regionName} or universally highly viral (e.g., safety warnings).`}

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

    const raw = await getScriptAdapter(c.script.provider).generate({
      prompt,
      model: c.script.structuredModel,
      fallbackModel: c.script.fallbackModel,
      json: true,
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

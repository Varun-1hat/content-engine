import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RESEARCH_DOC } from '@/lib/researchDoc';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
  try {
    const { topic, forceTemplate, targetDuration, revisionNotes } = await req.json();

    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const durationNum = targetDuration ? parseInt(targetDuration) : 45;
    const targetWordCount = Math.round(durationNum * 2.5); // roughly 2.5 words per sec

    const geminiPrompt = `${RESEARCH_DOC}
    
=== TASK ===
You are an expert scriptwriter for medical professional short-form videos.
Topic: "${topic}"

Your task is to generate a highly engaging, structural reel script in English based on the Research Document.
${forceTemplate 
  ? `CRITICAL: You MUST strictly use the "${forceTemplate}" template structure from the Research Doc.` 
  : `First, choose the most appropriate template from the 7 templates listed in the Research Doc for this topic.`
}

${revisionNotes ? `USER REVISION NOTES (CRITICAL): The user requested the following changes to the script: "${revisionNotes}". You MUST apply these instructions exactly.` : ``}

DURATION TARGET:
The final script should take exactly ${durationNum} seconds to speak. Assuming a fast pacing of 2.5 words per second, your English script must be approximately ${targetWordCount} words long. DO NOT pad with fluff, but expand or compress the educational depth to hit this word count naturally.

Write the script entirely in English. 

OUTPUT FORMAT:
Return ONLY a strictly valid JSON object matching this exact structure (do NOT wrap in markdown \`\`\`json):
{
  "chosenTemplate": "Name of the template used",
  "reasoning": "1 sentence explaining why this template and tone fits the topic perfectly.",
  "englishScript": "The raw script text separated by the section headers (e.g., THE HOOK, EXPLANATION, etc). Do not use JSON for the script itself, just a single formatted string with line breaks."
}
`;

    let response;
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent(geminiPrompt);
      response = await result.response;
    } catch (err: any) {
      if (err.message?.includes('503')) {
        console.warn('gemini-2.5-flash returned 503, falling back to gemini-1.5-pro...');
        const fallbackModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        const result = await fallbackModel.generateContent(geminiPrompt);
        response = await result.response;
      } else {
        throw err;
      }
    }
    
    let text = response.text().trim();
    
    // Clean up potential markdown formatting and conversational text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      text = match[0];
    } else {
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    
    const parsed = JSON.parse(text);

    return NextResponse.json({ 
      success: true, 
      chosenTemplate: parsed.chosenTemplate,
      reasoning: parsed.reasoning,
      englishScript: parsed.englishScript
    });
  } catch (error: any) {
    console.error('Error generating english script:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

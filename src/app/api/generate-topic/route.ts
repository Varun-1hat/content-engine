import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RESEARCH_DOC } from '@/lib/researchDoc';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('query') || '';
    const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    
    const prompt = `${RESEARCH_DOC}

=== TASK ===
Based on the research document above and the current date/season in India (${currentMonth}), generate 3 highly viral reel topics for Dr. Kiran.
${query ? `The user is interested in the broad topic: "${query}". Generate 3 specific, highly viral angles/hooks specifically related to this topic.` : `Pick topics from Tier 1 or Tier 2 that are most relevant to the current season (e.g., summer heat, monsoon prep, seasonal illnesses) or universally highly viral (e.g., safety warnings).`}

CRITICAL STEP: For EACH topic, you MUST run this 4-step analysis to determine the exact template mapping.

STEP 1 — Topic Analysis
Before recommending a template, analyze the topic on these 4 dimensions:
1. DANGER LEVEL: High (risk to baby's life/health) or Low (everyday/reassurance).
2. TOPIC TYPE: Myth, Story, Signs, Action, Tip, or Question.
3. EMOTIONAL TONE: Urgent, Curious, Reassuring, or Inspiring.
4. CTA TYPE: Share, Save, or None.

STEP 2 — Template Decision Tree
Use this exact logic to recommend the Primary template:
- IF danger level HIGH AND topic type ACTION/SIGNS -> Warning / Red Flag
- IF common wrong belief AND topic type MYTH -> Myth vs Fact
- IF 3 wrong parent actions AND topic type ACTION -> The 3 Mistakes
- IF real patient case AND danger HIGH AND topic type STORY -> Patient Transformation
- IF simple one-step fix AND danger LOW AND topic type TIP -> Quick Hack / DIY
- IF direct parent question AND starts with Doctor/Kya/Kab/Kitna/Kyun -> Q&A Session
- IF doctor's experience/insight AND danger LOW -> Behind the Scenes

STEP 3 — Mixed Template Check
Check if a secondary template improves it:
- IF primary Warning AND busts a myth -> Add Myth vs Fact
- IF primary Q&A AND involves danger signs -> Add Warning
- IF primary Patient Transformation AND has warning signs -> Add Warning
- IF primary Myth vs Fact AND has a quick fix -> Add Quick Hack
- IF primary The 3 Mistakes AND each has a quick fix -> Add Quick Hack
OTHERWISE -> Single template only (secondary is null).

STEP 4 — Extract Hook & Close
Read the rules for the Primary Template in the RESEARCH DOC to determine the exact Hook Type (A, B, or C) and Close Rule (e.g., "ALWAYS Share CTA").

Requirements:
1. Provide exactly 3 short, punchy topic ideas (maximum 1 sentence each).
2. Provide reasoning mapping "perfectForYou" (array of 2-3 points) and "audienceWantsThis" (1-2 sentences).
3. Output the exact template names you decided on in Step 2 & 3.
4. Output the hookType and closeType from Step 4.
5. Provide a "templateReasoning" string (1-2 sentences) justifying why this specific template combination fits the topic.
6. Suggest a target duration in seconds (e.g. "30", "45", "60").
7. Return ONLY a valid JSON array of objects. Do NOT wrap in markdown blocks.

Output Format:
[
  {
    "topic": "Baby walker dangers: why it delays walking",
    "reasoning": {
      "perfectForYou": ["..."],
      "audienceWantsThis": "..."
    },
    "primaryTemplate": "Warning / Red Flag",
    "secondaryTemplate": null,
    "templateReasoning": "This topic involves parent action with HIGH danger, so it triggers the Warning primary template.",
    "hookType": "Type B",
    "closeType": "ALWAYS Share CTA",
    "suggestedDuration": "60"
  }
]`;

    let response;
    let retries = 3;
    
    while (retries > 0) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.5-flash",
          generationConfig: { responseMimeType: "application/json" }
        });
        const result = await model.generateContent(prompt);
        response = await result.response;
        break; // Success, exit loop
      } catch (err: any) {
        retries--;
        console.warn(`Gemini generation failed. Retries left: ${retries}. Error:`, err.message);
        
        if (retries === 0) {
          throw new Error(`Failed after 3 retries. Last error: ${err.message}`);
        } else {
          // Wait 1 second before retrying
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    if (!response) {
      throw new Error('Failed to generate response from Gemini after all retries.');
    }
    
    let text = response.text();
    
    // Clean up potential markdown formatting and conversational text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      text = match[0];
    } else {
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    
    const topics = JSON.parse(text);

    if (!Array.isArray(topics) || topics.length === 0) {
      throw new Error('Invalid response format from AI');
    }

    return NextResponse.json({ success: true, topics });
  } catch (error: any) {
    console.error('Error generating topics:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

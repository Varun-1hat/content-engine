import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MASTER_PROMPT } from '@/lib/masterPrompt';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
  try {
    const { englishScript, topic } = await req.json();

    if (!englishScript) {
      return NextResponse.json({ error: 'English Script is required' }, { status: 400 });
    }

    const geminiPrompt = `${MASTER_PROMPT}
    
=== TASK ===
Adapt the following English script into Dr. Kiran's Hinglish style.
Original Topic: "${topic}"

Base English Script:
${englishScript}

Output strictly valid JSON only exactly matching the required output format (a single 'fullScript' string). Do not wrap in markdown \`\`\`json blocks.`;

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
    
    let text = response.text();
    
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      text = match[0];
    } else {
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    
    const finalScript = JSON.parse(text);

    return NextResponse.json({ success: true, script: finalScript });
  } catch (error: any) {
    console.error('Error generating hinglish script:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

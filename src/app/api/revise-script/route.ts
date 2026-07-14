import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
  try {
    const { script, prompt } = await req.json();

    if (!script) {
      return NextResponse.json({ error: 'Script is required' }, { status: 400 });
    }

    const geminiPrompt = `
You are an expert medical scriptwriter for Dr. Kiran.
Here is the current working script:
"""
${script}
"""

=== TASK ===
The user has requested the following revision/enhancement:
"${prompt}"

Rewrite the script to apply these changes perfectly. 
Keep all emotion markers like [urgent], [pause], [slow], [warm], [emphasis] intact or add them where appropriate based on the changes.
Keep the Hinglish style intact. Do not add any conversational text or markdown blocks, just return the raw text of the revised script.
`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(geminiPrompt);
    let revisedScript = result.response.text().trim();
    
    // Cleanup markdown
    revisedScript = revisedScript.replace(/```/g, '').trim();

    return NextResponse.json({ success: true, revisedScript });
  } catch (error: any) {
    console.error('Error revising script:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
  try {
    const { script, audioUrl, avatarVideoUrl, timestamps } = await req.json();

    if (!script) {
      return NextResponse.json({ error: 'Missing script' }, { status: 400 });
    }

    // Read the Creative Director prompt
    const promptPath = path.join(process.cwd(), 'public', 'dr_kiran_creative_director_promptv2.md');
    let systemInstruction = '';
    try {
      systemInstruction = fs.readFileSync(promptPath, 'utf-8');
    } catch (e) {
      console.warn("Could not find dr_kiran_creative_director_promptv2.md in public folder. Using default prompt.");
      systemInstruction = "You are the Creative Director. Output the edit_timeline JSON.";
    }

    // Add explicit JSON instructions to ensure parsability
    systemInstruction += `

CRITICAL INSTRUCTION: Your entire response must be a SINGLE valid JSON array. Do not include markdown code blocks, do not include the human-readable shot map, just pure JSON array.
Use this format exactly:
[
  {
    "start_second": 4,
    "end_second": 9,
    "duration_seconds": 5,
    "media_type": "video",
    "scene": "plain English — what the shot shows",
    "veo_prompt": "full Indian B-roll prompt goes here",
    "negative_prompt": "cartoon, CGI, 3D render, illustration, Western-looking baby, pale skin, blonde hair, blue eyes, studio lighting, ring light, bright white walls, IKEA-style furniture, stock photo aesthetic, watermark, text in frame, logo, distorted hands, extra fingers, hospital white room, smiling when context is serious",
    "caption_text": "short Hinglish caption or null"
  }
]`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const userPrompt = `Generate the B-Roll cut list and edit_timeline JSON for the following script:\n\n${script}
    
Here is the exact mathematically calculated audio timeline for the script (in seconds).
You MUST use these exact 'start' and 'end' values when assigning B-rolls to specific sentences so they sync perfectly:
${timestamps ? JSON.stringify(timestamps, null, 2) : "No precise timestamps available."}`;
    
    const result = await model.generateContent(userPrompt);
    const responseText = result.response.text();
    
    let planJson;
    try {
      planJson = JSON.parse(responseText);
      if (!Array.isArray(planJson)) {
        console.warn("Creative Director returned an object instead of array. Extracting 'broll' if exists.");
        if (planJson.broll) planJson = planJson.broll;
        else planJson = [planJson];
      }
    } catch (e) {
      console.error("Failed to parse JSON from Creative Director:", responseText);
      throw new Error("Creative Director did not return valid JSON");
    }

    // Since the new guide expects `plan` to be the array itself, return it!
    return NextResponse.json({ success: true, plan: planJson });

  } catch (error: any) {
    console.error('Creative Director Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

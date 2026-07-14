import { GoogleGenerativeAI } from '@google/generative-ai';
import { RESEARCH_DOC } from './src/lib/researchDoc.js'; // Need .js if running direct or use ts-node
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const currentMonth = "June 2026";
const prompt = `${RESEARCH_DOC}

=== TASK ===
Based on the research document above and the current date/season in India (${currentMonth}), generate 3 highly viral reel topics for Dr. Kiran.
Pick topics from Tier 1 or Tier 2 that are most relevant to the current season (e.g., summer heat, monsoon prep, seasonal illnesses) or universally highly viral (e.g., safety warnings).

Requirements:
1. Provide exactly 3 short, punchy topic ideas (maximum 1 sentence each).
2. The topics should be in English (with maybe a hinge of Hinglish context if necessary).
3. Return ONLY a valid JSON array of strings. Do NOT wrap in markdown blocks like \`\`\`json.
Example output:
["Baby walker dangers: why it delays walking", "Vitamin D deficiency in summer babies", "Gripe water myth busted"]`;

async function run() {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  let text = response.text();
  console.log("RAW TEXT:", text);
  text = text.replace(/```json/g, '').replace(/```/g, '').trim();
  console.log("CLEANED TEXT:", text);
  const topics = JSON.parse(text);
  console.log("PARSED:", topics);
}

run();

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Next.js Turbopack sometimes resolves static paths incorrectly to '\ROOT\'
let resolvedFfmpegPath = ffmpegStatic as string;
if (resolvedFfmpegPath && resolvedFfmpegPath.includes('ROOT')) {
  resolvedFfmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
}

if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

export async function POST(req: Request) {
  try {
    let { text, globalSpeed } = await req.json();
    globalSpeed = parseFloat(globalSpeed) || 1.0;

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    if (!apiKey || !voiceId) throw new Error('ElevenLabs keys missing.');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elevenlabs-native-'));

    // --- PRE-PROCESS TEXT ---
    // 1. Remove ALL UI section headers (e.g., THE HOOK:, EXPLANATION:, PROBLEM SETUP:)
    text = text.replace(/^[A-Z0-9\s]+:/gm, '').trim();

    // 2. Strip all manual emotion/pause brackets. 
    // ElevenLabs reads natural context perfectly in a single request.
    text = text.replace(/\[.*?\]/g, '');

    // 3. Remove excessive whitespace that might confuse the parser
    text = text.replace(/\s+/g, ' ').trim();

    // --- ELEVENLABS NATIVE WITH-TIMESTAMPS API CALL ---
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_v3',
        voice_settings: {
          stability: 0.5
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${await response.text()}`);
    }

    const data = await response.json();
    const audioBase64 = data.audio_base64;
    const alignment = data.alignment; // { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }

    // --- PARSE ALIGNMENT INTO SENTENCES ---
    const timestamps: any[] = [];
    let currentText = "";
    let currentStart = -1;

    for (let i = 0; i < alignment.characters.length; i++) {
      const char = alignment.characters[i];
      const startSec = alignment.character_start_times_seconds[i];
      const endSec = alignment.character_end_times_seconds[i];

      if (currentStart === -1 && char.trim() !== "") {
        currentStart = startSec;
      }

      currentText += char;

      // Check for end of sentence
      const isPunctuation = ['.', '!', '?', '\n'].includes(char);
      const isEnd = i === alignment.characters.length - 1;
      const nextIsSpaceOrEnd = isEnd || [' ', '\n'].includes(alignment.characters[i + 1]);

      if ((isPunctuation && nextIsSpaceOrEnd) || isEnd) {
        if (currentText.trim() !== "") {
          // Adjust timestamps mathematically based on our FFmpeg globalSpeed
          timestamps.push({
            text: currentText.trim(),
            start: parseFloat((currentStart / globalSpeed).toFixed(2)),
            end: parseFloat((endSec / globalSpeed).toFixed(2)),
            marker: 'default' // Keeping default for backwards compatibility
          });
        }
        currentText = "";
        currentStart = -1;
      }
    }

    // --- SAVE AND PROCESS AUDIO VIA FFMPEG ---
    const rawMp3Path = path.join(tempDir, `raw.mp3`);
    const finalMp3Path = path.join(tempDir, `final.mp3`);

    // Decode base64 to raw MP3 file
    fs.writeFileSync(rawMp3Path, Buffer.from(audioBase64, 'base64'));

    // Final Encode with LUFS normalization and speed
    await new Promise((resolve, reject) => {
      ffmpeg(rawMp3Path)
        .audioFilter([
          `atempo=${globalSpeed.toFixed(4)}`, // mathematically synced with the timestamps above!
          'loudnorm=I=-16:TP=-1.5:LRA=11'
        ])
        .audioBitrate('128k')
        .on('end', resolve)
        .on('error', reject)
        .save(finalMp3Path);
    });

    const finalBuffer = fs.readFileSync(finalMp3Path);

    // Upload to Cloudinary
    const audioUrl = await new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: "video", folder: "dr_kiran_audio" },
        (error, result) => {
          if (error) return reject(error);
          if (result) return resolve(result.secure_url);
          reject(new Error("Unknown Cloudinary error"));
        }
      );
      uploadStream.end(finalBuffer);
    });

    // Cleanup temp dir
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }

    return NextResponse.json({ success: true, audioUrl: audioUrl, timestamps: timestamps });
  } catch (error: any) {
    console.error('Audio Generation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

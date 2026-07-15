import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getVoiceAdapter } from '@/lib/adapters/voice';
import { getStorageAdapter } from '@/lib/adapters/storage';
import { prepareScriptForTts, alignmentToSentenceTimestamps, normalizeAudio } from '@/lib/pipeline/audio';
import { startStage, completeStage, failStage, jobClientMismatch } from '@/lib/jobs';

// POST /api/generate-audio — TTS + normalize + upload ('audio' stage).
// Body: { clientId, text, globalSpeed?, jobId? }
export async function POST(req: Request) {
  let jobId: string | undefined;
  let tempDir = '';
  try {
    const body = await req.json();
    const { clientId, text } = body;
    jobId = body.jobId;
    const globalSpeed = parseFloat(body.globalSpeed) || 1.0;

    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;
    if (jobId) {
      const jobForbidden = await jobClientMismatch(jobId, clientId);
      if (jobForbidden) return jobForbidden;
    }
    if (!text) return NextResponse.json({ error: 'Text is required' }, { status: 400 });

    const c = await loadClientConfig(clientId);
    if (jobId) await startStage(jobId, 'audio');

    const prepared = prepareScriptForTts(text);

    const { audioBase64, alignment } = await getVoiceAdapter(c.voice.provider).synthesize(prepared, {
      voiceId: c.voice.voiceId,
      modelId: c.voice.modelId,
      stability: c.voice.stability,
    });

    const timestamps = alignmentToSentenceTimestamps(alignment, globalSpeed);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-audio-'));
    const rawMp3Path = path.join(tempDir, 'raw.mp3');
    const finalMp3Path = path.join(tempDir, 'final.mp3');
    fs.writeFileSync(rawMp3Path, Buffer.from(audioBase64, 'base64'));
    await normalizeAudio(rawMp3Path, finalMp3Path, globalSpeed);

    const folderPrefix = c.storage.folderPrefix || c.id;
    const audioUrl = await getStorageAdapter(c.storage.provider).upload(
      fs.readFileSync(finalMp3Path),
      { folder: `${folderPrefix}/audio`, resourceType: 'video' }
    );

    if (jobId) {
      await completeStage(jobId, 'audio', {
        audio_url: audioUrl,
        audio_timestamps: timestamps,
        speech_speed: globalSpeed,
      });
    }

    return NextResponse.json({ success: true, audioUrl, timestamps });
  } catch (error: any) {
    console.error('Audio Generation Error:', error);
    if (jobId) await failStage(jobId, 'audio', error).catch(() => {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

import type { VoiceAdapter } from './base';

export const elevenLabsVoiceAdapter: VoiceAdapter = {
  async synthesize(text, opts) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
    if (!opts.voiceId) throw new Error('voiceId is required (clients.voice_id is empty)');

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}/with-timestamps`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: opts.modelId,
          voice_settings: { stability: opts.stability },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${await response.text()}`);
    }

    const data = await response.json();
    return { audioBase64: data.audio_base64, alignment: data.alignment };
  },
};

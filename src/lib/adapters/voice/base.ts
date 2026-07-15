// =============================================================================
// VOICE (TTS) ADAPTER — base contract
//
// To add a new provider (e.g. cartesia, playht):
//   1. Create ./<provider>.ts exporting a `const <provider>VoiceAdapter: VoiceAdapter`.
//   2. Register it in ./index.ts under its slug.
//   3. Point a client at it: clients.voice_provider = '<slug>', with the
//      client's voice settings in clients.voice_id / voice_model_id / voice_stability.
//
// Rules every implementation must follow:
//   - API keys from process.env ONLY; throw early with the env-var name.
//   - Must return character-level alignment (the timestamp pipeline depends
//     on it). If a vendor can't provide it, that vendor can't back this stage.
//   - Return base64 audio; upload/normalization happens downstream in
//     pipeline/audio.ts + the storage adapter, NOT here.
// =============================================================================

export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface SynthesizeOptions {
  voiceId: string;
  modelId: string;
  stability: number;
}

export interface SynthesizeResult {
  audioBase64: string;
  alignment: CharacterAlignment;
}

export interface VoiceAdapter {
  synthesize(text: string, opts: SynthesizeOptions): Promise<SynthesizeResult>;
}

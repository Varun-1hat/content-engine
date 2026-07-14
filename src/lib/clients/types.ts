export type ContentType = 'talking_head' | 'product_visual';
export type ScriptMode = 'generate' | 'polish';
export type Tier = 'script_only' | 'audio_only' | 'avatar_only' | 'full_production' | 'scenario_premium';

export interface ClientAvatar {
  id: string;
  label: string;
  avatar_id: string;
  preview_image_url: string | null;
  sort_order: number;
}

export interface ClientTemplate {
  id: string;
  label: string;
  description: string | null;
  preview_video_url: string | null;
  sort_order: number;
}

export interface ClientConfig {
  id: string;
  displayName: string;
  contentType: ContentType;
  scriptMode: ScriptMode;
  tier: Tier;
  active: boolean;
  locale: { language: string; region: string };
  speechWordsPerSec: number;
  knowledgeBase: {
    researchDocPath?: string;
    voicePromptPath?: string;
    creativeDirectorPromptPath?: string;
    pastContentPath?: string;
  };
  script: { provider: string; model: string; structuredModel: string; fallbackModel: string };
  voice: { provider: string; voiceId: string; modelId: string; stability: number };
  avatarProvider: string;
  avatars: ClientAvatar[];
  templates: ClientTemplate[];
  visual: { provider: string; stylePreset: string | null };
  storage: { provider: string; folderPrefix: string };
  extra: Record<string, unknown>;
}

// ClientConfig + the actual KB prose downloaded from Storage, ready to drop into prompts.
export interface ResolvedClient extends ClientConfig {
  researchDoc: string;
  voicePrompt: string;
  creativeDirectorPrompt: string;
  pastContent: string; // '' when the client has no past-content doc
}

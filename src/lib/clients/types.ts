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

// A per-client pipeline: a named subset of the canonical stage sequence plus
// its settings. Clients subscribe to one or more (the "variants").
export interface ClientPipeline {
  id: string;
  name: string;
  enabled_stages: string[];      // validated against the code stage registry
  product_input: boolean;        // reels on this pipeline take per-reel product photos
  duration_min_sec: number;
  duration_max_sec: number;
  duration_default_sec: number;
  sort_order: number;
  active: boolean;
}

export interface ClientConfig {
  id: string;                    // uuid PK
  slug: string;                  // human-readable; drives storage/KB folder names
  displayName: string;
  active: boolean;
  locale: { language: string };
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
  pipelines: ClientPipeline[];
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

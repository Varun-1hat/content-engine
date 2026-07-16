import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listScriptProviders } from '@/lib/adapters/script';
import { listVoiceProviders } from '@/lib/adapters/voice';
import { listAvatarProviders } from '@/lib/adapters/avatar';
import { listVisualProviders } from '@/lib/adapters/visual';
import { listStorageProviders } from '@/lib/adapters/storage';
import { CANONICAL_STAGES, STAGE_INFO, PIPELINE_PRESETS } from '@/lib/pipeline/stages';

// GET /api/admin/providers — the registered adapter slugs per kind + the stage
// registry + pipeline presets, straight from the code. Admin UI dropdowns can
// never drift from the code.
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    script: listScriptProviders(),
    voice: listVoiceProviders(),
    avatar: listAvatarProviders(),
    visual: listVisualProviders(),
    storage: listStorageProviders(),
    stages: CANONICAL_STAGES.map((name) => ({ name, label: STAGE_INFO[name].label })),
    presets: PIPELINE_PRESETS,
  });
}

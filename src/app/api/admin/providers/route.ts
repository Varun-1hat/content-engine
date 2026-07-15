import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listScriptProviders } from '@/lib/adapters/script';
import { listVoiceProviders } from '@/lib/adapters/voice';
import { listAvatarProviders } from '@/lib/adapters/avatar';
import { listVisualProviders } from '@/lib/adapters/visual';
import { listStorageProviders } from '@/lib/adapters/storage';

// GET /api/admin/providers — the registered adapter slugs per kind, straight
// from the code registries. Admin UI dropdowns can never drift from the code.
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    script: listScriptProviders(),
    voice: listVoiceProviders(),
    avatar: listAvatarProviders(),
    visual: listVisualProviders(),
    storage: listStorageProviders(),
    contentTypes: ['talking_head', 'product_visual'],
    scriptModes: ['generate', 'polish'],
    tiers: ['script_only', 'audio_only', 'avatar_only', 'full_production', 'scenario_premium'],
  });
}

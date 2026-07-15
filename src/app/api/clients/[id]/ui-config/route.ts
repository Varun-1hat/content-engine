import { NextResponse } from 'next/server';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { getStagePlan, STAGE_INFO } from '@/lib/pipeline/stages';
import { requireUser, forbidClientMismatch } from '@/lib/auth';

// GET /api/clients/[id]/ui-config — the safe UI subset of a client's config.
// Vendor IDs (avatar_id, voice_id, model names) never ship to the browser.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const forbidden = forbidClientMismatch(auth, id);
    if (forbidden) return forbidden;
    const c = await loadClientConfig(id);
    const stagePlan = getStagePlan(c);

    return NextResponse.json({
      id: c.id,
      displayName: c.displayName,
      tier: c.tier,
      contentType: c.contentType,
      localeLanguage: c.locale.language,
      stagePlan: stagePlan.map((name) => ({ name, label: STAGE_INFO[name].label })),
      templates: c.templates.map((t) => ({
        label: t.label,
        description: t.description,
        previewVideoUrl: t.preview_video_url,
      })),
      avatars: c.avatars.map((a) => ({
        label: a.label,
        previewImageUrl: a.preview_image_url,
      })),
      duration: { minSec: 15, maxSec: 90, defaultSec: 45 },
    });
  } catch (error: any) {
    const notFound = /Unknown or inactive client/.test(error?.message ?? '');
    console.error('Error loading ui-config:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: notFound ? 404 : 500 }
    );
  }
}

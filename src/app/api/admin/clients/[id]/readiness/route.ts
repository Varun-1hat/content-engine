import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { KB_BUCKET } from '@/lib/admin';
import { normalizeStages, validate } from '@/lib/pipeline/stages';

// GET /api/admin/clients/[id]/readiness — server-authoritative activation
// checklist. Works on INACTIVE clients (onboarding), so it queries directly
// rather than via loadClientConfig (which only resolves active clients).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const supabase = supabaseAdmin();
    const [clientRes, pipeRes, avatarRes, templateRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).maybeSingle(),
      supabase.from('client_pipelines').select('*').eq('client_id', id).eq('active', true).order('sort_order'),
      supabase.from('client_avatars').select('*').eq('client_id', id),
      supabase.from('client_templates').select('*').eq('client_id', id),
    ]);
    if (clientRes.error) throw new Error(clientRes.error.message);
    const client = clientRes.data as any;
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const pipelines = pipeRes.data ?? [];
    const avatars = avatarRes.data ?? [];
    const templates = templateRes.data ?? [];

    const errors: string[] = [];
    const warnings: string[] = [];

    if (pipelines.length === 0) {
      warnings.push('No active pipelines — this client has no reel variants to run.');
    }

    // Union of stages across all active pipelines.
    const allStages = new Set<string>();
    for (const p of pipelines) {
      const stageErrs = validate(p.enabled_stages ?? []);
      stageErrs.forEach((e) => errors.push(`Pipeline "${p.name}": ${e}`));
      normalizeStages(p.enabled_stages ?? []).forEach((s) => allStages.add(s));

      if (p.product_input && !(p.enabled_stages ?? []).some((s: string) => s === 'avatar' || s === 'broll_plan')) {
        warnings.push(`Pipeline "${p.name}" takes product photos but has no stage that can use them (avatar or B-roll).`);
      }
    }

    if (allStages.has('avatar')) {
      if (avatars.length === 0) warnings.push('An enabled pipeline uses the avatar stage but no avatar looks are configured.');
      if (avatars.some((a: any) => a.avatar_id === 'REPLACE_ME')) warnings.push('Some avatar looks still have a REPLACE_ME vendor id.');
    }
    if (allStages.has('audio') && !client.voice_id) {
      warnings.push('An enabled pipeline uses the audio stage but no voice_id is set.');
    }

    // KB doc emptiness + template-label match (research doc).
    const researchPath = client.kb_research_doc_path;
    let researchText = '';
    if (researchPath) {
      const dl = await supabase.storage.from(KB_BUCKET).download(researchPath);
      if (!dl.error) researchText = await dl.data.text();
    }
    if (!researchText.trim()) {
      warnings.push('The Research Doc is empty — topic/script generation needs it.');
    } else {
      const missing = templates.filter((t: any) => !researchText.includes(t.label)).map((t: any) => t.label);
      if (missing.length) warnings.push(`Template label(s) not found in the research doc: ${missing.join(', ')}.`);
    }

    if (allStages.has('adapt_voice') || allStages.has('audio')) {
      const vp = client.kb_voice_prompt_path;
      let voiceText = '';
      if (vp) { const dl = await supabase.storage.from(KB_BUCKET).download(vp); if (!dl.error) voiceText = await dl.data.text(); }
      if (!voiceText.trim()) warnings.push('The Voice Prompt doc is empty but an enabled pipeline adapts/voices the script.');
    }
    if (allStages.has('broll_plan')) {
      const cp = client.kb_creative_director_prompt_path;
      let cdText = '';
      if (cp) { const dl = await supabase.storage.from(KB_BUCKET).download(cp); if (!dl.error) cdText = await dl.data.text(); }
      if (!cdText.trim()) warnings.push('The Creative Director doc is empty but an enabled pipeline plans B-roll.');
    }

    return NextResponse.json({ ready: errors.length === 0, errors, warnings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

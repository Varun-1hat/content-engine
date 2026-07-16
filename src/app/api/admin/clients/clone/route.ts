import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { KB_DOCS, KB_BUCKET, uniqueClientSlug } from '@/lib/admin';

// POST /api/admin/clients/clone — onboarding shortcut.
// Body: { sourceId, displayName }
// Copies: client settings (inactive, vendor IDs cleared), pipelines, templates,
// avatar LABELS (avatar_id='REPLACE_ME'), and KB docs as starting skeletons.
// The new id is a server-generated uuid; the slug is derived from displayName.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const supabase = supabaseAdmin();
  let newId: string | null = null;
  try {
    const { sourceId, displayName } = await req.json();
    if (!sourceId || !displayName) {
      return NextResponse.json({ error: 'sourceId and displayName are required' }, { status: 400 });
    }

    const { data: source, error } = await supabase.from('clients').select('*').eq('id', sourceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!source) return NextResponse.json({ error: `Source client "${sourceId}" not found` }, { status: 404 });

    const slug = await uniqueClientSlug(supabase, displayName);

    // 1. Client row: same settings, cleared vendor specifics, new identity, inactive.
    const row: any = {
      ...source,
      display_name: displayName,
      slug,
      active: false,
      voice_id: null,
      visual_style_preset: null,
      storage_folder_prefix: slug,
      kb_research_doc_path: `${slug}/research_doc.md`,
      kb_voice_prompt_path: `${slug}/voice_prompt.md`,
      kb_creative_director_prompt_path: `${slug}/creative_director_prompt.md`,
      kb_past_content_path: null,
    };
    delete row.id;          // let the db generate a fresh uuid
    delete row.created_at;
    delete row.updated_at;
    const insClient = await supabase.from('clients').insert(row).select('id').single();
    if (insClient.error) throw new Error(insClient.error.message);
    newId = insClient.data.id as string;

    // 2. Pipelines (the point of cloning — copy the variant set).
    const { data: pipelines } = await supabase.from('client_pipelines').select('*').eq('client_id', sourceId);
    if (pipelines && pipelines.length > 0) {
      const pRows = pipelines.map((p: any) => ({
        client_id: newId,
        name: p.name,
        enabled_stages: p.enabled_stages,
        product_input: p.product_input,
        duration_min_sec: p.duration_min_sec,
        duration_max_sec: p.duration_max_sec,
        duration_default_sec: p.duration_default_sec,
        sort_order: p.sort_order,
        active: p.active,
      }));
      const pIns = await supabase.from('client_pipelines').insert(pRows);
      if (pIns.error) throw new Error(pIns.error.message);
    }

    // 3. Templates (labels must match the research doc — copied as-is).
    const { data: templates } = await supabase.from('client_templates').select('*').eq('client_id', sourceId);
    if (templates && templates.length > 0) {
      const tRows = templates.map((t: any) => ({
        client_id: newId,
        label: t.label,
        description: t.description,
        preview_video_url: null,
        sort_order: t.sort_order,
      }));
      const tIns = await supabase.from('client_templates').insert(tRows);
      if (tIns.error) throw new Error(tIns.error.message);
    }

    // 4. Avatar looks: labels copied, vendor IDs must be replaced.
    const { data: avatars } = await supabase.from('client_avatars').select('*').eq('client_id', sourceId);
    if (avatars && avatars.length > 0) {
      const aRows = avatars.map((a: any) => ({
        client_id: newId,
        label: a.label,
        avatar_id: 'REPLACE_ME',
        preview_image_url: null,
        sort_order: a.sort_order,
      }));
      const aIns = await supabase.from('client_avatars').insert(aRows);
      if (aIns.error) throw new Error(aIns.error.message);
    }

    // 5. KB docs copied as starting skeletons.
    const copied: string[] = [];
    for (const key of Object.keys(KB_DOCS)) {
      const meta = KB_DOCS[key];
      const srcPath = (source as any)[meta.column];
      if (!srcPath) continue;
      const dl = await supabase.storage.from(KB_BUCKET).download(srcPath);
      if (dl.error) continue;
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const destPath = `${slug}/${meta.filename}`;
      const up = await supabase.storage.from(KB_BUCKET).upload(destPath, buf, { contentType: 'text/markdown', upsert: true });
      if (!up.error) copied.push(destPath);
    }

    return NextResponse.json({
      success: true,
      clientId: newId,
      slug,
      copiedKbDocs: copied,
      checklist: [
        'Edit the KB docs for the new client (they are copies of the source)',
        'Set voice_id (ElevenLabs voice for this client)',
        'Replace every avatar_id (currently REPLACE_ME) or delete unused looks',
        'Upload template preview videos (currently empty)',
        'Review pipelines (which stages each variant runs)',
        'Run one test reel, then set active = true',
      ],
    }, { status: 201 });
  } catch (error: any) {
    // N2: clone is multi-step; roll back the half-created client on failure.
    if (newId) {
      await supabase.from('clients').delete().eq('id', newId).then(() => {}, () => {});
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

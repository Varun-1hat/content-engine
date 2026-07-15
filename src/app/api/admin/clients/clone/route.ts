import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { KB_DOCS, KB_BUCKET } from '@/lib/admin';

// POST /api/admin/clients/clone — onboarding shortcut.
// Body: { sourceId, newId, displayName }
// Copies: client settings row (inactive, vendor IDs cleared), templates,
// avatar LABELS (avatar_id set to 'REPLACE_ME'), and KB docs as starting
// skeletons under the new client's folder.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { sourceId, newId, displayName } = await req.json();
    if (!sourceId || !newId || !displayName) {
      return NextResponse.json({ error: 'sourceId, newId and displayName are required' }, { status: 400 });
    }
    if (!/^[a-z0-9_-]+$/.test(newId)) {
      return NextResponse.json({ error: 'newId must be a lowercase slug (a-z, 0-9, -, _)' }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data: source, error } = await supabase.from('clients').select('*').eq('id', sourceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!source) return NextResponse.json({ error: `Source client "${sourceId}" not found` }, { status: 404 });

    // 1. Client row: same settings, cleared vendor specifics, inactive.
    const row: any = {
      ...source,
      id: newId,
      display_name: displayName,
      active: false,
      voice_id: null,                       // per-client ElevenLabs voice — must be set
      visual_style_preset: null,
      storage_folder_prefix: newId,
      kb_research_doc_path: `${newId}/research_doc.md`,
      kb_voice_prompt_path: `${newId}/voice_prompt.md`,
      kb_creative_director_prompt_path: `${newId}/creative_director_prompt.md`,
      kb_past_content_path: null,
    };
    delete row.created_at;
    delete row.updated_at;
    const ins = await supabase.from('clients').insert(row);
    if (ins.error) throw new Error(ins.error.message);

    // 2. Templates (labels must match the research doc — copied as-is).
    const { data: templates } = await supabase.from('client_templates').select('*').eq('client_id', sourceId);
    if (templates && templates.length > 0) {
      const tRows = templates.map((t: any) => ({
        client_id: newId,
        label: t.label,
        description: t.description,
        preview_video_url: null, // source previews are the source client's reels
        sort_order: t.sort_order,
      }));
      const tIns = await supabase.from('client_templates').insert(tRows);
      if (tIns.error) throw new Error(tIns.error.message);
    }

    // 3. Avatar looks: labels copied, vendor IDs must be replaced.
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

    // 4. KB docs copied as starting skeletons.
    const copied: string[] = [];
    for (const key of Object.keys(KB_DOCS)) {
      const meta = KB_DOCS[key];
      const srcPath = (source as any)[meta.column];
      if (!srcPath) continue;
      const dl = await supabase.storage.from(KB_BUCKET).download(srcPath);
      if (dl.error) continue;
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const destPath = `${newId}/${meta.filename}`;
      const up = await supabase.storage.from(KB_BUCKET).upload(destPath, buf, { contentType: 'text/markdown', upsert: true });
      if (!up.error) copied.push(destPath);
    }

    return NextResponse.json({
      success: true,
      clientId: newId,
      copiedKbDocs: copied,
      checklist: [
        'Edit the 3 KB docs for the new client (they are copies of the source)',
        'Set voice_id (ElevenLabs voice for this client)',
        'Replace every avatar_id (currently REPLACE_ME) or delete unused looks',
        'Upload template preview videos (currently empty)',
        'Run one test script, then set active = true',
      ],
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

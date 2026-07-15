import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { filterClientPatch } from '@/lib/admin';

// GET /api/admin/clients — all clients (incl. inactive), full settings rows.
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { data, error } = await supabaseAdmin().from('clients').select('*').order('display_name');
    if (error) throw new Error(error.message);
    return NextResponse.json({ clients: data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/clients — create a client. Body: { id, display_name, ...optional column overrides }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { id, display_name } = body;
    if (!id || !display_name) {
      return NextResponse.json({ error: 'id and display_name are required' }, { status: 400 });
    }
    if (!/^[a-z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: 'id must be a lowercase slug (a-z, 0-9, -, _)' }, { status: 400 });
    }

    const row = {
      ...filterClientPatch(body),
      id,
      display_name,
      storage_folder_prefix: body.storage_folder_prefix ?? id,
      kb_research_doc_path: body.kb_research_doc_path ?? `${id}/research_doc.md`,
      kb_voice_prompt_path: body.kb_voice_prompt_path ?? `${id}/voice_prompt.md`,
      kb_creative_director_prompt_path: body.kb_creative_director_prompt_path ?? `${id}/creative_director_prompt.md`,
      active: body.active ?? false, // new clients start inactive until configured
    };

    const { data, error } = await supabaseAdmin().from('clients').insert(row).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ client: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

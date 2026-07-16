import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { filterClientPatch, uniqueClientSlug } from '@/lib/admin';

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

// POST /api/admin/clients — create a blank client. Body: { display_name, ...optional column overrides }
// The id is a server-generated uuid; the slug (folder name) is derived from the display name.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { display_name } = body;
    if (!display_name || !String(display_name).trim()) {
      return NextResponse.json({ error: 'display_name is required' }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const slug = await uniqueClientSlug(supabase, display_name);

    const row = {
      ...filterClientPatch(body),
      display_name,
      slug,
      storage_folder_prefix: body.storage_folder_prefix ?? slug,
      kb_research_doc_path: body.kb_research_doc_path ?? `${slug}/research_doc.md`,
      kb_voice_prompt_path: body.kb_voice_prompt_path ?? `${slug}/voice_prompt.md`,
      kb_creative_director_prompt_path: body.kb_creative_director_prompt_path ?? `${slug}/creative_director_prompt.md`,
      active: body.active ?? false, // new clients start inactive until configured
    };

    const { data, error } = await supabase.from('clients').insert(row).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ client: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';

// POST — add a template. Body: { label, description?, preview_video_url?, sort_order? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const { label, description, preview_video_url, sort_order } = await req.json();
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
    const { data, error } = await supabaseAdmin()
      .from('client_templates')
      .insert({
        client_id: id,
        label,
        description: description ?? null,
        preview_video_url: preview_video_url ?? null,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ template: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH — update a template. Body: { id, ...fields }
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id, label, description, preview_video_url, sort_order } = await req.json();
    if (!id) return NextResponse.json({ error: 'template row id is required' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if (label !== undefined) patch.label = label;
    if (description !== undefined) patch.description = description;
    if (preview_video_url !== undefined) patch.preview_video_url = preview_video_url;
    if (sort_order !== undefined) patch.sort_order = sort_order;
    const { data, error } = await supabaseAdmin()
      .from('client_templates')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ template: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE — remove a template. Body: { id }
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'template row id is required' }, { status: 400 });
    const { error } = await supabaseAdmin().from('client_templates').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';

// POST — add an avatar look. Body: { label, avatar_id, preview_image_url?, sort_order? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const { label, avatar_id, preview_image_url, sort_order } = await req.json();
    if (!label || !avatar_id) {
      return NextResponse.json({ error: 'label and avatar_id are required' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin()
      .from('client_avatars')
      .insert({ client_id: id, label, avatar_id, preview_image_url: preview_image_url ?? null, sort_order: sort_order ?? 0 })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ avatar: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH — update a look. Body: { id, ...fields }
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id, label, avatar_id, preview_image_url, sort_order } = await req.json();
    if (!id) return NextResponse.json({ error: 'avatar row id is required' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if (label !== undefined) patch.label = label;
    if (avatar_id !== undefined) patch.avatar_id = avatar_id;
    if (preview_image_url !== undefined) patch.preview_image_url = preview_image_url;
    if (sort_order !== undefined) patch.sort_order = sort_order;
    const { data, error } = await supabaseAdmin()
      .from('client_avatars')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ avatar: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE — remove a look. Body: { id }
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'avatar row id is required' }, { status: 400 });
    const { error } = await supabaseAdmin().from('client_avatars').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

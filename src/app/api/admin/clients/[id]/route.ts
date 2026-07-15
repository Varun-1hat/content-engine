import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { filterClientPatch } from '@/lib/admin';

// GET /api/admin/clients/[id] — full row + avatars + templates.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const supabase = supabaseAdmin();
    const [clientRes, avatarRes, templateRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).maybeSingle(),
      supabase.from('client_avatars').select('*').eq('client_id', id).order('sort_order'),
      supabase.from('client_templates').select('*').eq('client_id', id).order('sort_order'),
    ]);
    if (clientRes.error) throw new Error(clientRes.error.message);
    if (!clientRes.data) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    return NextResponse.json({
      client: clientRes.data,
      avatars: avatarRes.data ?? [],
      templates: templateRes.data ?? [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/admin/clients/[id] — update allowlisted settings columns.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const patch = filterClientPatch(await req.json());
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid client fields in patch' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin()
      .from('clients')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ client: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

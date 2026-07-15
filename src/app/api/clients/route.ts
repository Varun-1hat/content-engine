import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireUser } from '@/lib/auth';

// GET /api/clients — active clients for the picker. No config, no vendor IDs.
// Admins see all active clients; client-role users see only their own.
export async function GET() {
  try {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;

    let query = supabaseAdmin()
      .from('clients')
      .select('id, display_name')
      .eq('active', true)
      .order('display_name');
    if (auth.role === 'client') {
      query = query.eq('id', auth.clientId ?? '');
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({
      clients: (data ?? []).map((c) => ({ id: c.id, displayName: c.display_name })),
    });
  } catch (error: any) {
    console.error('Error listing clients:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

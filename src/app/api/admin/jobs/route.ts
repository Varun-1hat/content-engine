import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';

// GET /api/admin/jobs?limit=&client= — recent jobs across all clients.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
    const clientId = url.searchParams.get('client');

    let query = supabaseAdmin()
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (clientId) query = query.eq('client_id', clientId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ jobs: data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

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
      .select('*, clients(display_name), client_pipelines(name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (clientId) query = query.eq('client_id', clientId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const jobs = (data ?? []).map((j: any) => ({
      ...j,
      client_name: j.clients?.display_name ?? null,
      pipeline_name: j.client_pipelines?.name ?? null,
    }));
    return NextResponse.json({ jobs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

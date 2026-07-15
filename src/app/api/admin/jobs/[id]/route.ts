import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';

// GET /api/admin/jobs/[id] — full job + its event log.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const supabase = supabaseAdmin();
    const [jobRes, eventsRes] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).maybeSingle(),
      supabase.from('job_events').select('*').eq('job_id', id).order('created_at'),
    ]);
    if (jobRes.error) throw new Error(jobRes.error.message);
    if (!jobRes.data) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    return NextResponse.json({ job: jobRes.data, events: eventsRes.data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

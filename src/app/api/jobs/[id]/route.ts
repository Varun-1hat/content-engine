import { NextResponse } from 'next/server';
import { getJob, updateJob } from '@/lib/jobs';
import { requireUser, forbidClientMismatch } from '@/lib/auth';

// GET /api/jobs/[id] — full job row (resume-by-id).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const job = await getJob(id);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    const forbidden = forbidClientMismatch(auth, job.client_id);
    if (forbidden) return forbidden;
    return NextResponse.json({ job });
  } catch (error: any) {
    console.error('Error loading job:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// PATCH /api/jobs/[id] — write allowlisted fields (user edits, stage choices).
// Stage routes write artifacts themselves; this is for UI-driven updates.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const existing = await getJob(id);
    if (!existing) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    const forbidden = forbidClientMismatch(auth, existing.client_id);
    if (forbidden) return forbidden;

    const patch = await req.json();
    const job = await updateJob(id, patch);
    return NextResponse.json({ job });
  } catch (error: any) {
    const badPatch = /No valid job fields/.test(error?.message ?? '');
    console.error('Error updating job:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: badPatch ? 400 : 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { createJob, listJobs } from '@/lib/jobs';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';

// POST /api/jobs — create a job for a client. Body: { clientId }
export async function POST(req: Request) {
  try {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;

    const { clientId } = await req.json();
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;

    // Validates the client exists and is active (throws otherwise).
    await loadClientConfig(clientId);

    const job = await createJob(clientId, auth.email);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error: any) {
    const notFound = /Unknown or inactive client/.test(error?.message ?? '');
    console.error('Error creating job:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: notFound ? 404 : 500 }
    );
  }
}

// GET /api/jobs?client=<id>&limit=<n> — recent jobs for a client.
export async function GET(req: Request) {
  try {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;

    const url = new URL(req.url);
    const clientId = url.searchParams.get('client');
    if (!clientId) {
      return NextResponse.json({ error: '?client= is required' }, { status: 400 });
    }
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

    const jobs = await listJobs(clientId, limit);
    return NextResponse.json({ jobs });
  } catch (error: any) {
    console.error('Error listing jobs:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

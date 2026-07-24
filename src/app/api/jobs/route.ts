import { NextResponse } from 'next/server';
import { createJob, listJobs } from '@/lib/jobs';
import { loadClientConfig } from '@/lib/clients/loadConfig';
import { getVisualAdapter } from '@/lib/adapters/visual';
import { getScriptAdapter } from '@/lib/adapters/script';
import { measureProductPayloadBytes, productPayloadRefusal } from '@/lib/pipeline/product';
import { requireUser, forbidClientMismatch } from '@/lib/auth';

// POST /api/jobs — create a reel job bound to a pipeline.
// Body: { clientId, pipelineId, voiceover?, injectedScript?, productImageUrls?,
//         brollFrequency?, productOverridesResearch? }
export async function POST(req: Request) {
  try {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;

    const {
      clientId,
      pipelineId,
      voiceover,
      injectedScript,
      productImageUrls,
      brollFrequency,
      productOverridesResearch,
    } = await req.json();
    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    if (!pipelineId) return NextResponse.json({ error: 'pipelineId is required' }, { status: 400 });
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;

    // Validates the client exists and is active (throws otherwise).
    const c = await loadClientConfig(clientId);

    // The Studio caps uploads at the provider's limit, but that's a UI courtesy
    // — enforce it here too. Truncating silently would mean the photos a user
    // uploaded are not the photos their reel was built from.
    if (Array.isArray(productImageUrls)) {
      const limit = getVisualAdapter(c.visual.provider).maxReferenceImages;
      if (productImageUrls.length > limit) {
        return NextResponse.json(
          { error: `At most ${limit} product photo(s) per reel for this client's visual provider (got ${productImageUrls.length}).` },
          { status: 400 }
        );
      }

      // ...and the same reel's photos against the one SIZE limit, on the axis it
      // is actually measured on: the total the script model receives in one
      // request. /api/uploads only ever sees one file, so three individually
      // fine photos can pass upload and blow the ceiling together — and by then
      // the reel row exists, the picker is gone from the screen, and the first
      // stage that attaches photos would fail with no way back. This is the last
      // moment the user can still remove one.
      if (productImageUrls.length > 0) {
        const maxTotalBytes = getScriptAdapter(c.script.provider).maxInlineImagePayloadBytes;
        let totalBytes: number;
        try {
          totalBytes = await measureProductPayloadBytes(productImageUrls);
        } catch (err) {
          console.error("Could not measure this reel's product photos:", err);
          return NextResponse.json(
            { error: 'One of the product photos could not be read. Remove it and upload it again.' },
            { status: 400 }
          );
        }
        const refusal = productPayloadRefusal(totalBytes, maxTotalBytes);
        if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });
      }
    }

    const job = await createJob(clientId, {
      pipelineId,
      voiceover: voiceover !== false, // default on
      injectedScript: typeof injectedScript === 'string' && injectedScript.trim() ? injectedScript : undefined,
      productImageUrls: Array.isArray(productImageUrls) ? productImageUrls : undefined,
      // A human label ("Minimal" | "Standard" | "High"), resolved server-side.
      // An unrecognised one is UI drift, not an attack — createJob normalises it
      // to the default rather than 400-ing.
      brollFrequency: typeof brollFrequency === 'string' ? brollFrequency : undefined,
      productOverridesResearch: productOverridesResearch === true,
      createdBy: auth.email,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (error: any) {
    const msg = error?.message ?? '';
    const notFound = /Unknown or inactive client/.test(msg);
    const badPipeline = /PIPELINE_INVALID/.test(msg);
    const badPlan = /^PLAN_INVALID: /.test(msg);
    console.error('Error creating job:', error);
    return NextResponse.json(
      {
        error: badPipeline
          ? 'Invalid or inactive pipeline for this client'
          : badPlan
            ? `These reel options leave an unrunnable pipeline. ${msg.replace('PLAN_INVALID: ', '')}`
            : (error.message || 'Internal Server Error'),
      },
      { status: notFound ? 404 : badPipeline || badPlan ? 400 : 500 }
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

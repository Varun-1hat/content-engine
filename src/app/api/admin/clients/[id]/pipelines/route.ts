import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { normalizeStages, validate } from '@/lib/pipeline/stages';

// CRUD over client_pipelines. Each pipeline = an enabled-stage subset + settings.
// enabled_stages is validated against the code stage registry before writing.

/**
 * Map a Postgres error to a response. A duplicate name trips the
 * unique (client_id, name) constraint — that's the user typing the same name
 * twice, not a server fault, so it must not surface as a raw 500.
 */
function dbError(error: { code?: string; message: string }): NextResponse {
  if (error.code === '23505') {
    return NextResponse.json(
      { error: 'A pipeline with that name already exists for this client. Pick a different name.' },
      { status: 400 }
    );
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}

function cleanStages(input: unknown): { stages: string[]; error?: string } {
  if (!Array.isArray(input)) return { stages: [], error: 'enabled_stages must be an array' };
  const errors = validate(input as string[]);
  if (errors.length) return { stages: [], error: errors.join(' ') };
  return { stages: normalizeStages(input as string[]) };
}

// GET — list this client's pipelines.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const { data, error } = await supabaseAdmin()
      .from('client_pipelines')
      .select('*')
      .eq('client_id', id)
      .order('sort_order');
    if (error) throw new Error(error.message);
    return NextResponse.json({ pipelines: data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — create a pipeline. Body: { name, enabled_stages, product_input?, duration_*?, sort_order?, active? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await req.json();
    if (!body.name || !String(body.name).trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const { stages, error: stageErr } = cleanStages(body.enabled_stages);
    if (stageErr) return NextResponse.json({ error: stageErr }, { status: 400 });

    const row = {
      client_id: id,
      name: body.name,
      enabled_stages: stages,
      product_input: body.product_input ?? false,
      duration_min_sec: body.duration_min_sec ?? 15,
      duration_max_sec: body.duration_max_sec ?? 90,
      duration_default_sec: body.duration_default_sec ?? 45,
      sort_order: body.sort_order ?? 0,
      active: body.active ?? true,
    };
    const { data, error } = await supabaseAdmin().from('client_pipelines').insert(row).select().single();
    if (error) return dbError(error);
    return NextResponse.json({ pipeline: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH — update a pipeline. Body: { id, ...fields }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id: clientId } = await params;
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: 'pipeline row id is required' }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.enabled_stages !== undefined) {
      const { stages, error: stageErr } = cleanStages(body.enabled_stages);
      if (stageErr) return NextResponse.json({ error: stageErr }, { status: 400 });
      patch.enabled_stages = stages;
    }
    for (const k of ['product_input', 'duration_min_sec', 'duration_max_sec', 'duration_default_sec', 'sort_order', 'active']) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid pipeline fields in patch' }, { status: 400 });
    }

    // Scope the write to the client in the URL — the row id alone would let an
    // admin edit another client's pipeline by pasting its id. maybeSingle so a
    // non-match is a clean 404 rather than a thrown "no rows" error.
    const { data, error } = await supabaseAdmin()
      .from('client_pipelines')
      .update(patch)
      .eq('id', body.id)
      .eq('client_id', clientId)
      .select()
      .maybeSingle();
    if (error) return dbError(error);
    if (!data) return NextResponse.json({ error: 'Pipeline not found for this client' }, { status: 404 });
    return NextResponse.json({ pipeline: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE — remove a pipeline. Body: { id }
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id: clientId } = await params;
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'pipeline row id is required' }, { status: 400 });
    // Scoped to the client in the URL for the same reason as PATCH.
    const { data, error } = await supabaseAdmin()
      .from('client_pipelines')
      .delete()
      .eq('id', id)
      .eq('client_id', clientId)
      .select()
      .maybeSingle();
    if (error) return dbError(error);
    if (!data) return NextResponse.json({ error: 'Pipeline not found for this client' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { KB_DOCS, KB_BUCKET } from '@/lib/admin';

// GET /api/admin/clients/[id]/kb?doc=research|voice|creative_director|past_content
// Returns the live doc content from Storage ('' when it doesn't exist yet).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const doc = new URL(req.url).searchParams.get('doc') ?? '';
    const meta = KB_DOCS[doc];
    if (!meta) return NextResponse.json({ error: `Unknown doc "${doc}"` }, { status: 400 });

    const supabase = supabaseAdmin();
    const { data: client, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const path = (client as any)[meta.column] || `${(client as any).slug}/${meta.filename}`;
    const dl = await supabase.storage.from(KB_BUCKET).download(path);
    const content = dl.error ? '' : await dl.data.text();

    return NextResponse.json({ doc, path, content, exists: !dl.error });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/admin/clients/[id]/kb — save a doc. Body: { doc, content }
// Writes the live path, keeps a timestamped backup copy, records kb_revisions,
// and fills the client's kb_*_path column if it was empty.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const { doc, content } = await req.json();
    const meta = KB_DOCS[doc];
    if (!meta) return NextResponse.json({ error: `Unknown doc "${doc}"` }, { status: 400 });
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content (string) is required' }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data: client, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const slug = (client as any).slug;
    const livePath = (client as any)[meta.column] || `${slug}/${meta.filename}`;
    const buf = Buffer.from(content, 'utf-8');

    // 1. Timestamped backup of the NEW version (append-only history)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${slug}/history/${meta.filename}.${stamp}`;
    const backup = await supabase.storage.from(KB_BUCKET).upload(backupPath, buf, { contentType: 'text/markdown' });
    if (backup.error) throw new Error(`Backup failed: ${backup.error.message}`);

    // 2. Overwrite the live doc (takes effect within the 60s config cache TTL)
    const up = await supabase.storage.from(KB_BUCKET).upload(livePath, buf, { contentType: 'text/markdown', upsert: true });
    if (up.error) throw new Error(up.error.message);

    // 3. Revision record
    await supabase.from('kb_revisions').insert({ client_id: id, path: backupPath, saved_by: auth.email });

    // 4. Fill the path column if it was empty (e.g. first past_content save)
    if (!(client as any)[meta.column]) {
      await supabase.from('clients').update({ [meta.column]: livePath }).eq('id', id);
    }

    return NextResponse.json({ success: true, path: livePath, backupPath });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

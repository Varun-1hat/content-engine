import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { getStorageAdapter } from '@/lib/adapters/storage';

// POST /api/admin/upload — preview-asset upload (admins).
// multipart/form-data { file, clientId, kind: 'avatar_preview' | 'template_preview' }.
// Works on inactive clients (onboarding), so it queries the client directly.
export const runtime = 'nodejs';
const MAX_BYTES = 50 * 1024 * 1024;

const KINDS: Record<string, { folder: string; resourceType: 'image' | 'video' }> = {
  avatar_preview: { folder: 'uploads/avatar_preview', resourceType: 'image' },
  template_preview: { folder: 'uploads/template_preview', resourceType: 'video' },
};

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const form = await req.formData();
    const clientId = form.get('clientId') as string | null;
    const kind = form.get('kind') as string | null;
    const file = form.get('file') as File | null;
    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    if (!kind || !KINDS[kind]) return NextResponse.json({ error: 'kind must be avatar_preview or template_preview' }, { status: 400 });
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 50 MB' }, { status: 400 });

    const { data: client, error } = await supabaseAdmin()
      .from('clients')
      .select('slug, storage_provider, storage_folder_prefix')
      .eq('id', clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const prefix = (client as any).storage_folder_prefix || (client as any).slug;
    const meta = KINDS[kind];
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await getStorageAdapter((client as any).storage_provider).upload(buffer, {
      folder: `${prefix}/${meta.folder}`,
      resourceType: meta.resourceType,
    });
    return NextResponse.json({ url });
  } catch (error: any) {
    console.error('Admin upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}

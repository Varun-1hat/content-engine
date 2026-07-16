import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getStorageAdapter } from '@/lib/adapters/storage';

// POST /api/uploads — per-reel product photo upload (Studio users).
// multipart/form-data { file, clientId }. Returns a public Cloudinary URL.
// Product photos are transient reel inputs (not a stored catalog) — they land
// in an _incoming folder and are referenced by the job's product_image_urls.
export const runtime = 'nodejs';
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const form = await req.formData();
    const clientId = form.get('clientId') as string | null;
    const file = form.get('file') as File | null;
    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    const forbidden = forbidClientMismatch(auth, clientId);
    if (forbidden) return forbidden;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 20 MB' }, { status: 400 });

    const { data: client, error } = await supabaseAdmin()
      .from('clients')
      .select('slug, storage_provider, storage_folder_prefix')
      .eq('id', clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const prefix = (client as any).storage_folder_prefix || (client as any).slug;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await getStorageAdapter((client as any).storage_provider).upload(buffer, {
      folder: `${prefix}/jobs/_incoming/product`,
      resourceType: 'image',
    });
    return NextResponse.json({ url });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}

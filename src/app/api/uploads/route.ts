import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireUser, forbidClientMismatch } from '@/lib/auth';
import { getStorageAdapter } from '@/lib/adapters/storage';
import { getScriptAdapter } from '@/lib/adapters/script';
import { productPhotoTooLargeMessage } from '@/lib/pipeline/product';

// POST /api/uploads — per-reel product photo upload (Studio users).
// multipart/form-data { file, clientId }. Returns a public Cloudinary URL.
// Product photos are transient reel inputs (not a stored catalog) — they land
// in an _incoming folder and are referenced by the job's product_image_urls.
//
// The size ceiling is the SCRIPT model's inline-image payload limit, and it is a
// per-reel TOTAL. This route sees one file at a time and has no reel to total
// against yet, so it can only refuse the case it can see: a lone file already
// over the reel's ceiling, which could never be part of a usable reel. The
// total itself is enforced at POST /api/jobs (where the reel's whole photo set
// is known) and again in fetchProductImages. One number, one axis, stated in the
// Studio and enforced at all three.
//
// Deliberately NOT loadClientConfig: that requires active = true, and an
// inactive client's uploads behaving differently is a behaviour change nobody
// asked for. This reads the one column it needs off the row directly.
export const runtime = 'nodejs';

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

    const { data: client, error } = await supabaseAdmin()
      .from('clients')
      .select('slug, script_provider, storage_provider, storage_folder_prefix')
      .eq('id', clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const maxBytes = getScriptAdapter((client as { script_provider: string }).script_provider)
      .maxInlineImagePayloadBytes;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: productPhotoTooLargeMessage(file.size, maxBytes) },
        { status: 400 }
      );
    }

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

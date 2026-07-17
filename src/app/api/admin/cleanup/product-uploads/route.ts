import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';
import { getStorageAdapter } from '@/lib/adapters/storage';

// POST /api/admin/cleanup/product-uploads
// Sweeps abandoned per-reel product photos out of <prefix>/jobs/_incoming/product.
//
// Product photos are uploaded BEFORE the job row exists (the Studio uploads,
// then creates the reel), so an abandoned reel-setup leaves an orphan behind.
// Nothing else cleans them up.
//
// This deletes media, so it is deliberately conservative:
//   - DRY RUN by default; nothing is deleted unless apply === true.
//   - only ever looks inside that one folder, per client.
//   - skips anything referenced by ANY job's product_image_urls, regardless of
//     the job's age or state — a finished reel may still be retried/reassembled.
//   - skips anything newer than olderThanDays (default 7), because an upload in
//     progress has no job row yet and must not be swept from under the user.
//
// Body: { clientId?, prefix?, provider?, olderThanDays?: number, apply?: boolean }
//
// `prefix` sweeps a folder directly, for the one case the client loop cannot
// reach: a DELETED client's leftovers (its jobs cascaded away with it, so no
// row points at the folder any more). It must still end in the _incoming
// suffix — that guard is what stops this endpoint being pointed at
// `<slug>/assembled` and deleting delivered reels.
const DEFAULT_OLDER_THAN_DAYS = 7;
const INCOMING_SUFFIX = 'jobs/_incoming/product';

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const olderThanDays = Number(body.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS);
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
      return NextResponse.json({ error: 'olderThanDays must be a non-negative number' }, { status: 400 });
    }
    const apply = body.apply === true;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    const supabase = supabaseAdmin();

    // Targets are either real clients, or one explicitly-named orphan folder.
    let targets: { id: string | null; slug: string; storage_provider: string; prefix: string }[];

    if (body.prefix) {
      const prefix = String(body.prefix).replace(/\/+$/, '');
      if (!prefix.endsWith(INCOMING_SUFFIX)) {
        return NextResponse.json(
          { error: `prefix must end with "${INCOMING_SUFFIX}" — this endpoint only ever sweeps per-reel product uploads` },
          { status: 400 }
        );
      }
      targets = [{ id: null, slug: prefix, storage_provider: body.provider || 'cloudinary', prefix }];
    } else {
      let clientQuery = supabase.from('clients').select('id, slug, storage_provider, storage_folder_prefix');
      if (body.clientId) clientQuery = clientQuery.eq('id', body.clientId);
      const { data: clients, error: cErr } = await clientQuery;
      if (cErr) throw new Error(cErr.message);
      if (!clients?.length) {
        return NextResponse.json({ error: 'No matching clients' }, { status: 404 });
      }
      targets = (clients as any[]).map((c) => ({
        id: c.id,
        slug: c.slug,
        storage_provider: c.storage_provider,
        prefix: `${c.storage_folder_prefix || c.slug}/${INCOMING_SUFFIX}`,
      }));
    }

    const report: any[] = [];
    let totalDeleted = 0;
    let totalBytes = 0;

    for (const target of targets) {
      const storage = getStorageAdapter(target.storage_provider);
      if (!storage.list || !storage.remove) {
        report.push({
          client: target.slug,
          skipped: `storage provider "${target.storage_provider}" does not support listing/removal`,
        });
        continue;
      }

      const prefix = target.prefix;
      const assets = await storage.list(prefix, 'image');
      if (assets.length === 0) {
        report.push({ client: target.slug, prefix, found: 0, orphans: 0, deleted: 0 });
        continue;
      }

      // Everything the reels still point at. Checked against every job, not
      // just recent ones — retry/reassemble re-reads these URLs. For an
      // explicit prefix the owning client is unknown, so check ALL jobs: the
      // wider net can only ever protect more.
      let jobQuery = supabase.from('jobs').select('product_image_urls');
      if (target.id) jobQuery = jobQuery.eq('client_id', target.id);
      const { data: jobs, error: jErr } = await jobQuery;
      if (jErr) throw new Error(jErr.message);
      const referenced = new Set<string>();
      for (const j of (jobs ?? []) as any[]) {
        for (const url of j.product_image_urls ?? []) referenced.add(url);
      }

      const orphans = assets.filter((a) => {
        // Match on publicId too: a stored URL may carry a version segment or a
        // transformation, so exact URL equality alone would under-match and
        // delete something still in use.
        const isReferenced =
          referenced.has(a.url) || [...referenced].some((u) => u.includes(a.publicId));
        if (isReferenced) return false;
        return new Date(a.createdAt).getTime() < cutoff;
      });

      let deleted = 0;
      if (apply && orphans.length > 0) {
        deleted = await storage.remove(orphans.map((o) => o.publicId), 'image');
      }
      totalDeleted += deleted;
      totalBytes += orphans.reduce((sum, o) => sum + o.bytes, 0);

      report.push({
        client: target.slug,
        prefix,
        found: assets.length,
        referenced: assets.length - orphans.length,
        orphans: orphans.length,
        deleted,
        orphanIds: orphans.map((o) => o.publicId),
      });
    }

    return NextResponse.json({
      dryRun: !apply,
      note: apply
        ? 'Deleted the orphans listed below.'
        : 'Nothing was deleted. Re-send with {"apply": true} to delete the orphans listed below.',
      olderThanDays,
      totalOrphanBytes: totalBytes,
      totalDeleted,
      report,
    });
  } catch (error: any) {
    console.error('Product upload cleanup failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

'use client';

import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client: used ONLY for auth (sign in/out).
// Data access is impossible with this key — RLS has zero policies.
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}

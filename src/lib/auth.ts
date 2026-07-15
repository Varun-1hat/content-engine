import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from './clients/loadConfig';

// Auth model: Supabase Auth holds the session (cookie-based via @supabase/ssr);
// the app_users table is the allowlist + role mapping. A Supabase user who is
// not in app_users (or inactive) is treated as unauthorized.
//   role 'admin'  -> all clients + /admin panel
//   role 'client' -> locked to their client_id

export interface AuthUser {
  email: string;
  role: 'admin' | 'client';
  clientId: string | null;
}

async function serverSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Route handlers may not always allow cookie writes; session refresh
          // is handled by proxy.ts, so ignore failures here.
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    }
  );
}

/** Session + allowlist lookup. Returns null when either is missing. */
export async function getSessionUser(): Promise<AuthUser | null> {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;

  const email = data.user.email.toLowerCase();
  const { data: appUser } = await supabaseAdmin()
    .from('app_users')
    .select('email, role, client_id, active')
    .eq('email', email)
    .maybeSingle();

  if (!appUser || !appUser.active) return null;
  return { email, role: appUser.role, clientId: appUser.client_id };
}

/** For API routes: AuthUser, or a ready 401 response. */
export async function requireUser(): Promise<AuthUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return user;
}

/** For admin API routes: admin AuthUser, or a ready 401/403 response. */
export async function requireAdmin(): Promise<AuthUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  return user;
}

/**
 * Client-scoping: admins may act on any client; client-role users only on
 * their own. Returns null when allowed, or a ready 403 response.
 */
export function forbidClientMismatch(user: AuthUser, clientId: string): NextResponse | null {
  if (user.role === 'admin') return null;
  if (user.clientId === clientId) return null;
  return NextResponse.json({ error: 'Access to this client is not allowed' }, { status: 403 });
}

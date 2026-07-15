import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/clients/loadConfig';
import { requireAdmin } from '@/lib/auth';

// Login management, fully from the panel: a "user" = a Supabase Auth account
// (created here with the service key) + an app_users allowlist row.
// Deactivating flips app_users.active — the session may survive, but every
// data route rejects the user (getSessionUser returns null).

// GET /api/admin/users — allowlist rows + the caller's email (for self-guard in UI).
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const { data, error } = await supabaseAdmin()
      .from('app_users')
      .select('*')
      .order('created_at');
    if (error) throw new Error(error.message);
    return NextResponse.json({ users: data ?? [], me: auth.email });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/users — create a login. Body: { email, password, role, client_id? }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    const { password, role, client_id } = body;

    if (!email || !password) return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 });
    if (!['admin', 'client'].includes(role)) return NextResponse.json({ error: "role must be 'admin' or 'client'" }, { status: 400 });
    if (role === 'client' && !client_id) {
      return NextResponse.json({ error: 'client_id is required for client-role users' }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error && !/already/i.test(created.error.message)) {
      throw new Error(`Auth user creation failed: ${created.error.message}`);
    }

    const { data, error } = await supabase
      .from('app_users')
      .upsert({ email, role, client_id: role === 'client' ? client_id : null, active: true })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ user: data, authUserExisted: !!created.error }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/admin/users — update allowlist row. Body: { email, active?, role?, client_id? }
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

    // Lockout protection: an admin cannot deactivate or demote themselves.
    if (email === auth.email && (body.active === false || (body.role && body.role !== 'admin'))) {
      return NextResponse.json({ error: 'You cannot deactivate or demote your own account' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (body.active !== undefined) patch.active = !!body.active;
    if (body.role !== undefined) {
      if (!['admin', 'client'].includes(body.role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 });
      patch.role = body.role;
    }
    if (body.client_id !== undefined) patch.client_id = body.client_id || null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

    const { data, error } = await supabaseAdmin()
      .from('app_users')
      .update(patch)
      .eq('email', email)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ user: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

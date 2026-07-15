import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Session gate for PAGES: refreshes the Supabase session cookie and redirects
// unauthenticated visitors to /login. API routes are excluded — they enforce
// auth themselves (src/lib/auth.ts) and return JSON 401s instead of redirects.
// Role checks (admin vs client) happen server-side where data is served.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data } = await supabase.auth.getUser();
  const isLoginPage = request.nextUrl.pathname === '/login';

  if (!data.user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (data.user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Pages only: skip API routes, Next internals, and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|mp4|mp3|pdf|csv|md|ico|webp)$).*)'],
};

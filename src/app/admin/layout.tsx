import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';

// Server-side role gate: only app_users with role 'admin' get past this layout.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  return (
    // w-full+min-w-0: <body> is a flex column, so this wrapper must be allowed
    // to shrink below its content or long names push the page sideways.
    <div className="min-h-screen w-full min-w-0">
      <nav className="border-b border-gray-800 bg-black/40 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-4 sm:gap-8 min-w-0">
            <span className="font-extrabold text-white whitespace-nowrap hidden sm:inline">Reel Engine <span className="gradient-text">Admin</span></span>
            <div className="flex items-center gap-4 text-sm shrink-0">
              <Link href="/admin/clients" className="text-gray-300 hover:text-white transition-colors">Clients</Link>
              <Link href="/admin/jobs" className="text-gray-300 hover:text-white transition-colors">Jobs</Link>
              <Link href="/admin/users" className="text-gray-300 hover:text-white transition-colors">Users</Link>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm min-w-0">
            {/* email is context, not navigation — first thing to go on narrow screens */}
            <span className="text-gray-500 truncate hidden md:inline">{user.email}</span>
            <Link href="/" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors shrink-0">Studio</Link>
          </div>
        </div>
      </nav>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">{children}</div>
    </div>
  );
}

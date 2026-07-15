import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';

// Server-side role gate: only app_users with role 'admin' get past this layout.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-800 bg-black/40 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <span className="font-extrabold text-white">Reel Engine <span className="gradient-text">Admin</span></span>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/admin/clients" className="text-gray-300 hover:text-white transition-colors">Clients</Link>
              <Link href="/admin/jobs" className="text-gray-300 hover:text-white transition-colors">Jobs</Link>
              <Link href="/admin/users" className="text-gray-300 hover:text-white transition-colors">Users</Link>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-500">{user.email}</span>
            <Link href="/" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors">Studio</Link>
          </div>
        </div>
      </nav>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">{children}</div>
    </div>
  );
}

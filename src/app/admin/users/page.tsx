"use client";

import { useEffect, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { humanize } from "@/lib/labels";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [me, setMe] = useState("");
  const [clients, setClients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "client">("admin");
  const [clientId, setClientId] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const load = async () => {
    const [u, c] = await Promise.all([
      fetch("/api/admin/users").then((r) => r.json()),
      fetch("/api/admin/clients").then((r) => r.json()),
    ]);
    setUsers(u.users || []);
    setMe(u.me || "");
    setClients(c.clients || []);
    setIsLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role, client_id: role === "client" ? clientId : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEmail("");
      setPassword("");
      await load();
      alert(data.authUserExisted ? "Login already existed — allowlist row updated." : "User created. Share the email + password with them.");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const toggleActive = async (u: any) => {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: u.email, active: !u.active }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-extrabold text-white">Users</h1>

      <div className="glass-card p-6 space-y-4">
        <h3 className="text-white font-bold flex items-center gap-2"><UserPlus size={18} className="text-primary" /> Add Login</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@company.com"
            className="px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            className="px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
            className="px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="admin">admin — internal team, all clients + this panel</option>
            <option value="client">client — locked to one client&apos;s studio</option>
          </select>
          {role === "client" && (
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">— pick client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={handleCreate}
          disabled={isCreating || !email || !password || (role === "client" && !clientId)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all disabled:opacity-50"
        >
          {isCreating ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} Create Login
        </button>
      </div>

      <div className="glass-card p-6">
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-primary" size={28} /></div>
        ) : (
          <div className="space-y-3">
            {users.map((u) => (
              <div key={u.email} className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-indigo-950/30 border-gray-700">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{u.email} {u.email === me && <span className="text-gray-500 text-xs">(you)</span>}</p>
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    {humanize(u.role)}
                    {u.client_id ? ` · ${clients.find((c) => c.id === u.client_id)?.display_name ?? "Unknown client"}` : ""}
                    {` · added ${new Date(u.created_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => toggleActive(u)}
                  disabled={u.email === me}
                  title={u.email === me ? "You cannot deactivate your own account" : ""}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${u.active ? "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30 hover:bg-green-500/20 hover:text-green-400"}`}
                >
                  {u.active ? "active — click to deactivate" : "inactive — click to activate"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

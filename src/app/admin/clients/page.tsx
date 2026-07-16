"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";

export default function AdminClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [pipelinesByClient, setPipelinesByClient] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    try {
      const d = await fetch("/api/admin/clients").then((r) => r.json());
      const list = d.clients || [];
      setClients(list);
      // Resolve each client's pipeline names for the row subtitle (never raw ids).
      const entries = await Promise.all(
        list.map(async (c: any) => {
          try {
            const p = await fetch(`/api/admin/clients/${c.id}/pipelines`).then((r) => r.json());
            return [c.id, (p.pipelines ?? []).filter((x: any) => x.active).map((x: any) => x.name)] as const;
          } catch {
            return [c.id, []] as const;
          }
        })
      );
      setPipelinesByClient(Object.fromEntries(entries));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-extrabold text-white">Clients</h1>
        <Link
          href="/admin/clients/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all"
        >
          <Plus size={18} /> New Client
        </Link>
      </div>

      <div className="glass-card p-6">
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-primary" size={28} /></div>
        ) : clients.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No clients yet. Create the first one above.</p>
        ) : (
          <div className="space-y-3">
            {clients.map((c) => {
              const names = pipelinesByClient[c.id] ?? [];
              return (
                <Link
                  key={c.id}
                  href={`/admin/clients/${c.id}`}
                  className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-indigo-950/30 border-gray-700 hover:border-gray-500 transition-all"
                >
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">{c.display_name}</p>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {names.length > 0 ? names.join(" · ") : "No active pipelines"}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${c.active ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
                    {c.active ? "Active" : "Inactive"}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

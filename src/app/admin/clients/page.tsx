"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Copy } from "lucide-react";

export default function AdminClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [checklist, setChecklist] = useState<string[] | null>(null);

  const load = () =>
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []))
      .finally(() => setIsLoading(false));

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    if (!newId || !newName) return alert("id and display name are required");
    setIsCreating(true);
    setChecklist(null);
    try {
      let res;
      if (cloneFrom) {
        res = await fetch("/api/admin/clients/clone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: cloneFrom, newId, displayName: newName }),
        });
      } else {
        res = await fetch("/api/admin/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: newId, display_name: newName }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.checklist) setChecklist(data.checklist);
      setShowNew(false);
      setNewId("");
      setNewName("");
      setCloneFrom("");
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold text-white">Clients</h1>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all"
        >
          <Plus size={18} /> New Client
        </button>
      </div>

      {checklist && (
        <div className="glass-card p-6 border border-amber-500/40">
          <h3 className="text-amber-300 font-bold mb-3">Client created — onboarding checklist:</h3>
          <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1">
            {checklist.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {showNew && (
        <div className="glass-card p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Slug (id)</label>
              <input
                value={newId}
                onChange={(e) => setNewId(e.target.value.toLowerCase())}
                placeholder="e.g. meera"
                className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Display Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Dr. Meera Shah"
                className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Clone From (recommended)</label>
              <select
                value={cloneFrom}
                onChange={(e) => setCloneFrom(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— blank client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.display_name}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all disabled:opacity-50"
          >
            {isCreating ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
            {cloneFrom ? `Clone ${cloneFrom} → ${newId || "…"}` : "Create blank client"}
          </button>
          <p className="text-xs text-gray-500">New clients start <strong>inactive</strong> — they don&apos;t appear in the Studio picker until activated in settings.</p>
        </div>
      )}

      <div className="glass-card p-6">
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-primary" size={28} /></div>
        ) : (
          <div className="space-y-3">
            {clients.map((c) => (
              <Link
                key={c.id}
                href={`/admin/clients/${c.id}`}
                className="flex items-center justify-between gap-4 p-4 rounded-xl border bg-indigo-950/30 border-gray-700 hover:border-gray-500 transition-all"
              >
                <div>
                  <p className="text-white font-semibold">{c.display_name} <span className="text-gray-500 text-sm font-normal">({c.id})</span></p>
                  <p className="text-xs text-gray-500 mt-1 capitalize">{c.tier.replace(/_/g, " ")} · {c.content_type.replace(/_/g, " ")} · {c.locale_language}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${c.active ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
                  {c.active ? "active" : "inactive"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

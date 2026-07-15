"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Save, Plus, Trash2, AlertTriangle } from "lucide-react";

// Field groups for the settings form. Selects get options from /api/admin/providers.
const FIELD_GROUPS: { title: string; fields: { key: string; label: string; kind: "text" | "number" | "select" | "toggle"; options?: string }[] }[] = [
  {
    title: "Identity & Product",
    fields: [
      { key: "display_name", label: "Display Name", kind: "text" },
      { key: "content_type", label: "Content Type", kind: "select", options: "contentTypes" },
      { key: "script_mode", label: "Script Mode", kind: "select", options: "scriptModes" },
      { key: "tier", label: "Tier", kind: "select", options: "tiers" },
      { key: "active", label: "Active (visible in Studio)", kind: "toggle" },
    ],
  },
  {
    title: "Locale & Pacing",
    fields: [
      { key: "locale_language", label: "Language (e.g. hinglish, english)", kind: "text" },
      { key: "locale_region", label: "Region code (e.g. IN)", kind: "text" },
      { key: "speech_words_per_sec", label: "Speech words / sec", kind: "number" },
    ],
  },
  {
    title: "Script Engine (LLM)",
    fields: [
      { key: "script_provider", label: "Provider", kind: "select", options: "script" },
      { key: "model_script", label: "Creative model", kind: "text" },
      { key: "model_structured", label: "Structured/JSON model", kind: "text" },
      { key: "model_fallback", label: "Fallback model", kind: "text" },
    ],
  },
  {
    title: "Voice (TTS)",
    fields: [
      { key: "voice_provider", label: "Provider", kind: "select", options: "voice" },
      { key: "voice_id", label: "Voice ID (vendor)", kind: "text" },
      { key: "voice_model_id", label: "Voice model", kind: "text" },
      { key: "voice_stability", label: "Stability (0-1)", kind: "number" },
    ],
  },
  {
    title: "Avatar / Visual / Storage",
    fields: [
      { key: "avatar_provider", label: "Avatar provider", kind: "select", options: "avatar" },
      { key: "visual_provider", label: "Visual provider", kind: "select", options: "visual" },
      { key: "visual_style_preset", label: "Visual style preset", kind: "text" },
      { key: "storage_provider", label: "Storage provider", kind: "select", options: "storage" },
      { key: "storage_folder_prefix", label: "Storage folder prefix", kind: "text" },
    ],
  },
];

const KB_DOC_KEYS = [
  { key: "research", label: "Research Doc" },
  { key: "voice", label: "Voice Prompt" },
  { key: "creative_director", label: "Creative Director" },
  { key: "past_content", label: "Past Content" },
];

export default function AdminClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tab, setTab] = useState<"settings" | "avatars" | "templates" | "kb">("settings");
  const [client, setClient] = useState<any>(null);
  const [avatars, setAvatars] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [providers, setProviders] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // KB editor state
  const [kbDoc, setKbDoc] = useState("research");
  const [kbContent, setKbContent] = useState("");
  const [kbPath, setKbPath] = useState("");
  const [kbLoading, setKbLoading] = useState(false);
  const [kbSaving, setKbSaving] = useState(false);

  const load = async () => {
    const [detail, prov] = await Promise.all([
      fetch(`/api/admin/clients/${id}`).then((r) => r.json()),
      fetch(`/api/admin/providers`).then((r) => r.json()),
    ]);
    if (detail.error) return alert(detail.error);
    setClient(detail.client);
    setAvatars(detail.avatars);
    setTemplates(detail.templates);
    setProviders(prov);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (tab !== "kb") return;
    setKbLoading(true);
    fetch(`/api/admin/clients/${id}/kb?doc=${kbDoc}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setKbContent(d.content);
        setKbPath(d.path);
      })
      .catch((e) => alert(e.message))
      .finally(() => setKbLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, kbDoc, id]);

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(client),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setClient(data.client);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const saveKb = async () => {
    setKbSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${id}/kb`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: kbDoc, content: kbContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`Saved. Live at ${data.path} (takes effect within ~60s). Backup: ${data.backupPath}`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setKbSaving(false);
    }
  };

  // --- Avatars / templates row helpers -------------------------------------
  const upsertRow = async (kind: "avatars" | "templates", row: any) => {
    const isNew = !row.id;
    const res = await fetch(`/api/admin/clients/${id}/${kind}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
  };

  const deleteRow = async (kind: "avatars" | "templates", rowId: string) => {
    if (!confirm("Delete this row?")) return;
    const res = await fetch(`/api/admin/clients/${id}/${kind}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rowId }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await load();
  };

  if (!client || !providers) {
    return <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  }

  const selectOptions = (key?: string): string[] => (key && providers[key]) || [];
  const templateLabelWarnings = templates.filter((t) => kbDoc === "research" && kbContent && !kbContent.includes(t.label)).map((t) => t.label);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/clients" className="text-sm text-gray-500 hover:text-gray-300">← Clients</Link>
          <h1 className="text-3xl font-extrabold text-white mt-1">{client.display_name} <span className="text-gray-500 text-lg font-normal">({client.id})</span></h1>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${client.active ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
          {client.active ? "active" : "inactive"}
        </span>
      </div>

      <div className="flex gap-2 border-b border-gray-800">
        {(["settings", "avatars", "templates", "kb"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px ${tab === t ? "text-primary border-primary" : "text-gray-400 border-transparent hover:text-white"}`}
          >
            {t === "kb" ? "Knowledge Base" : t}
          </button>
        ))}
      </div>

      {/* SETTINGS */}
      {tab === "settings" && (
        <div className="space-y-6">
          {FIELD_GROUPS.map((group) => (
            <div key={group.title} className="glass-card p-6">
              <h3 className="text-white font-bold mb-4">{group.title}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {group.fields.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2">{f.label}</label>
                    {f.kind === "toggle" ? (
                      <button
                        onClick={() => setClient({ ...client, [f.key]: !client[f.key] })}
                        className={`w-full px-3 py-2 rounded-lg border font-semibold text-sm transition-all ${client[f.key] ? "bg-green-500/20 text-green-400 border-green-500/40" : "bg-gray-800/40 text-gray-400 border-gray-700"}`}
                      >
                        {client[f.key] ? "ON" : "OFF"}
                      </button>
                    ) : f.kind === "select" ? (
                      <select
                        value={client[f.key] ?? ""}
                        onChange={(e) => setClient({ ...client, [f.key]: e.target.value })}
                        className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
                      >
                        {selectOptions(f.options).map((o: string) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.kind === "number" ? "number" : "text"}
                        step="any"
                        value={client[f.key] ?? ""}
                        onChange={(e) => setClient({ ...client, [f.key]: f.kind === "number" ? parseFloat(e.target.value) : e.target.value })}
                        className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-4">
            <button
              onClick={saveSettings}
              disabled={isSaving}
              className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Settings
            </button>
            {savedAt && <span className="text-sm text-green-400">Saved at {savedAt} — live within ~60s.</span>}
          </div>
        </div>
      )}

      {/* AVATARS */}
      {tab === "avatars" && (
        <RowEditor
          kind="avatars"
          rows={avatars}
          columns={[
            { key: "label", label: "Label" },
            { key: "avatar_id", label: "Vendor Avatar ID" },
            { key: "preview_image_url", label: "Preview Image URL" },
            { key: "sort_order", label: "Sort", number: true },
          ]}
          onSave={(row) => upsertRow("avatars", row)}
          onDelete={(rowId) => deleteRow("avatars", rowId)}
          hint="0 rows = the avatar stage is skipped for this client. 'REPLACE_ME' IDs must be replaced before activation."
        />
      )}

      {/* TEMPLATES */}
      {tab === "templates" && (
        <RowEditor
          kind="templates"
          rows={templates}
          columns={[
            { key: "label", label: "Label (must match research doc)" },
            { key: "description", label: "Description" },
            { key: "preview_video_url", label: "Preview Video URL" },
            { key: "sort_order", label: "Sort", number: true },
          ]}
          onSave={(row) => upsertRow("templates", row)}
          onDelete={(rowId) => deleteRow("templates", rowId)}
          hint="Template labels are matched BY NAME against the client's research doc — keep them identical."
        />
      )}

      {/* KNOWLEDGE BASE */}
      {tab === "kb" && (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2">
              {KB_DOC_KEYS.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setKbDoc(d.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${kbDoc === d.key ? "bg-primary/20 text-primary border-primary/50" : "bg-gray-800/40 text-gray-400 border-gray-700"}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500 font-mono">{kbPath}</span>
          </div>

          {kbDoc === "research" && templateLabelWarnings.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>These template labels don&apos;t appear in this research doc: <strong>{templateLabelWarnings.join(", ")}</strong>. The AI matches templates by name.</span>
            </div>
          )}

          {kbLoading ? (
            <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-primary" size={28} /></div>
          ) : (
            <textarea
              value={kbContent}
              onChange={(e) => setKbContent(e.target.value)}
              className="w-full h-[500px] p-4 bg-black/50 border border-gray-700 rounded-lg text-gray-200 font-mono text-sm outline-none focus:ring-1 focus:ring-primary leading-relaxed"
              placeholder="(empty — saving will create this doc)"
            />
          )}

          <button
            onClick={saveKb}
            disabled={kbSaving || kbLoading}
            className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all disabled:opacity-50"
          >
            {kbSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Doc (goes live ≤60s)
          </button>
        </div>
      )}
    </div>
  );
}

// Inline row editor shared by avatars + templates tabs.
function RowEditor({ rows, columns, onSave, onDelete, hint }: {
  kind: string;
  rows: any[];
  columns: { key: string; label: string; number?: boolean }[];
  onSave: (row: any) => Promise<void> | void;
  onDelete: (rowId: string) => Promise<void> | void;
  hint: string;
}) {
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [newRow, setNewRow] = useState<any>({});

  const draftFor = (row: any) => drafts[row.id] ?? row;
  const setDraft = (row: any, key: string, value: any) =>
    setDrafts({ ...drafts, [row.id]: { ...draftFor(row), [key]: value } });

  return (
    <div className="glass-card p-6 space-y-4">
      <p className="text-xs text-gray-500">{hint}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase">
              {columns.map((c) => <th key={c.key} className="pb-3 pr-4">{c.label}</th>)}
              <th className="pb-3 w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-gray-800">
                {columns.map((c) => (
                  <td key={c.key} className="py-2 pr-4">
                    <input
                      type={c.number ? "number" : "text"}
                      value={draftFor(row)[c.key] ?? ""}
                      onChange={(e) => setDraft(row, c.key, c.number ? parseInt(e.target.value) : e.target.value)}
                      className={`w-full px-2 py-1.5 bg-black/40 border rounded-md text-white outline-none focus:ring-1 focus:ring-primary ${draftFor(row)[c.key] === "REPLACE_ME" ? "border-amber-500/60" : "border-gray-700"}`}
                    />
                  </td>
                ))}
                <td className="py-2 flex gap-2">
                  <button onClick={() => onSave(draftFor(row))} className="p-2 bg-primary/20 text-primary rounded-md hover:bg-primary/30" title="Save row"><Save size={14} /></button>
                  <button onClick={() => onDelete(row.id)} className="p-2 bg-red-500/10 text-red-400 rounded-md hover:bg-red-500/20" title="Delete row"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {/* New row */}
            <tr className="border-t border-gray-800 bg-black/20">
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-4">
                  <input
                    type={c.number ? "number" : "text"}
                    placeholder={c.label}
                    value={newRow[c.key] ?? ""}
                    onChange={(e) => setNewRow({ ...newRow, [c.key]: c.number ? parseInt(e.target.value) : e.target.value })}
                    className="w-full px-2 py-1.5 bg-black/40 border border-gray-700 border-dashed rounded-md text-white outline-none focus:ring-1 focus:ring-primary"
                  />
                </td>
              ))}
              <td className="py-2">
                <button
                  onClick={async () => { await onSave(newRow); setNewRow({}); }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-md text-xs font-bold hover:bg-primary-hover"
                >
                  <Plus size={14} /> Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

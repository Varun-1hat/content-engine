"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Save, Plus, Trash2, AlertTriangle, Upload, Check, Package } from "lucide-react";
import { CANONICAL_STAGES, STAGE_INFO, PIPELINE_PRESETS, validate, normalizeStages } from "@/lib/pipeline/stages";
import { providerLabel } from "@/lib/labels";

// Field groups for the settings form. Which pipeline stages a client runs is
// configured on the Pipelines tab — not here.
const FIELD_GROUPS: { title: string; fields: { key: string; label: string; kind: "text" | "number" | "select" | "toggle"; options?: string }[] }[] = [
  {
    title: "Identity",
    fields: [
      { key: "display_name", label: "Display Name", kind: "text" },
      { key: "active", label: "Active (visible in Studio)", kind: "toggle" },
    ],
  },
  {
    title: "Locale & Pacing",
    fields: [
      { key: "locale_language", label: "Language (e.g. hinglish, english)", kind: "text" },
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

interface Draft {
  id?: string;
  name: string;
  enabled_stages: string[];
  product_input: boolean;
  duration_min_sec: number;
  duration_max_sec: number;
  duration_default_sec: number;
  active: boolean;
}

export default function AdminClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tab, setTab] = useState<"settings" | "pipelines" | "avatars" | "templates" | "kb">("settings");
  const [client, setClient] = useState<any>(null);
  const [avatars, setAvatars] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [providers, setProviders] = useState<any>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // KB editor state
  const [kbDoc, setKbDoc] = useState("research");
  const [kbContent, setKbContent] = useState("");
  const [kbPath, setKbPath] = useState("");
  const [kbLoading, setKbLoading] = useState(false);
  const [kbSaving, setKbSaving] = useState(false);

  const load = async () => {
    const [detail, prov, ready] = await Promise.all([
      fetch(`/api/admin/clients/${id}`).then((r) => r.json()),
      fetch(`/api/admin/providers`).then((r) => r.json()),
      fetch(`/api/admin/clients/${id}/readiness`).then((r) => r.json()).catch(() => null),
    ]);
    if (detail.error) return alert(detail.error);
    setClient(detail.client);
    setAvatars(detail.avatars);
    setTemplates(detail.templates);
    setDrafts(
      (detail.pipelines ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        enabled_stages: p.enabled_stages ?? [],
        product_input: p.product_input,
        duration_min_sec: p.duration_min_sec,
        duration_max_sec: p.duration_max_sec,
        duration_default_sec: p.duration_default_sec,
        active: p.active,
      }))
    );
    setProviders(prov);
    setReadiness(ready);
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
      load();
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
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setKbSaving(false);
    }
  };

  // --- Pipelines -----------------------------------------------------------
  const addPreset = (key: string) => {
    const preset = PIPELINE_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    let name = preset.label;
    let n = 2;
    while (drafts.some((d) => d.name === name)) name = `${preset.label} ${n++}`;
    setDrafts([...drafts, {
      name, enabled_stages: [...preset.stages], product_input: preset.productInput,
      duration_min_sec: 15, duration_max_sec: 90, duration_default_sec: 45, active: true,
    }]);
  };

  const updateDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const toggleStage = (i: number, stage: string) => {
    const d = drafts[i];
    const next = d.enabled_stages.includes(stage)
      ? d.enabled_stages.filter((s) => s !== stage)
      : [...d.enabled_stages, stage];
    updateDraft(i, { enabled_stages: normalizeStages(next) });
  };

  const removeDraft = async (i: number) => {
    const d = drafts[i];
    if (d.id) {
      if (!confirm(`Delete pipeline "${d.name}"?`)) return;
      const res = await fetch(`/api/admin/clients/${id}/pipelines`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error);
    }
    setDrafts(drafts.filter((_, j) => j !== i));
    load();
  };

  const savePipelines = async () => {
    for (const d of drafts) {
      const errs = validate(d.enabled_stages);
      if (errs.length) return alert(`Pipeline "${d.name}": ${errs.join(" ")}`);
    }
    setIsSaving(true);
    try {
      for (const [i, d] of drafts.entries()) {
        const body = { ...d, sort_order: i };
        const res = await fetch(`/api/admin/clients/${id}/pipelines`, {
          method: d.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Avatars / templates -------------------------------------------------
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

  const uploadAsset = async (kind: "avatar_preview" | "template_preview", file: File): Promise<string | null> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("clientId", id);
    fd.append("kind", kind);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return null; }
    return data.url;
  };

  if (!client || !providers) {
    return <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  }

  const selectOptions = (key?: string): string[] => (key && providers[key]) || [];
  const templateLabelWarnings = templates.filter((t) => kbDoc === "research" && kbContent && !kbContent.includes(t.label)).map((t) => t.label);
  const issueCount = (readiness?.errors?.length ?? 0) + (readiness?.warnings?.length ?? 0);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Link href="/admin/clients" className="text-sm text-gray-500 hover:text-gray-300">← Clients</Link>
          <h1 className="text-3xl font-extrabold text-white mt-1 truncate">{client.display_name}</h1>
          <p className="text-xs text-gray-500 mt-1">{drafts.filter((d) => d.active).map((d) => d.name).join(" · ") || "No active pipelines"}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold border shrink-0 ${client.active ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
          {client.active ? "Active" : "Inactive"}
        </span>
      </div>

      {/* Readiness */}
      {readiness && issueCount > 0 && (
        <div className="glass-card p-4 border border-amber-500/30 space-y-2">
          {readiness.errors?.map((e: string, i: number) => (
            <p key={`e${i}`} className="text-sm text-red-300 flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{e}</p>
          ))}
          {readiness.warnings?.map((w: string, i: number) => (
            <p key={`w${i}`} className="text-sm text-amber-300 flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{w}</p>
          ))}
        </div>
      )}
      {readiness && issueCount === 0 && (
        <p className="text-sm text-green-400 flex items-center gap-2"><Check size={14} /> Ready — no configuration issues.</p>
      )}

      <div className="flex gap-2 border-b border-gray-800 overflow-x-auto">
        {(["settings", "pipelines", "avatars", "templates", "kb"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px whitespace-nowrap ${tab === t ? "text-primary border-primary" : "text-gray-400 border-transparent hover:text-white"}`}
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
                          <option key={o} value={o}>{providerLabel(o)}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.kind === "number" ? "number" : "text"}
                        step="any"
                        value={client[f.key] ?? ""}
                        onChange={(e) => {
                          // Empty number input must clear the field, not write NaN.
                          if (f.kind === "number") {
                            const raw = e.target.value;
                            if (raw === "") return setClient({ ...client, [f.key]: null });
                            const n = parseFloat(raw);
                            if (Number.isNaN(n)) return;
                            return setClient({ ...client, [f.key]: n });
                          }
                          setClient({ ...client, [f.key]: e.target.value });
                        }}
                        className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-4 flex-wrap">
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

      {/* PIPELINES */}
      {tab === "pipelines" && (
        <div className="space-y-5">
          <div className="glass-card p-6">
            <h3 className="text-white font-bold mb-1">Add a pipeline</h3>
            <p className="text-xs text-gray-500 mb-4">Each pipeline is one reel variant this client can order. Stage toggles decide what runs.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PIPELINE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => addPreset(p.key)}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-700 bg-indigo-950/30 hover:border-primary/60 transition-all text-left"
                >
                  <span className="text-sm text-gray-200">{p.label}</span>
                  <Plus size={16} className="text-primary shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {drafts.length === 0 && <p className="text-gray-500 text-sm">No pipelines yet — add one above.</p>}

          {drafts.map((d, i) => {
            const errs = validate(d.enabled_stages);
            return (
              <div key={d.id ?? `new-${i}`} className="glass-card p-6 space-y-4">
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="flex-1 min-w-[12rem]">
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Pipeline name</label>
                    <input
                      value={d.name}
                      onChange={(e) => updateDraft(i, { name: e.target.value })}
                      placeholder="e.g. Full Reel, Product Ad"
                      className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white font-semibold outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Shown to the client when they pick a pipeline for a reel.</p>
                  </div>
                  <button
                    onClick={() => updateDraft(i, { active: !d.active })}
                    title={d.active ? "Offered in the Studio pipeline picker — click to retire it" : "Hidden from the Studio picker — click to offer it"}
                    className={`px-3 py-2 rounded-lg border font-semibold text-xs ${d.active ? "bg-green-500/20 text-green-400 border-green-500/40" : "bg-gray-800/40 text-gray-400 border-gray-700"}`}
                  >
                    {d.active ? "Active" : "Inactive"}
                  </button>
                  <button onClick={() => removeDraft(i)} className="p-2 bg-red-500/10 text-red-400 rounded-md hover:bg-red-500/20">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Stages</label>
                  <div className="flex flex-wrap gap-2">
                    {CANONICAL_STAGES.map((s) => (
                      <button
                        key={s}
                        onClick={() => toggleStage(i, s)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${d.enabled_stages.includes(s) ? "bg-primary/20 text-primary border-primary/50" : "bg-gray-800/40 text-gray-500 border-gray-700"}`}
                      >
                        {STAGE_INFO[s].label}
                      </button>
                    ))}
                  </div>
                </div>

                {errs.length > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-xs text-red-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{errs.join(" ")}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4">
                  <p className="text-white font-semibold text-sm flex items-center gap-2"><Package size={14} className="text-amber-300" /> Takes product photos (per reel)</p>
                  <button
                    onClick={() => updateDraft(i, { product_input: !d.product_input })}
                    className={`shrink-0 px-4 py-2 rounded-lg border font-semibold text-sm ${d.product_input ? "bg-green-500/20 text-green-400 border-green-500/40" : "bg-gray-800/40 text-gray-400 border-gray-700"}`}
                  >
                    {d.product_input ? "ON" : "OFF"}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {(["duration_min_sec", "duration_default_sec", "duration_max_sec"] as const).map((k) => (
                    <div key={k}>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">{k.replace("duration_", "").replace("_sec", "")} (s)</label>
                      <input
                        type="number"
                        value={d[k]}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") return;
                          const n = parseInt(raw);
                          if (Number.isNaN(n)) return;
                          updateDraft(i, { [k]: n } as any);
                        }}
                        className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {drafts.length > 0 && (
            <div className="flex items-center gap-4 flex-wrap">
              <button
                onClick={savePipelines}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Pipelines
              </button>
              {savedAt && <span className="text-sm text-green-400">Saved at {savedAt}</span>}
            </div>
          )}
        </div>
      )}

      {/* AVATARS */}
      {tab === "avatars" && (
        <RowEditor
          rows={avatars}
          columns={[
            { key: "label", label: "Label" },
            { key: "avatar_id", label: "Vendor Avatar ID" },
            { key: "sort_order", label: "Sort", number: true },
          ]}
          previewKey="preview_image_url"
          uploadKind="avatar_preview"
          onUpload={uploadAsset}
          onSave={(row) => upsertRow("avatars", row)}
          onDelete={(rowId) => deleteRow("avatars", rowId)}
          hint="0 rows = the avatar stage can't run for this client. 'REPLACE_ME' IDs must be replaced before activation."
        />
      )}

      {/* TEMPLATES */}
      {tab === "templates" && (
        <RowEditor
          rows={templates}
          columns={[
            { key: "label", label: "Label (must match research doc)" },
            { key: "description", label: "Description" },
            { key: "sort_order", label: "Sort", number: true },
          ]}
          previewKey="preview_video_url"
          uploadKind="template_preview"
          onUpload={uploadAsset}
          onSave={(row) => upsertRow("templates", row)}
          onDelete={(rowId) => deleteRow("templates", rowId)}
          hint="Template labels are matched BY NAME against the client's research doc — keep them identical."
        />
      )}

      {/* KNOWLEDGE BASE */}
      {tab === "kb" && (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2 flex-wrap">
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
            <span className="text-xs text-gray-500 font-mono truncate max-w-full">{kbPath}</span>
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

// Inline row editor shared by the avatars + templates tabs.
function RowEditor({ rows, columns, previewKey, uploadKind, onUpload, onSave, onDelete, hint }: {
  rows: any[];
  columns: { key: string; label: string; number?: boolean }[];
  previewKey: string;
  uploadKind: "avatar_preview" | "template_preview";
  onUpload: (kind: "avatar_preview" | "template_preview", file: File) => Promise<string | null>;
  onSave: (row: any) => Promise<void> | void;
  onDelete: (rowId: string) => Promise<void> | void;
  hint: string;
}) {
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [newRow, setNewRow] = useState<any>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const draftFor = (row: any) => drafts[row.id] ?? row;
  const setDraft = (row: any, key: string, value: any) =>
    setDrafts({ ...drafts, [row.id]: { ...draftFor(row), [key]: value } });

  const numberValue = (raw: string): number | null => {
    if (raw === "") return null;
    const n = parseInt(raw);
    return Number.isNaN(n) ? null : n;
  };

  const handleUpload = async (rowKey: string, file: File, apply: (url: string) => void) => {
    setUploading(rowKey);
    const url = await onUpload(uploadKind, file);
    if (url) apply(url);
    setUploading(null);
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <p className="text-xs text-gray-500">{hint}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase">
              {columns.map((c) => <th key={c.key} className="pb-3 pr-4 whitespace-nowrap">{c.label}</th>)}
              <th className="pb-3 pr-4">Preview</th>
              <th className="pb-3 w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-gray-800">
                {columns.map((c) => (
                  <td key={c.key} className="py-2 pr-4 align-middle">
                    <input
                      type={c.number ? "number" : "text"}
                      value={draftFor(row)[c.key] ?? ""}
                      onChange={(e) => setDraft(row, c.key, c.number ? numberValue(e.target.value) : e.target.value)}
                      className={`w-full px-2 py-1.5 bg-black/40 border rounded-md text-white outline-none focus:ring-1 focus:ring-primary ${draftFor(row)[c.key] === "REPLACE_ME" ? "border-amber-500/60" : "border-gray-700"}`}
                    />
                  </td>
                ))}
                <td className="py-2 pr-4 align-middle">
                  <label className="inline-flex items-center gap-1.5 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap">
                    {uploading === row.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {draftFor(row)[previewKey] ? "Replace" : "Upload"}
                    <input
                      type="file"
                      className="hidden"
                      accept={uploadKind === "avatar_preview" ? "image/*" : "video/*"}
                      onChange={(e) => e.target.files?.[0] && handleUpload(row.id, e.target.files[0], (url) => setDraft(row, previewKey, url))}
                    />
                  </label>
                </td>
                <td className="py-2 align-middle">
                  {/* flex lives on an inner div — a flex <td> collapses the row */}
                  <div className="flex gap-2">
                    <button onClick={() => onSave(draftFor(row))} className="p-2 bg-primary/20 text-primary rounded-md hover:bg-primary/30" title="Save row"><Save size={14} /></button>
                    <button onClick={() => onDelete(row.id)} className="p-2 bg-red-500/10 text-red-400 rounded-md hover:bg-red-500/20" title="Delete row"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {/* New row */}
            <tr className="border-t border-gray-800 bg-black/20">
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-4 align-middle">
                  <input
                    type={c.number ? "number" : "text"}
                    placeholder={c.label}
                    value={newRow[c.key] ?? ""}
                    onChange={(e) => setNewRow({ ...newRow, [c.key]: c.number ? numberValue(e.target.value) : e.target.value })}
                    className="w-full px-2 py-1.5 bg-black/40 border border-gray-700 border-dashed rounded-md text-white outline-none focus:ring-1 focus:ring-primary"
                  />
                </td>
              ))}
              <td className="py-2 pr-4 align-middle text-xs text-gray-600">after adding</td>
              <td className="py-2 align-middle">
                <button
                  onClick={async () => { await onSave(newRow); setNewRow({}); }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-md text-xs font-bold hover:bg-primary-hover whitespace-nowrap"
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight, ArrowLeft, Plus, Trash2, Upload, Check, AlertTriangle, Package } from "lucide-react";
import { CANONICAL_STAGES, STAGE_INFO, PIPELINE_PRESETS, validate, normalizeStages } from "@/lib/pipeline/stages";
import { providerLabel } from "@/lib/labels";

// Guided onboarding. Each step persists on Next, so the client exists from step 1
// and a half-finished onboarding can be resumed from the client detail page.
// Only the sections the chosen pipelines actually need are shown.

interface Draft {
  id?: string;              // set once saved
  name: string;
  enabled_stages: string[];
  product_input: boolean;
  duration_min_sec: number;
  duration_max_sec: number;
  duration_default_sec: number;
}

const STEPS = ["Basics", "Pipelines", "Stage config", "Assets", "Knowledge Base", "Review"];

const KB_DOC_KEYS = [
  { key: "research", label: "Research Doc", needs: (s: Set<string>) => s.has("topic") || s.has("script") },
  { key: "voice", label: "Voice Prompt", needs: (s: Set<string>) => s.has("adapt_voice") || s.has("audio") },
  { key: "creative_director", label: "Creative Director", needs: (s: Set<string>) => s.has("broll_plan") },
  { key: "past_content", label: "Past Content", needs: (s: Set<string>) => s.has("topic") },
];

export default function NewClientWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<any>(null);

  // Step 1
  const [displayName, setDisplayName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [language, setLanguage] = useState("english");
  const [wps, setWps] = useState("2.5");
  const [allClients, setAllClients] = useState<any[]>([]);

  // Created client
  const [clientId, setClientId] = useState<string | null>(null);
  const [client, setClient] = useState<any>(null);

  // Step 2
  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Step 4
  const [avatars, setAvatars] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);

  // Step 5
  const [kbDoc, setKbDoc] = useState("research");
  const [kbContent, setKbContent] = useState("");
  const [kbLoading, setKbLoading] = useState(false);

  // Step 6
  const [readiness, setReadiness] = useState<any>(null);

  useEffect(() => {
    fetch("/api/admin/providers").then((r) => r.json()).then(setProviders).catch(() => {});
    fetch("/api/admin/clients").then((r) => r.json()).then((d) => setAllClients(d.clients || [])).catch(() => {});
  }, []);

  const enabledUnion = new Set<string>(drafts.flatMap((d) => d.enabled_stages));

  const reloadDetail = async (id: string) => {
    const d = await fetch(`/api/admin/clients/${id}`).then((r) => r.json());
    if (d.error) throw new Error(d.error);
    setClient(d.client);
    setAvatars(d.avatars ?? []);
    setTemplates(d.templates ?? []);
    if (d.pipelines?.length) {
      setDrafts(
        d.pipelines.map((p: any) => ({
          id: p.id,
          name: p.name,
          enabled_stages: p.enabled_stages ?? [],
          product_input: p.product_input,
          duration_min_sec: p.duration_min_sec,
          duration_max_sec: p.duration_max_sec,
          duration_default_sec: p.duration_default_sec,
        }))
      );
    }
  };

  // ---- Step 1: create (blank or clone) -------------------------------------
  const submitBasics = async () => {
    if (!displayName.trim()) return alert("Display name is required.");
    setBusy(true);
    try {
      let id = clientId;
      if (!id) {
        const res = cloneFrom
          ? await fetch("/api/admin/clients/clone", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sourceId: cloneFrom, displayName }),
            })
          : await fetch("/api/admin/clients", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ display_name: displayName, locale_language: language, speech_words_per_sec: parseFloat(wps) || 2.5 }),
            });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        id = cloneFrom ? data.clientId : data.client.id;
        setClientId(id!);
      } else {
        const res = await fetch(`/api/admin/clients/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_name: displayName, locale_language: language, speech_words_per_sec: parseFloat(wps) || 2.5 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
      await reloadDetail(id!);
      setStep(2);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Step 2: pipelines ---------------------------------------------------
  const addPreset = (key: string) => {
    const preset = PIPELINE_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    let name = preset.label;
    let n = 2;
    while (drafts.some((d) => d.name === name)) name = `${preset.label} ${n++}`;
    setDrafts([
      ...drafts,
      {
        name,
        enabled_stages: [...preset.stages],
        product_input: preset.productInput,
        duration_min_sec: 15,
        duration_max_sec: 90,
        duration_default_sec: 45,
      },
    ]);
  };

  const updateDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const toggleStage = (i: number, stage: string) => {
    const d = drafts[i];
    const has = d.enabled_stages.includes(stage);
    const next = has ? d.enabled_stages.filter((s) => s !== stage) : [...d.enabled_stages, stage];
    updateDraft(i, { enabled_stages: normalizeStages(next) });
  };

  const removeDraft = async (i: number) => {
    const d = drafts[i];
    if (d.id && clientId) {
      await fetch(`/api/admin/clients/${clientId}/pipelines`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id }),
      });
    }
    setDrafts(drafts.filter((_, j) => j !== i));
  };

  const savePipelines = async () => {
    if (!clientId) return;
    if (drafts.length === 0) return alert("Add at least one pipeline.");
    for (const d of drafts) {
      const errs = validate(d.enabled_stages);
      if (errs.length) return alert(`Pipeline "${d.name}": ${errs.join(" ")}`);
    }
    setBusy(true);
    try {
      for (const [i, d] of drafts.entries()) {
        const body = { ...d, sort_order: i };
        const res = d.id
          ? await fetch(`/api/admin/clients/${clientId}/pipelines`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          : await fetch(`/api/admin/clients/${clientId}/pipelines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (!d.id) d.id = data.pipeline.id;
      }
      setDrafts([...drafts]);
      setStep(3);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Step 3: stage config ------------------------------------------------
  const saveSettings = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(client),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setClient(data.client);
      setStep(4);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Step 4: assets ------------------------------------------------------
  const upsertRow = async (kind: "avatars" | "templates", row: any) => {
    if (!clientId) return;
    const res = await fetch(`/api/admin/clients/${clientId}/${kind}`, {
      method: row.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    await reloadDetail(clientId);
  };

  const deleteRow = async (kind: "avatars" | "templates", id: string) => {
    if (!clientId) return;
    await fetch(`/api/admin/clients/${clientId}/${kind}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await reloadDetail(clientId);
  };

  const uploadAsset = async (kind: "avatar_preview" | "template_preview", file: File): Promise<string | null> => {
    if (!clientId) return null;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("clientId", clientId);
    fd.append("kind", kind);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      return null;
    }
    return data.url;
  };

  // ---- Step 5: KB ----------------------------------------------------------
  useEffect(() => {
    if (step !== 5 || !clientId) return;
    setKbLoading(true);
    fetch(`/api/admin/clients/${clientId}/kb?doc=${kbDoc}`)
      .then((r) => r.json())
      .then((d) => setKbContent(d.error ? "" : d.content))
      .finally(() => setKbLoading(false));
  }, [step, kbDoc, clientId]);

  const saveKb = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/kb`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: kbDoc, content: kbContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert("Saved.");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Step 6: readiness ---------------------------------------------------
  const loadReadiness = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const d = await fetch(`/api/admin/clients/${clientId}/readiness`).then((r) => r.json());
      setReadiness(d);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (step === 6) loadReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const activate = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/admin/clients/${clientId}`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const selectOptions = (key: string): string[] => (providers?.[key] as string[]) ?? [];

  const STAGE_CONFIG_GROUPS: { title: string; show: boolean; fields: { key: string; label: string; kind: "text" | "number" | "select"; options?: string }[] }[] = [
    {
      title: "Script Engine (LLM)",
      show: ["topic", "script", "adapt_voice", "broll_plan"].some((s) => enabledUnion.has(s)),
      fields: [
        { key: "script_provider", label: "Provider", kind: "select", options: "script" },
        { key: "model_script", label: "Creative model", kind: "text" },
        { key: "model_structured", label: "Structured/JSON model", kind: "text" },
        { key: "model_fallback", label: "Fallback model", kind: "text" },
      ],
    },
    {
      title: "Voice (TTS)",
      show: enabledUnion.has("audio"),
      fields: [
        { key: "voice_provider", label: "Provider", kind: "select", options: "voice" },
        { key: "voice_id", label: "Voice ID (vendor)", kind: "text" },
        { key: "voice_model_id", label: "Voice model", kind: "text" },
        { key: "voice_stability", label: "Stability (0-1)", kind: "number" },
      ],
    },
    {
      title: "Avatar",
      show: enabledUnion.has("avatar"),
      fields: [{ key: "avatar_provider", label: "Avatar provider", kind: "select", options: "avatar" }],
    },
    {
      title: "Visual (B-roll / product shots)",
      show: enabledUnion.has("broll_plan") || enabledUnion.has("assemble"),
      fields: [
        { key: "visual_provider", label: "Visual provider", kind: "select", options: "visual" },
        { key: "visual_style_preset", label: "Visual style preset", kind: "text" },
      ],
    },
    {
      title: "Storage",
      show: true,
      fields: [
        { key: "storage_provider", label: "Storage provider", kind: "select", options: "storage" },
        { key: "storage_folder_prefix", label: "Storage folder prefix", kind: "text" },
      ],
    },
  ];

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <Link href="/admin/clients" className="text-sm text-gray-500 hover:text-gray-300">← Clients</Link>
        <h1 className="text-3xl font-extrabold text-white mt-1">New Client</h1>
      </div>

      {/* Stepper */}
      <div className="flex items-start justify-between gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 transition-all ${step > i + 1 ? "bg-green-600 text-white" : step === i + 1 ? "bg-primary text-white" : "bg-gray-800 text-gray-500 border border-gray-700"}`}>
              {step > i + 1 ? <Check size={14} /> : i + 1}
            </div>
            <span className={`text-[10px] sm:text-xs font-semibold text-center truncate max-w-full ${step === i + 1 ? "text-white" : "text-gray-600"}`}>{label}</span>
          </div>
        ))}
      </div>

      {/* STEP 1 — BASICS */}
      {step === 1 && (
        <div className="glass-card p-6 space-y-5">
          <h2 className="text-white font-bold text-lg">Basics</h2>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Display Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Dr. Meera Shah"
              className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs text-gray-500 mt-2">The internal id and storage folder are generated automatically.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Start from</label>
            <select
              value={cloneFrom}
              onChange={(e) => setCloneFrom(e.target.value)}
              disabled={!!clientId}
              className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
              <option value="">Blank client (nothing prefilled)</option>
              {allClients.map((c) => (
                <option key={c.id} value={c.id}>Clone from {c.display_name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">Cloning copies pipelines, templates, avatar labels and KB docs as a starting point. Vendor IDs are always cleared.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Language</label>
              <input
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="e.g. english, hinglish"
                className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Speech words / sec</label>
              <input
                type="number"
                step="any"
                value={wps}
                onChange={(e) => setWps(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <NextButton busy={busy} onClick={submitBasics} label={clientId ? "Save & continue" : "Create & continue"} />
        </div>
      )}

      {/* STEP 2 — PIPELINES */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="glass-card p-6">
            <h2 className="text-white font-bold text-lg mb-1">Pipelines</h2>
            <p className="text-gray-500 text-sm mb-4">A pipeline is one reel variant this client can order. Add as many as they subscribe to.</p>
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

          {drafts.map((d, i) => {
            const errs = validate(d.enabled_stages);
            return (
              <div key={i} className="glass-card p-6 space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Pipeline name</label>
                    <input
                      value={d.name}
                      onChange={(e) => updateDraft(i, { name: e.target.value })}
                      placeholder="e.g. Full Reel, Product Ad"
                      className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white font-semibold outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Shown to the client when they pick a pipeline for a reel.</p>
                  </div>
                  <button onClick={() => removeDraft(i)} className="p-2 bg-red-500/10 text-red-400 rounded-md hover:bg-red-500/20 shrink-0">
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
                  <div>
                    <p className="text-white font-semibold text-sm flex items-center gap-2"><Package size={14} className="text-amber-300" /> Takes product photos</p>
                    <p className="text-gray-500 text-xs mt-1">Reels on this pipeline ask for product photos at creation (uploaded per reel).</p>
                  </div>
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
                        onChange={(e) => updateDraft(i, { [k]: e.target.value === "" ? 0 : parseInt(e.target.value) } as any)}
                        className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex gap-3">
            <BackButton onClick={() => setStep(1)} />
            <NextButton busy={busy} onClick={savePipelines} label="Save & continue" />
          </div>
        </div>
      )}

      {/* STEP 3 — STAGE CONFIG */}
      {step === 3 && client && (
        <div className="space-y-5">
          <p className="text-gray-500 text-sm">Only the settings your chosen pipelines actually use are shown.</p>
          {STAGE_CONFIG_GROUPS.filter((g) => g.show).map((group) => (
            <div key={group.title} className="glass-card p-6">
              <h3 className="text-white font-bold mb-4">{group.title}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {group.fields.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2">{f.label}</label>
                    {f.kind === "select" ? (
                      <select
                        value={client[f.key] ?? ""}
                        onChange={(e) => setClient({ ...client, [f.key]: e.target.value })}
                        className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
                      >
                        {selectOptions(f.options!).map((o) => (
                          <option key={o} value={o}>{providerLabel(o)}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.kind === "number" ? "number" : "text"}
                        step="any"
                        value={client[f.key] ?? ""}
                        onChange={(e) => {
                          const v = f.kind === "number" ? (e.target.value === "" ? null : parseFloat(e.target.value)) : e.target.value;
                          if (f.kind === "number" && v !== null && Number.isNaN(v)) return;
                          setClient({ ...client, [f.key]: v });
                        }}
                        className="w-full px-3 py-2 bg-black/40 border border-gray-700 rounded-lg text-white outline-none focus:ring-1 focus:ring-primary"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-3">
            <BackButton onClick={() => setStep(2)} />
            <NextButton busy={busy} onClick={saveSettings} label="Save & continue" />
          </div>
        </div>
      )}

      {/* STEP 4 — ASSETS */}
      {step === 4 && (
        <div className="space-y-5">
          {enabledUnion.has("avatar") && (
            <AssetEditor
              title="Avatar looks"
              hint="One row per look. The vendor avatar id comes from HeyGen. 0 rows means the avatar stage can't run."
              rows={avatars}
              columns={[
                { key: "label", label: "Label" },
                { key: "avatar_id", label: "Vendor Avatar ID" },
              ]}
              previewKey="preview_image_url"
              uploadKind="avatar_preview"
              onUpload={uploadAsset}
              onSave={(row) => upsertRow("avatars", row)}
              onDelete={(id) => deleteRow("avatars", id)}
            />
          )}
          <AssetEditor
            title="Templates"
            hint="Labels are matched BY NAME against the research doc — keep them identical."
            rows={templates}
            columns={[
              { key: "label", label: "Label (must match research doc)" },
              { key: "description", label: "Description" },
            ]}
            previewKey="preview_video_url"
            uploadKind="template_preview"
            onUpload={uploadAsset}
            onSave={(row) => upsertRow("templates", row)}
            onDelete={(id) => deleteRow("templates", id)}
          />
          <div className="flex gap-3">
            <BackButton onClick={() => setStep(3)} />
            <NextButton busy={busy} onClick={() => setStep(5)} label="Continue" />
          </div>
        </div>
      )}

      {/* STEP 5 — KB */}
      {step === 5 && (
        <div className="space-y-5">
          <div className="glass-card p-6 space-y-4">
            <div className="flex gap-2 flex-wrap">
              {KB_DOC_KEYS.filter((d) => d.needs(enabledUnion)).map((d) => (
                <button
                  key={d.key}
                  onClick={() => setKbDoc(d.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${kbDoc === d.key ? "bg-primary/20 text-primary border-primary/50" : "bg-gray-800/40 text-gray-400 border-gray-700"}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {kbLoading ? (
              <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-primary" size={28} /></div>
            ) : (
              <textarea
                value={kbContent}
                onChange={(e) => setKbContent(e.target.value)}
                className="w-full h-[420px] p-4 bg-black/50 border border-gray-700 rounded-lg text-gray-200 font-mono text-sm outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                placeholder="(empty — saving will create this doc)"
              />
            )}
            <button
              onClick={saveKb}
              disabled={busy || kbLoading}
              className="px-6 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all disabled:opacity-50"
            >
              Save Doc
            </button>
          </div>
          <div className="flex gap-3">
            <BackButton onClick={() => setStep(4)} />
            <NextButton busy={busy} onClick={() => setStep(6)} label="Continue" />
          </div>
        </div>
      )}

      {/* STEP 6 — REVIEW */}
      {step === 6 && (
        <div className="space-y-5">
          <div className="glass-card p-6 space-y-4">
            <h2 className="text-white font-bold text-lg">Review &amp; activate</h2>
            {busy || !readiness ? (
              <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-primary" size={24} /></div>
            ) : (
              <>
                {readiness.errors?.length > 0 && (
                  <div className="p-4 bg-red-500/10 border border-red-500/40 rounded-lg space-y-1">
                    <p className="text-red-300 font-bold text-sm flex items-center gap-2"><AlertTriangle size={14} /> Must fix before activating</p>
                    <ul className="list-disc pl-5 text-sm text-red-200">
                      {readiness.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {readiness.warnings?.length > 0 && (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-lg space-y-1">
                    <p className="text-amber-300 font-bold text-sm flex items-center gap-2"><AlertTriangle size={14} /> Worth checking</p>
                    <ul className="list-disc pl-5 text-sm text-amber-200">
                      {readiness.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
                {readiness.errors?.length === 0 && readiness.warnings?.length === 0 && (
                  <p className="text-green-400 text-sm flex items-center gap-2"><Check size={16} /> Everything checks out.</p>
                )}
                <div className="flex gap-3 pt-2 flex-wrap">
                  <button onClick={loadReadiness} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-semibold">Re-check</button>
                  <button
                    onClick={activate}
                    disabled={busy || readiness.errors?.length > 0}
                    className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold disabled:opacity-40"
                  >
                    Activate client
                  </button>
                  {clientId && (
                    <Link href={`/admin/clients/${clientId}`} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-semibold">
                      Finish later
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
          <BackButton onClick={() => setStep(5)} />
        </div>
      )}
    </div>
  );
}

function NextButton({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all disabled:opacity-50"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} {label}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-bold transition-all">
      <ArrowLeft size={16} /> Back
    </button>
  );
}

function AssetEditor({
  title, hint, rows, columns, previewKey, uploadKind, onUpload, onSave, onDelete,
}: {
  title: string;
  hint: string;
  rows: any[];
  columns: { key: string; label: string }[];
  previewKey: string;
  uploadKind: "avatar_preview" | "template_preview";
  onUpload: (kind: "avatar_preview" | "template_preview", file: File) => Promise<string | null>;
  onSave: (row: any) => void;
  onDelete: (id: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [newRow, setNewRow] = useState<any>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const draftFor = (row: any) => drafts[row.id] ?? row;
  const setDraft = (row: any, key: string, value: any) =>
    setDrafts({ ...drafts, [row.id]: { ...draftFor(row), [key]: value } });

  const handleUpload = async (rowKey: string, file: File, apply: (url: string) => void) => {
    setUploading(rowKey);
    const url = await onUpload(uploadKind, file);
    if (url) apply(url);
    setUploading(null);
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <div>
        <h3 className="text-white font-bold">{title}</h3>
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="p-3 rounded-lg border border-gray-700 bg-black/20 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {columns.map((c) => (
                <input
                  key={c.key}
                  placeholder={c.label}
                  value={draftFor(row)[c.key] ?? ""}
                  onChange={(e) => setDraft(row, c.key, e.target.value)}
                  className={`w-full px-2 py-1.5 bg-black/40 border rounded-md text-white text-sm outline-none focus:ring-1 focus:ring-primary ${draftFor(row)[c.key] === "REPLACE_ME" ? "border-amber-500/60" : "border-gray-700"}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md text-xs font-semibold cursor-pointer">
                {uploading === row.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload preview
                <input
                  type="file"
                  className="hidden"
                  accept={uploadKind === "avatar_preview" ? "image/*" : "video/*"}
                  onChange={(e) => e.target.files?.[0] && handleUpload(row.id, e.target.files[0], (url) => setDraft(row, previewKey, url))}
                />
              </label>
              {draftFor(row)[previewKey] && <span className="text-[10px] text-green-400 truncate max-w-[12rem]">preview set</span>}
              <button onClick={() => onSave(draftFor(row))} className="px-3 py-1.5 bg-primary/20 text-primary rounded-md text-xs font-bold hover:bg-primary/30">Save</button>
              <button onClick={() => onDelete(row.id)} className="p-1.5 bg-red-500/10 text-red-400 rounded-md hover:bg-red-500/20"><Trash2 size={12} /></button>
            </div>
          </div>
        ))}

        <div className="p-3 rounded-lg border border-dashed border-gray-700 bg-black/10 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {columns.map((c) => (
              <input
                key={c.key}
                placeholder={c.label}
                value={newRow[c.key] ?? ""}
                onChange={(e) => setNewRow({ ...newRow, [c.key]: e.target.value })}
                className="w-full px-2 py-1.5 bg-black/40 border border-gray-700 rounded-md text-white text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            ))}
          </div>
          <button
            onClick={() => { onSave(newRow); setNewRow({}); }}
            className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-md text-xs font-bold hover:bg-primary-hover"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

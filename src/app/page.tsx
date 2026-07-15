"use client";

import { useState, useEffect } from "react";
import ScriptDisplay from "@/components/ScriptDisplay";
import { Sparkles, Loader2, UserCheck, ArrowRight, Edit3, Info, Video, Mic, Settings, Copy, History, Plus, LogOut } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// All client-specific data (templates, avatars, stage plan, duration bounds)
// comes from /api/clients/[id]/ui-config. Nothing client-specific is hardcoded.

interface UiTemplate { label: string; description: string | null; previewVideoUrl: string | null }
interface UiAvatar { label: string; previewImageUrl: string | null }
interface UiConfig {
  id: string;
  displayName: string;
  tier: string;
  contentType: string;
  localeLanguage: string;
  stagePlan: { name: string; label: string }[];
  templates: UiTemplate[];
  avatars: UiAvatar[];
  duration: { minSec: number; maxSec: number; defaultSec: number };
}

const BROLL_OPTIONS = ["Minimal", "Standard", "High"];

export default function Home() {
  // --- Client & job context ---
  const [clientList, setClientList] = useState<{ id: string; displayName: string }[]>([]);
  const [client, setClient] = useState<UiConfig | null>(null);
  const [isLoadingClient, setIsLoadingClient] = useState(false);
  const [recentJobs, setRecentJobs] = useState<any[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [inFlow, setInFlow] = useState(false);

  const [step, setStep] = useState<number>(1);

  // --- Topic selection ---
  const [topic, setTopic] = useState("");
  const [suggestedTopics, setSuggestedTopics] = useState<any[]>([]);
  const [isGeneratingTopics, setIsGeneratingTopics] = useState(false);

  // --- Script generation ---
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [englishScript, setEnglishScript] = useState("");
  const [targetDuration, setTargetDuration] = useState("45");
  const [revisionNotes, setRevisionNotes] = useState("");
  const [finalScript, setFinalScript] = useState<any>(null);

  // --- Confirm flow ---
  const [confirmedTopics, setConfirmedTopics] = useState<Record<string, boolean>>({});
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({});
  const [showTemplateDropdown, setShowTemplateDropdown] = useState<Record<string, boolean>>({});

  // --- Production choices ---
  const [selectedAvatar, setSelectedAvatar] = useState("");
  const [brollFrequency, setBrollFrequency] = useState("Standard");
  const [editorInstructions, setEditorInstructions] = useState("");
  const [globalSpeed, setGlobalSpeed] = useState("1.0");

  // --- Audio ---
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioTimestamps, setAudioTimestamps] = useState<any[] | null>(null);

  // --- Preview modal ---
  const [previewTemplateModal, setPreviewTemplateModal] = useState<string | null>(null);

  // --- Video pipeline ---
  const [isGeneratingVideoPipeline, setIsGeneratingVideoPipeline] = useState(false);
  const [avatarVideoUrl, setAvatarVideoUrl] = useState<string | null>(null);
  const [brollPlan, setBrollPlan] = useState<any>(null);

  // --- Final assembly ---
  const [isAssembling, setIsAssembling] = useState(false);
  const [finalAssembledVideoUrl, setFinalAssembledVideoUrl] = useState<string | null>(null);

  const hasStage = (name: string) => !!client?.stagePlan.some((s) => s.name === name);
  const templatesByLabel: Record<string, UiTemplate> = Object.fromEntries(
    (client?.templates ?? []).map((t) => [t.label, t])
  );

  // Screens shown in the stepper, derived from the client's stage plan.
  const stepperSteps = client
    ? [
        { num: 1, label: "Topic" },
        { num: 2, label: "Script" },
        ...(hasStage("audio") ? [{ num: 3, label: "Architect" }, { num: 4, label: "Audio" }] : []),
        ...(hasStage("avatar") || hasStage("broll_plan") ? [{ num: 5, label: "Assets" }] : []),
        ...(hasStage("assemble") ? [{ num: 6, label: "Final" }] : []),
      ]
    : [];
  const stepperIndex = Math.max(0, stepperSteps.findIndex((s) => s.num >= step));

  // Mount: load client list + deep links (?client= / ?job=)
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setClientList(d.clients || []))
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const jobParam = params.get("job");
    const clientParam = params.get("client");
    if (jobParam) {
      resumeJobById(jobParam);
    } else if (clientParam) {
      selectClient(clientParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectClient(id: string): Promise<UiConfig | null> {
    setIsLoadingClient(true);
    try {
      const cfg = await fetch(`/api/clients/${id}/ui-config`).then((r) => r.json());
      if (cfg.error) throw new Error(cfg.error);
      // Reset per-client flow state so nothing leaks between clients.
      setTopic("");
      setSuggestedTopics([]);
      setConfirmedTopics({});
      setManualOverrides({});
      setClient(cfg);
      setTargetDuration(String(cfg.duration.defaultSec));
      if (cfg.avatars.length > 0) setSelectedAvatar(cfg.avatars[0].label);
      await refreshJobs(id);
      return cfg;
    } catch (err: any) {
      alert("Failed to load client: " + err.message);
      return null;
    } finally {
      setIsLoadingClient(false);
    }
  }

  async function refreshJobs(clientId: string) {
    try {
      const res = await fetch(`/api/jobs?client=${clientId}&limit=10`).then((r) => r.json());
      setRecentJobs(res.jobs || []);
    } catch {}
  }

  async function resumeJobById(id: string) {
    try {
      const res = await fetch(`/api/jobs/${id}`).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      const cfg = await selectClient(res.job.client_id);
      if (cfg) hydrateFromJob(res.job);
    } catch (err: any) {
      alert("Failed to resume job: " + err.message);
    }
  }

  function hydrateFromJob(job: any) {
    setJobId(job.id);
    setTopic(job.topic || "");
    if (job.target_duration_sec) setTargetDuration(String(job.target_duration_sec));
    if (job.english_script) setEnglishScript(job.english_script);
    if (job.full_script) {
      setFinalScript({ ...(job.script_meta || {}), topic: job.topic, template: job.template, fullScript: job.full_script });
    }
    if (job.avatar_label) setSelectedAvatar(job.avatar_label);
    if (job.broll_frequency) setBrollFrequency(job.broll_frequency);
    if (job.editor_notes) setEditorInstructions(job.editor_notes);
    setAudioUrl(job.audio_url || null);
    setAudioTimestamps(job.audio_timestamps || null);
    setAvatarVideoUrl(job.avatar_video_url || null);
    setBrollPlan(job.broll_plan || null);
    setFinalAssembledVideoUrl(job.final_video_url || null);

    let s = 1;
    if (job.full_script) s = 2;
    if (job.audio_url) s = 4;
    if (job.avatar_video_url || job.broll_plan) s = 5;
    if (job.final_video_url) s = 6;
    setStep(s);
    setInFlow(true);
  }

  function startNewReel() {
    setJobId(null);
    setTopic("");
    setEnglishScript("");
    setFinalScript(null);
    setConfirmedTopics({});
    setManualOverrides({});
    setAudioUrl(null);
    setAudioTimestamps(null);
    setAvatarVideoUrl(null);
    setBrollPlan(null);
    setFinalAssembledVideoUrl(null);
    setEditorInstructions("");
    setStep(1);
    setInFlow(true);
    if (suggestedTopics.length === 0 && !isGeneratingTopics) handleGenerateTopics();
  }

  function backToHome() {
    setInFlow(false);
    if (client) refreshJobs(client.id);
  }

  const handleGenerateTopics = async (customQuery = "") => {
    if (!client) return;
    setIsGeneratingTopics(true);
    setSuggestedTopics([]);
    try {
      const url = customQuery
        ? `/api/generate-topic?client=${client.id}&query=${encodeURIComponent(customQuery)}`
        : `/api/generate-topic?client=${client.id}`;
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setSuggestedTopics(data.topics);
      } else {
        alert("Failed to generate topics: " + data.error);
      }
    } catch (err) {
      alert("Error generating topics");
    } finally {
      setIsGeneratingTopics(false);
    }
  };

  const handleGenerateFullScript = async (isRevision = false) => {
    if (!topic || !client) return;
    setIsGeneratingScript(true);
    try {
      // Create the job on first generation so every artifact persists.
      let jid = jobId;
      if (!jid) {
        const jobRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id }),
        });
        const jobData = await jobRes.json();
        if (!jobRes.ok) throw new Error(jobData.error);
        jid = jobData.job.id;
        setJobId(jid);
      }

      // Determine template
      const selectedTopicObj = suggestedTopics.find((t) => t.topic === topic);
      let templateToUse = "Auto";
      if (manualOverrides[topic]) {
        templateToUse = manualOverrides[topic];
      } else if (selectedTopicObj && selectedTopicObj.primaryTemplate) {
        templateToUse = selectedTopicObj.secondaryTemplate
          ? `${selectedTopicObj.primaryTemplate} + ${selectedTopicObj.secondaryTemplate}`
          : selectedTopicObj.primaryTemplate;
      }

      // 1. Generate English
      const payload: any = { clientId: client.id, jobId: jid, topic, targetDuration };
      if (templateToUse !== "Auto") payload.forceTemplate = templateToUse;
      if (isRevision && revisionNotes) payload.revisionNotes = revisionNotes;

      const resEng = await fetch("/api/generate-english", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const dataEng = await resEng.json();
      if (!resEng.ok) throw new Error(dataEng.error);

      setEnglishScript(dataEng.englishScript);

      // 2. Voice adaptation — only when the client's stage plan includes it.
      // English-language clients use the English script as the final script.
      if (hasStage("adapt_voice")) {
        const resHin = await fetch("/api/generate-hinglish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id, jobId: jid, topic, englishScript: dataEng.englishScript }),
        });
        const dataHin = await resHin.json();
        if (!resHin.ok) throw new Error(dataHin.error);
        setFinalScript(dataHin.script);
      } else {
        setFinalScript({
          topic,
          template: dataEng.chosenTemplate,
          wordCount: dataEng.englishScript.trim().split(/\s+/).length,
          estimatedDuration: `${targetDuration}s`,
          fullScript: dataEng.englishScript,
        });
      }
      setStep(2);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsGeneratingScript(false);
      setRevisionNotes("");
    }
  };

  // Persist manual script edits before leaving the editor.
  const persistScriptEdits = async () => {
    if (jobId && finalScript?.fullScript) {
      try {
        await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_script: finalScript.fullScript }),
        });
      } catch {}
    }
  };

  const handleGenerateAudio = async () => {
    if (!client) return;
    setIsGeneratingAudio(true);
    try {
      const audioRes = await fetch("/api/generate-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          jobId,
          text: finalScript?.fullScript,
          globalSpeed: parseFloat(globalSpeed),
        }),
      });
      const audioData = await audioRes.json();
      if (!audioRes.ok) throw new Error(audioData.error);

      setAudioUrl(audioData.audioUrl);
      setAudioTimestamps(audioData.timestamps || null);
      setStep(4);
    } catch (err: any) {
      alert("Audio Generation Failed: " + err.message);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleGenerateVideoPipeline = async () => {
    if (!client) return;
    setIsGeneratingVideoPipeline(true);
    setAvatarVideoUrl(null);
    setBrollPlan(null);
    try {
      let newAvatarUrl: string | null = null;

      if (hasStage("avatar")) {
        const avatarRes = await fetch("/api/generate-avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id, jobId, audioUrl, avatarLabel: selectedAvatar }),
        });
        const avatarData = await avatarRes.json();
        if (!avatarData.success) throw new Error(avatarData.error);
        newAvatarUrl = avatarData.avatarVideoUrl;
        setAvatarVideoUrl(newAvatarUrl);
      }

      if (hasStage("broll_plan")) {
        const planRes = await fetch("/api/generate-broll-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: client.id,
            jobId,
            script: finalScript.fullScript,
            timestamps: audioTimestamps,
            brollFrequency,
            editorNotes: editorInstructions,
          }),
        });
        const planData = await planRes.json();
        if (!planData.success) throw new Error(planData.error);
        setBrollPlan(planData.plan);
      }

      setStep(5);
    } catch (err: any) {
      alert("Video Pipeline Failed: " + err.message);
    } finally {
      setIsGeneratingVideoPipeline(false);
    }
  };

  const handleAssembleFinalVideo = async () => {
    if (!client) return;
    setIsAssembling(true);
    setFinalAssembledVideoUrl(null);
    try {
      const assembleRes = await fetch("/api/assemble-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, jobId, avatarVideoUrl, brollPlan }),
      });
      const assembleData = await assembleRes.json();
      if (!assembleData.success) throw new Error(assembleData.error);
      setFinalAssembledVideoUrl(assembleData.finalVideoUrl);
      setStep(6);
    } catch (err: any) {
      alert("Assembly Failed: " + err.message);
    } finally {
      setIsAssembling(false);
    }
  };

  const handleSelectTopic = (t: any) => {
    setTopic(t.topic);
    if (t.suggestedDuration) setTargetDuration(t.suggestedDuration);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSignOut = async () => {
    await supabaseBrowser().auth.signOut();
    window.location.href = "/login";
  };

  const stageBadge = (job: any) => {
    const color =
      job.stage_status === "failed"
        ? "bg-red-500/20 text-red-400 border-red-500/30"
        : job.final_video_url || job.stage_status === "done"
        ? "bg-green-500/20 text-green-400 border-green-500/30"
        : "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
        {job.current_stage} · {job.stage_status}
      </span>
    );
  };

  // ---------------------------------------------------------------------------
  // SCREEN: client picker
  // ---------------------------------------------------------------------------
  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-card p-12 max-w-md w-full text-center space-y-6 shadow-2xl">
          <div className="mx-auto w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mb-6 border border-primary/40">
            <UserCheck size={32} className="text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-white">Reel Engine</h1>
          <p className="text-gray-400">Select a client workspace</p>
          {isLoadingClient ? (
            <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-primary" size={32} /></div>
          ) : clientList.length > 0 ? (
            <div className="space-y-3">
              {clientList.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c.id)}
                  className="w-full py-4 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)]"
                >
                  {c.displayName}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Loading clients…</p>
          )}
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1 mx-auto">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // SCREEN: client home — new reel + recent jobs (resume)
  // ---------------------------------------------------------------------------
  if (!inFlow) {
    return (
      <main className="min-h-screen py-12 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-4xl font-extrabold text-white tracking-tight">
              {client.displayName} <span className="gradient-text">Studio</span>
            </h1>
            <p className="text-gray-400 text-sm mt-1 capitalize">{client.tier.replace(/_/g, " ")} · {client.contentType.replace(/_/g, " ")}</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/admin" className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors">Admin</a>
            <button
              onClick={() => { setClient(null); setInFlow(false); }}
              className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            >
              Switch Client
            </button>
            <button onClick={handleSignOut} className="text-sm px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 transition-colors" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>

        <button
          onClick={startNewReel}
          className="w-full py-5 mb-10 bg-primary hover:bg-primary-hover text-white rounded-xl font-extrabold text-lg flex justify-center items-center gap-3 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)]"
        >
          <Plus size={22} /> Start New Reel
        </button>

        <div className="glass-card p-8">
          <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-6"><History size={20} className="text-primary" /> Recent Reels</h2>
          {recentJobs.length === 0 ? (
            <p className="text-gray-500 text-sm py-4">No reels yet. Start your first one above.</p>
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => hydrateFromJob(job)}
                  className="w-full flex items-center justify-between gap-4 p-4 rounded-xl border bg-indigo-950/30 border-gray-700 hover:border-gray-500 transition-all text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold truncate">{job.topic || "Untitled reel"}</p>
                    <p className="text-xs text-gray-500 mt-1">{new Date(job.created_at).toLocaleString()}</p>
                  </div>
                  {stageBadge(job)}
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // SCREEN: the reel flow
  // ---------------------------------------------------------------------------
  return (
    <main className="min-h-screen py-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight">
            {client.displayName} <span className="gradient-text">Studio</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {stepperSteps.map((s) => s.label).join(" → ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={backToHome}
            className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
          >
            All Reels
          </button>
          <div className="px-3 py-1.5 rounded-full bg-green-500/20 text-green-400 text-sm font-semibold border border-green-500/30 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
            {client.displayName}
          </div>
        </div>
      </div>

      {/* Stepper (rendered from the client's stage plan) */}
      <div className="flex items-center justify-between mb-10 relative">
        <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-800 -z-10 -translate-y-1/2"></div>
        <div
          className="absolute top-1/2 left-0 h-1 bg-primary -z-10 -translate-y-1/2 transition-all duration-500"
          style={{ width: `${stepperSteps.length > 1 ? (stepperIndex / (stepperSteps.length - 1)) * 100 : 0}%` }}
        ></div>

        {stepperSteps.map((s, idx) => (
          <div key={s.label} className="flex flex-col items-center gap-2">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${step >= s.num ? 'bg-primary text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
              {idx + 1}
            </div>
            <span className={`text-xs font-semibold ${step >= s.num ? 'text-white' : 'text-gray-600'}`}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* STEP 1: TOPIC SELECTION */}
      {step === 1 && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <div className="glass-card p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Sparkles className="text-primary"/> Auto-Suggested Topics</h2>
              <button
                type="button"
                onClick={() => handleGenerateTopics(topic)}
                disabled={isGeneratingTopics}
                className="flex items-center gap-2 text-sm px-4 py-2 bg-indigo-900/40 text-primary hover:bg-indigo-900/60 rounded-lg transition-colors disabled:opacity-50 border border-primary/20"
              >
                {isGeneratingTopics ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Refresh Suggestions
              </button>
            </div>

            <div className="mb-6 relative">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Type a custom topic or select one below..."
                className="w-full px-4 py-4 bg-black/40 border border-gray-700 rounded-lg focus:ring-2 focus:ring-primary text-white placeholder-gray-500 outline-none text-lg"
              />
            </div>

            {suggestedTopics.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 animate-in fade-in">
                {suggestedTopics.map((item: any, idx: number) => {
                  const isSelected = topic === item.topic;
                  return (
                    <div
                      key={idx}
                      className={`flex flex-col gap-4 p-5 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-primary/20 border-primary shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'bg-indigo-950/30 border-gray-700 hover:border-gray-500'}`}
                      onClick={() => handleSelectTopic(item)}
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1 space-y-2">
                          <h3 className="text-white font-bold text-lg leading-tight">{item.topic}</h3>
                          {item.suggestedTemplate && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs bg-indigo-900/50 text-indigo-300 px-2 py-1 rounded-md border border-indigo-700/50 flex items-center gap-1">
                                <Video size={12} /> {item.suggestedTemplate}
                              </span>
                            </div>
                          )}
                        </div>

                        {item.reasoning && (
                          <div className="group relative">
                            <Info size={20} className="text-gray-400 hover:text-primary transition-colors cursor-help" />
                            <div className="absolute right-0 top-6 w-72 p-4 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-sm space-y-3">
                              <div>
                                <strong className="text-primary block mb-1">Why perfect for you?</strong>
                                {Array.isArray(item.reasoning.perfectForYou) ? (
                                  <ul className="list-disc pl-4 text-gray-300 space-y-1">
                                    {item.reasoning.perfectForYou.map((pt: string, i: number) => <li key={i}>{pt}</li>)}
                                  </ul>
                                ) : (
                                  <p className="text-gray-300">{item.reasoning.perfectForYou}</p>
                                )}
                              </div>
                              <div>
                                <strong className="text-green-400 block mb-1">Why audience wants this?</strong>
                                <p className="text-gray-300">{item.reasoning.audienceWantsThis}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {isSelected && (
                        <div className="pt-4 border-t border-gray-700 mt-2" onClick={(e) => e.stopPropagation()}>

                          <div className="bg-black/30 rounded-lg p-4 mb-4 border border-indigo-900/50">
                            <div className="flex justify-between items-center mb-2">
                              <h4 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">AI Recommendation</h4>
                              {item.primaryTemplate && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewTemplateModal(manualOverrides[item.topic] || item.primaryTemplate);
                                  }}
                                  className="text-xs text-primary hover:text-indigo-300 flex items-center gap-1 transition-colors"
                                >
                                  <Video size={12} /> View Sample
                                </button>
                              )}
                            </div>
                            <div className="space-y-1 text-sm">
                              <p><span className="text-gray-400">Primary Template:</span> <span className="text-white font-medium">{item.primaryTemplate || 'N/A'}</span></p>
                              <p><span className="text-gray-400">Secondary Template:</span> <span className="text-white font-medium">{item.secondaryTemplate || 'None'}</span></p>
                              <p className="mt-2 text-indigo-200 text-xs italic"><span className="text-gray-400 not-italic">Reason:</span> {item.templateReasoning || 'N/A'}</p>
                              <div className="mt-3 pt-3 border-t border-gray-800/50 flex flex-col gap-1">
                                <p><span className="text-gray-400">Hook Type:</span> <span className="text-amber-300">{item.hookType || 'N/A'}</span></p>
                                <p><span className="text-gray-400">Close:</span> <span className="text-green-400">{item.closeType || 'N/A'}</span></p>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-3 mb-4">
                            {!confirmedTopics[item.topic] ? (
                              <>
                                <button
                                  onClick={() => setConfirmedTopics(prev => ({...prev, [item.topic]: true}))}
                                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors"
                                >
                                  [Confirm]
                                </button>
                                <button
                                  onClick={() => setShowTemplateDropdown(prev => ({...prev, [item.topic]: !prev[item.topic]}))}
                                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 rounded-md text-sm font-medium transition-colors"
                                >
                                  [Change Template]
                                </button>
                              </>
                            ) : (
                              <span className="px-4 py-2 bg-green-900/30 text-green-400 border border-green-800/50 rounded-md text-sm font-medium flex items-center gap-2">
                                <UserCheck size={16} /> Template Confirmed
                              </span>
                            )}
                          </div>

                          {showTemplateDropdown[item.topic] && !confirmedTopics[item.topic] && (
                            <div className="mb-4 p-3 bg-gray-900/50 border border-gray-700 rounded-lg">
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Manual Override</label>
                              <div className="flex gap-2">
                                <select
                                  value={manualOverrides[item.topic] || item.primaryTemplate || ""}
                                  onChange={(e) => setManualOverrides(prev => ({...prev, [item.topic]: e.target.value}))}
                                  className="flex-1 bg-black/50 border border-gray-600 text-sm rounded-md p-2 text-white outline-none focus:ring-1 focus:ring-primary"
                                >
                                  {client.templates.map(t => (
                                    <option key={t.label} value={t.label}>{t.label}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => setConfirmedTopics(prev => ({...prev, [item.topic]: true}))}
                                  className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm"
                                >
                                  Apply
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="flex-1 mt-4">
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Target Duration ({targetDuration}s)</label>
                            <input
                              type="range"
                              min={client.duration.minSec}
                              max={client.duration.maxSec}
                              step="5"
                              value={targetDuration}
                              onChange={(e) => setTargetDuration(e.target.value)}
                              className="w-full accent-primary h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer mt-1"
                            />
                          </div>

                          <div className="mt-6 flex justify-end">
                            <button
                              onClick={() => handleGenerateFullScript(false)}
                              disabled={isGeneratingScript || !confirmedTopics[item.topic]}
                              className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold flex justify-center items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)]"
                            >
                              {isGeneratingScript ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                              Generate Script
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
               <div className="py-12 text-center text-gray-500">
                 {isGeneratingTopics ? "Analyzing trends..." : "No suggestions loaded."}
               </div>
            )}
          </div>
        </div>
      )}

      {/* STEP 2: SCRIPT EDITOR & CHAT */}
      {step === 2 && finalScript && (
        <div className="glass-card p-8 animate-in fade-in slide-in-from-right-8 space-y-6">
          <div className="flex items-center justify-between border-b border-gray-800 pb-4">
            <div className="flex items-center gap-3">
              <Edit3 className="text-primary" />
              <h2 className="text-2xl font-bold text-white">Review & Revise Script</h2>
            </div>
            <button
              onClick={() => setStep(1)}
              className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            >
              Back to Topics
            </button>
          </div>

          <div className="grid grid-cols-1 gap-8">
            <div className="col-span-1">
               <ScriptDisplay
                 clientId={client.id}
                 jobId={jobId}
                 script={finalScript}
                 onScriptUpdate={(newText) => setFinalScript({ ...finalScript, fullScript: newText })}
               />
               <div className="mt-8 pt-8 border-t border-gray-800">
                 {hasStage("audio") ? (
                   <button
                     onClick={async () => { await persistScriptEdits(); setStep(3); }}
                     className="w-full py-4 bg-primary hover:bg-primary-hover text-white rounded-xl font-bold text-lg flex justify-center items-center gap-2 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)]"
                   >
                     <Video size={20} />
                     Next: Architect Video
                   </button>
                 ) : (
                   <div className="text-center space-y-4">
                     <p className="text-green-400 font-semibold flex items-center justify-center gap-2"><UserCheck size={18}/> Script complete — this client&apos;s plan ends here.</p>
                     <button
                       onClick={async () => { await persistScriptEdits(); backToHome(); }}
                       className="px-8 py-3 bg-white text-black hover:bg-gray-200 rounded-lg font-bold transition-colors shadow-lg"
                     >
                       <Copy size={16} className="inline mr-2" />Save & Back to Reels
                     </button>
                   </div>
                 )}
               </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: VIDEO ARCHITECT */}
      {step === 3 && (
        <div className="glass-card p-8 animate-in fade-in slide-in-from-right-8 space-y-8 max-w-4xl mx-auto">
          <div className="flex items-center justify-between border-b border-gray-800 pb-4">
            <div className="flex items-center gap-3">
              <Settings className="text-primary" />
              <h2 className="text-2xl font-bold text-white">Video Architect Room</h2>
            </div>
             <button
              onClick={() => setStep(2)}
              className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            >
              Back to Script
            </button>
          </div>

          <div className="space-y-6">
            {hasStage("avatar") && client.avatars.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-white mb-4">1. Choose Avatar Look</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {client.avatars.map(avatar => (
                    <div
                      key={avatar.label}
                      onClick={() => setSelectedAvatar(avatar.label)}
                      className={`p-4 rounded-xl border text-center cursor-pointer transition-all ${selectedAvatar === avatar.label ? 'bg-primary/20 border-primary shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'bg-gray-800/40 border-gray-700 hover:border-gray-500'}`}
                    >
                      <div className={`w-16 h-16 mx-auto rounded-full mb-3 flex items-center justify-center overflow-hidden border-2 transition-all ${selectedAvatar === avatar.label ? 'border-primary' : 'border-indigo-900'}`}>
                        {avatar.previewImageUrl ? (
                          <img src={avatar.previewImageUrl} alt={avatar.label} className="w-full h-full object-cover" />
                        ) : (
                          <UserCheck size={24} className="text-gray-500" />
                        )}
                      </div>
                      <span className="font-semibold text-gray-200">{avatar.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasStage("broll_plan") && (
              <>
                <div>
                  <h3 className="text-lg font-bold text-white mb-4">2. B-Roll Frequency</h3>
                  <div className="flex gap-4">
                    {BROLL_OPTIONS.map(freq => (
                      <button
                        key={freq}
                        onClick={() => setBrollFrequency(freq)}
                        className={`flex-1 py-3 rounded-lg border transition-all font-semibold ${brollFrequency === freq ? 'bg-primary text-white border-primary shadow-lg' : 'bg-gray-800/40 text-gray-400 border-gray-700 hover:border-gray-500'}`}
                      >
                        {freq}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-white mb-4">3. Creative Director / Edit Instructions</h3>
                  <textarea
                    value={editorInstructions}
                    onChange={(e) => setEditorInstructions(e.target.value)}
                    placeholder="e.g. Keep transitions fast. Add a cinematic zoom on the hook. Use dark overlay for the tragedy part..."
                    className="w-full bg-black/40 border border-gray-700 text-sm rounded-lg p-4 text-white outline-none focus:ring-1 focus:ring-primary h-32 resize-none leading-relaxed"
                  />
                </div>
              </>
            )}

            <div className="pt-6 border-t border-gray-800">
              <button
                onClick={handleGenerateAudio}
                disabled={isGeneratingAudio}
                className="w-full py-4 bg-primary hover:bg-primary-hover text-white rounded-xl font-extrabold text-lg flex justify-center items-center gap-3 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] disabled:opacity-50"
              >
                {isGeneratingAudio ? <Loader2 className="animate-spin" size={20} /> : <Mic size={20} />}
                {isGeneratingAudio ? "Directing Voice & Rendering Audio..." : "Generate Audio"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: AUDIO READY */}
      {step === 4 && (
        <div className="glass-card p-12 animate-in fade-in slide-in-from-right-8 space-y-8 max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <Mic size={48} className="text-green-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white">Audio & Blueprint Ready</h2>
            <p className="text-gray-400 mt-2">{client.displayName}&apos;s voice has been generated.</p>
          </div>

          {audioUrl && (
            <div className="bg-indigo-950/30 p-6 rounded-xl border border-indigo-500/20 text-center">
              <h3 className="text-white font-semibold mb-4">Playback Generated Voice</h3>
              <audio controls className="w-full" src={audioUrl}>
                Your browser does not support the audio element.
              </audio>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800">
              <h4 className="text-white font-bold mb-4 flex items-center gap-2"><Video size={18}/> Video Architect Blueprint</h4>
              <ul className="text-sm text-gray-300 space-y-3 list-disc pl-4">
                <li><strong>Topic:</strong> {finalScript?.topic || topic}</li>
                <li><strong>Target Duration:</strong> {targetDuration}s</li>
                {hasStage("avatar") && <li><strong>Avatar Style:</strong> {selectedAvatar}</li>}
                {hasStage("broll_plan") && <li><strong>B-Roll Frequency:</strong> {brollFrequency}</li>}
                {hasStage("broll_plan") && <li><strong>Editor Notes:</strong> {editorInstructions || 'None'}</li>}
              </ul>
            </div>
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 flex flex-col h-full">
              <h4 className="text-white font-bold mb-4 flex items-center gap-2"><Edit3 size={18}/> Cued Script</h4>
              <div className="text-xs text-gray-400 font-mono overflow-y-auto max-h-40 flex-1 whitespace-pre-wrap bg-black/50 p-3 rounded-lg border border-gray-700">
                {finalScript?.fullScript}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-800 space-y-4">
            {(hasStage("avatar") || hasStage("broll_plan")) ? (
              <button
                onClick={handleGenerateVideoPipeline}
                disabled={isGeneratingVideoPipeline}
                className="w-full py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-extrabold text-lg flex justify-center items-center gap-3 transition-all shadow-[0_0_20px_rgba(147,51,234,0.4)] disabled:opacity-50"
              >
                {isGeneratingVideoPipeline ? <Loader2 className="animate-spin" size={20} /> : <Video size={20} />}
                {isGeneratingVideoPipeline ? "Rendering Avatar & B-Roll Plan (This takes 3-5 mins)..." : "Render Final Video Pipeline"}
              </button>
            ) : (
              <p className="text-center text-green-400 font-semibold flex items-center justify-center gap-2">
                <UserCheck size={18}/> Audio complete — this client&apos;s plan ends here.
              </p>
            )}
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <button
                onClick={() => setStep(3)}
                className="px-8 py-3 bg-gray-800 text-white hover:bg-gray-700 rounded-lg font-bold transition-colors w-full sm:w-auto"
              >
                Back to Architect Room
              </button>
              <button
                onClick={backToHome}
                className="px-8 py-3 bg-white text-black hover:bg-gray-200 rounded-lg font-bold transition-colors shadow-lg w-full sm:w-auto"
              >
                Back to All Reels
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 5: FINAL ASSETS */}
      {step === 5 && (
        <div className="glass-card p-12 animate-in fade-in slide-in-from-right-8 space-y-8 max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <Sparkles size={48} className="text-purple-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white">Production Assets Ready</h2>
            <p className="text-gray-400 mt-2">
              {hasStage("avatar") ? "Avatar generated" : "Assets generated"}{hasStage("broll_plan") ? " and B-roll timeline fully mapped." : "."}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {hasStage("avatar") && (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-white flex items-center gap-2"><UserCheck size={20}/> Avatar Output</h3>
                {avatarVideoUrl ? (
                  <video src={avatarVideoUrl} controls className="w-full rounded-xl border border-gray-700 shadow-xl" />
                ) : (
                  <div className="p-8 bg-gray-900 border border-gray-800 rounded-xl text-center text-gray-500">Avatar video failed to load or timed out.</div>
                )}
              </div>
            )}

            <div className="space-y-4 flex flex-col justify-center">
              <h3 className="text-xl font-bold text-white flex items-center gap-2"><Video size={20}/> Final Assembly</h3>
              {hasStage("broll_plan") && (
                <>
                  <p className="text-sm text-gray-400">Your blueprint is ready. The B-roll prompts below will be automatically generated in parallel and stitched over the avatar video.</p>
                  <div className="space-y-4 my-4 max-h-96 overflow-y-auto pr-2">
                    {(Array.isArray(brollPlan) ? brollPlan : (brollPlan?.broll || [])).map((b: any, i: number) => (
                      <div key={i} className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                        <p className="text-sm text-primary font-bold mb-1">Clip {i + 1} (Starts {b.start_second || b.start}s)</p>
                        <div className="flex gap-2">
                          <p className="text-xs text-gray-300 bg-black/50 p-2 rounded flex-1">{b.veo_prompt || b.prompt}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {hasStage("assemble") ? (
                <button
                  onClick={handleAssembleFinalVideo}
                  disabled={isAssembling || !avatarVideoUrl}
                  className="w-full py-6 bg-green-600 hover:bg-green-500 text-white rounded-xl font-extrabold text-xl flex justify-center items-center gap-3 transition-all shadow-[0_0_20px_rgba(22,163,74,0.4)] disabled:opacity-50 mt-4"
                >
                  {isAssembling ? <Loader2 className="animate-spin" size={24} /> : <Video size={24} />}
                  {isAssembling ? "Generating video & stitching (Takes ~60s)..." : "Assemble Final Video"}
                </button>
              ) : (
                <p className="text-center text-green-400 font-semibold flex items-center justify-center gap-2 mt-4">
                  <UserCheck size={18}/> Assets complete — this client&apos;s plan ends here.
                </p>
              )}
            </div>
          </div>

          <div className="text-center mt-8 pt-6 border-t border-gray-800 flex justify-center gap-4">
            <button
              onClick={() => setStep(4)}
              className="px-8 py-3 bg-gray-800 text-white hover:bg-gray-700 rounded-lg font-bold transition-colors"
            >
              Back to Audio Room
            </button>
            <button
              onClick={backToHome}
              className="px-8 py-3 bg-white text-black hover:bg-gray-200 rounded-lg font-bold transition-colors shadow-lg"
            >
              Back to All Reels
            </button>
          </div>
        </div>
      )}

      {/* STEP 6: FINAL ASSEMBLED VIDEO */}
      {step === 6 && (
        <div className="glass-card p-12 animate-in fade-in slide-in-from-right-8 space-y-8 max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <Sparkles size={48} className="text-green-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white">Final Video Ready</h2>
            <p className="text-gray-400 mt-2">B-rolls and Avatar perfectly stitched.</p>
          </div>

          <div className="space-y-4">
            {finalAssembledVideoUrl ? (
              <video src={finalAssembledVideoUrl} controls autoPlay className="w-full rounded-xl border border-gray-700 shadow-xl" />
            ) : (
              <div className="p-8 bg-gray-900 border border-gray-800 rounded-xl text-center text-gray-500">Final video failed to load.</div>
            )}
          </div>

          <div className="text-center mt-8 pt-6 border-t border-gray-800 flex justify-center gap-4">
            <button
              onClick={() => setStep(5)}
              className="px-8 py-3 bg-gray-800 text-white hover:bg-gray-700 rounded-lg font-bold transition-colors"
            >
              Back to Blueprint
            </button>
            <button
              onClick={backToHome}
              className="px-8 py-3 bg-white text-black hover:bg-gray-200 rounded-lg font-bold transition-colors shadow-lg"
            >
              Back to All Reels
            </button>
          </div>
        </div>
      )}

      {/* TEMPLATE PREVIEW MODAL */}
      {previewTemplateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setPreviewTemplateModal(null)}>
          <div className={`bg-gray-900 border border-gray-700 rounded-2xl p-6 ${previewTemplateModal === "Auto" ? "max-w-4xl" : "max-w-md"} w-full shadow-2xl relative max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPreviewTemplateModal(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center z-10"
            >
              ✕
            </button>

            {previewTemplateModal === "Auto" ? (
              <>
                <h3 className="text-2xl font-bold text-white mb-2">AI Template Gallery</h3>
                <p className="text-sm text-gray-400 mb-8">Because you selected <strong>Auto</strong>, the AI will evaluate the topic and automatically choose the highest converting format from the options below:</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {client.templates.map((t) => (
                    <div key={t.label} className="bg-black/40 border border-gray-800 rounded-xl p-4 flex flex-col">
                      <h4 className="text-lg font-bold text-white mb-2">{t.label}</h4>
                      <p className="text-xs text-gray-400 mb-4 flex-1">{t.description}</p>
                      {t.previewVideoUrl && (
                        <div className="aspect-[9/16] bg-black rounded-lg overflow-hidden border border-gray-800">
                          <video src={t.previewVideoUrl} controls preload="none" className="w-full h-full object-cover">
                            Your browser does not support the video tag.
                          </video>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : templatesByLabel[previewTemplateModal] ? (
              <>
                <h3 className="text-xl font-bold text-white mb-2">{previewTemplateModal} Example</h3>
                <p className="text-sm text-gray-400 mb-6">{templatesByLabel[previewTemplateModal].description}</p>

                {templatesByLabel[previewTemplateModal].previewVideoUrl ? (
                  <div className="aspect-[9/16] bg-black rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center">
                    <video
                      src={templatesByLabel[previewTemplateModal].previewVideoUrl!}
                      controls
                      autoPlay
                      muted
                      loop
                      className="w-full h-full object-cover"
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                ) : (
                  <div className="p-8 bg-black/40 border border-gray-800 rounded-lg text-center text-gray-500">No preview video for this template.</div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

    </main>
  );
}

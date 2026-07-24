"use client";

import { useState, useEffect } from "react";
import ScriptDisplay from "@/components/ScriptDisplay";
import { Sparkles, Loader2, UserCheck, ArrowRight, Edit3, Info, Video, Mic, Settings, Copy, History, Plus, LogOut, Upload, X, Package, TriangleAlert } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { stageLabel, statusLabel } from "@/lib/labels";
import { BROLL_FREQUENCIES, DEFAULT_BROLL_FREQUENCY } from "@/lib/pipeline/broll";

// All client-specific data (pipelines, templates, avatars) comes from
// /api/clients/[id]/ui-config. Nothing client-specific is hardcoded.
// Which screens a reel shows is driven by the JOB's stage_plan — the pipeline's
// enabled stages with this reel's per-reel choices (voiceover, injected script)
// already applied server-side.

interface UiTemplate { label: string; description: string | null; previewVideoUrl: string | null }
interface UiAvatar { label: string; previewImageUrl: string | null }
interface UiPipeline {
  id: string;
  name: string;
  productInput: boolean;
  hasVoiceStages: boolean;
  stagePlan: { name: string; label: string }[];
  duration: { minSec: number; maxSec: number; defaultSec: number };
}
interface UiConfig {
  id: string;
  slug: string;
  displayName: string;
  localeLanguage: string;
  /** Max product photos this client's visual provider can use, per reel. */
  productImageLimit: number;
  /** The client's duration -> word-count pacing, for the script length estimate. */
  speechWordsPerSec: number;
  /** The ONE photo-size limit, in whole raw MB: a per-reel total across all photos. */
  productImagePayloadLimitMb: number;
  pipelines: UiPipeline[];
  templates: UiTemplate[];
  avatars: UiAvatar[];
}

// Human labels, straight from the server-side allowlist so the two can't drift.
// The Studio sends the label; the server resolves what it means.
const BROLL_OPTIONS: readonly string[] = BROLL_FREQUENCIES;

// Note: <body> is a flex column (layout.tsx), so every screen's root <main>
// carries `w-full min-w-0` — a flex item's default min-width:auto refuses to
// shrink below its nowrap/truncated content and pushes the page sideways.

export default function Home() {
  // --- Client & job context ---
  const [clientList, setClientList] = useState<{ id: string; displayName: string }[]>([]);
  const [client, setClient] = useState<UiConfig | null>(null);
  const [isLoadingClient, setIsLoadingClient] = useState(false);
  const [recentJobs, setRecentJobs] = useState<any[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<string[]>([]);
  const [inFlow, setInFlow] = useState(false);
  const [step, setStep] = useState<number>(1);

  // --- Reel setup (pre-flow) ---
  const [setupMode, setSetupMode] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [voiceover, setVoiceover] = useState(true);
  const [injectMode, setInjectMode] = useState(false);
  const [injectedScript, setInjectedScript] = useState("");
  const [productUrls, setProductUrls] = useState<string[]>([]);
  // Raw bytes of each uploaded photo, index-aligned with productUrls, so the
  // per-reel TOTAL can be checked before anything is sent.
  const [productBytes, setProductBytes] = useState<number[]>([]);
  const [productOverridesResearch, setProductOverridesResearch] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // --- Topic selection ---
  const [topic, setTopic] = useState("");
  const [suggestedTopics, setSuggestedTopics] = useState<any[]>([]);
  const [isGeneratingTopics, setIsGeneratingTopics] = useState(false);

  // --- Script generation ---
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [englishScript, setEnglishScript] = useState("");
  const [targetDuration, setTargetDuration] = useState("45");
  const [finalScript, setFinalScript] = useState<any>(null);

  // --- Confirm flow ---
  const [confirmedTopics, setConfirmedTopics] = useState<Record<string, boolean>>({});
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({});
  const [showTemplateDropdown, setShowTemplateDropdown] = useState<Record<string, boolean>>({});

  // --- Production choices ---
  const [selectedAvatar, setSelectedAvatar] = useState("");
  const [brollFrequency, setBrollFrequency] = useState<string>(DEFAULT_BROLL_FREQUENCY);
  const [editorInstructions, setEditorInstructions] = useState("");
  const [globalSpeed] = useState("1.0");

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
  // Non-blocking notes from the assemble stage (e.g. a no-voiceover concat reel
  // whose plan tiles less than the ordered duration). The reel still shipped.
  // Per-run only — they are not stored on the row, so a resumed reel shows none.
  const [assembleWarnings, setAssembleWarnings] = useState<string[]>([]);

  // --- Architect "Continue" ---
  // Held from the click itself. The paid stage dispatch sits behind an awaited
  // PATCH, so isGeneratingAudio / isGeneratingVideoPipeline are not set until
  // that round trip resolves — a second click inside that window would spend
  // twice (two ElevenLabs renders, or two HeyGen/Veo pipeline runs). Its only
  // writer is proceedFromArchitect, which clears it in a finally, so it cannot
  // strand the button.
  const [isProceeding, setIsProceeding] = useState(false);
  const proceedBusy = isProceeding || isGeneratingAudio || isGeneratingVideoPipeline;

  const hasStage = (name: string) => activePlan.includes(name);
  const templatesByLabel: Record<string, UiTemplate> = Object.fromEntries(
    (client?.templates ?? []).map((t) => [t.label, t])
  );
  const selectedPipeline = client?.pipelines.find((p) => p.id === selectedPipelineId) ?? null;
  const pipelineHasStage = (p: UiPipeline | null, name: string) => !!p?.stagePlan.some((s) => s.name === name);
  // A pipeline that generates no script of its own REQUIRES the user to supply one.
  const mustPasteScript = !!selectedPipeline && !pipelineHasStage(selectedPipeline, "script");
  const willInject = mustPasteScript || injectMode;

  // Screens are derived from this reel's stage plan — no hardcoded pipeline shape.
  const showTopic = hasStage("topic");
  const showScript = hasStage("script") || hasStage("adapt_voice") || !!finalScript;
  const showArchitect = hasStage("audio") || hasStage("broll_plan");
  const showAudio = hasStage("audio");
  const showAssets = hasStage("avatar") || hasStage("broll_plan");
  const showFinal = hasStage("assemble");

  // What this reel was ORDERED at, and where that number came from — the same
  // precedence the server uses (the reel's own target, else the pipeline
  // default, else nothing). Only a plan that runs the `script` stage records a
  // target on the reel; a client-supplied or injected script never does, so
  // those fall back to the pipeline default and say so rather than showing a
  // number that looks recorded. Derived from the plan, never from a slug.
  const parsedTargetDuration = parseInt(targetDuration, 10);
  const reelTargetSec =
    hasStage("script") && Number.isFinite(parsedTargetDuration) && parsedTargetDuration > 0
      ? parsedTargetDuration
      : null;
  const pipelineDefaultSec = selectedPipeline?.duration.defaultSec ?? null;
  const scriptTargetSec = reelTargetSec ?? pipelineDefaultSec;
  const scriptTargetSource: "reel" | "pipeline-default" | "none" =
    reelTargetSec !== null ? "reel" : pipelineDefaultSec !== null ? "pipeline-default" : "none";

  const stepperSteps = [
    ...(showTopic ? [{ num: 1, label: "Topic" }] : []),
    ...(showScript ? [{ num: 2, label: "Script" }] : []),
    ...(showArchitect ? [{ num: 3, label: "Architect" }] : []),
    ...(showAudio ? [{ num: 4, label: "Audio" }] : []),
    ...(showAssets ? [{ num: 5, label: "Assets" }] : []),
    ...(showFinal ? [{ num: 6, label: "Final" }] : []),
  ];
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
      setSelectedPipelineId(cfg.pipelines?.[0]?.id ?? "");
      setClient(cfg);
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

  function resetArtifacts() {
    setEnglishScript("");
    setFinalScript(null);
    setAudioUrl(null);
    setAudioTimestamps(null);
    setAvatarVideoUrl(null);
    setBrollPlan(null);
    setFinalAssembledVideoUrl(null);
    setAssembleWarnings([]);
  }

  function hydrateFromJob(job: any) {
    setJobId(job.id);
    const plan: string[] = job.stage_plan?.length ? job.stage_plan : [];
    setActivePlan(plan);
    if (job.pipeline_id) setSelectedPipelineId(job.pipeline_id);
    setProductUrls(job.product_image_urls ?? []);
    setProductBytes([]);
    // Captured on the reel at creation, so a resumed reel and an admin retry
    // both use the choice this reel was ordered under.
    setProductOverridesResearch(!!job.product_overrides_research);
    setTopic(job.topic || "");
    if (job.target_duration_sec) setTargetDuration(String(job.target_duration_sec));
    if (job.english_script) setEnglishScript(job.english_script);
    if (job.full_script) {
      setFinalScript({ ...(job.script_meta || {}), topic: job.topic, template: job.template, fullScript: job.full_script });
    } else {
      setFinalScript(null);
    }
    if (job.avatar_label) setSelectedAvatar(job.avatar_label);
    if (job.broll_frequency) setBrollFrequency(job.broll_frequency);
    if (job.editor_notes) setEditorInstructions(job.editor_notes);
    setAudioUrl(job.audio_url || null);
    setAudioTimestamps(job.audio_timestamps || null);
    setAvatarVideoUrl(job.avatar_video_url || null);
    setBrollPlan(job.broll_plan || null);
    setFinalAssembledVideoUrl(job.final_video_url || null);
    // Assemble warnings are per-run and not persisted (R16) — never carry the
    // previous reel's into this one.
    setAssembleWarnings([]);

    // Land on the furthest screen this reel's artifacts support, clamped to
    // the stages this reel actually has.
    let s = plan.includes("topic") ? 1 : 2;
    if (job.full_script) s = 2;
    if (job.audio_url) s = 4;
    if (job.avatar_video_url || job.broll_plan) s = 5;
    if (job.final_video_url) s = 6;
    setStep(s);
    setInFlow(true);
    setSetupMode(false);
  }

  function openSetup() {
    if (!client) return;
    if (client.pipelines.length === 0) {
      alert("This client has no active pipelines. Add one in Admin → Client → Pipelines.");
      return;
    }
    setJobId(null);
    setActivePlan([]);
    resetArtifacts();
    setTopic("");
    setSuggestedTopics([]);
    setConfirmedTopics({});
    setManualOverrides({});
    setEditorInstructions("");
    setSelectedPipelineId(client.pipelines[0].id);
    setVoiceover(true);
    setInjectMode(false);
    setInjectedScript("");
    setProductUrls([]);
    setProductBytes([]);
    setProductOverridesResearch(false);
    // A new reel starts from defaults like every other setup field — these three
    // used to survive the previous reel, so an unchanged screen could hand the
    // next reel someone else's choice.
    setBrollFrequency(DEFAULT_BROLL_FREQUENCY);
    setSelectedAvatar(client.avatars[0]?.label ?? "");
    setTargetDuration(String(client.pipelines[0].duration.defaultSec));
    setStep(1);
    setInFlow(false);
    setSetupMode(true);
  }

  function backToHome() {
    setInFlow(false);
    setSetupMode(false);
    if (client) refreshJobs(client.id);
  }

  async function handleProductFiles(files: FileList | null) {
    if (!files || !client) return;
    // The limit comes from the client's visual provider (ui-config), not a
    // constant — a provider that takes a different number of reference photos
    // must not need a UI change. Uploading more than the provider can use would
    // be silently truncated at generation time.
    const limit = client.productImageLimit;
    const room = limit - productUrls.length;
    if (room <= 0) {
      alert(`You can use at most ${limit} product photo${limit === 1 ? "" : "s"} per reel. Remove one to add another.`);
      return;
    }
    const picked = Array.from(files);
    if (picked.length > room) {
      alert(`Only ${room} more photo${room === 1 ? "" : "s"} can be added (limit ${limit} per reel). Taking the first ${room}.`);
    }
    const incoming = picked.slice(0, room);

    // ONE size limit, and it is a per-reel TOTAL: the script model receives every
    // photo in a single request, so three photos that each pass on their own can
    // still blow the request. Checked here, before anything is uploaded, against
    // the same number stated above the picker and enforced by the upload route —
    // a photo must never be accepted here and rejected for size by a stage.
    const limitMb = client.productImagePayloadLimitMb;
    const totalBytes = incoming.reduce(
      (sum, f) => sum + f.size,
      productBytes.reduce((sum, b) => sum + b, 0)
    );
    if (totalBytes > limitMb * 1024 * 1024) {
      alert(
        `These photos come to ${(totalBytes / 1024 / 1024).toFixed(1)} MB. A reel can carry ${limitMb} MB of product photos in total — remove one or use a smaller file.`
      );
      return;
    }

    setIsUploading(true);
    try {
      const urls = [...productUrls];
      const bytes = [...productBytes];
      for (const file of incoming) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("clientId", client.id);
        const res = await fetch("/api/uploads", { method: "POST", body: fd });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        urls.push(d.url);
        bytes.push(file.size);
      }
      setProductUrls(urls);
      setProductBytes(bytes);
    } catch (err: any) {
      alert("Product photo upload failed: " + err.message);
    } finally {
      setIsUploading(false);
    }
  }

  // Create the reel job with this reel's pipeline + per-reel choices. The server
  // resolves and snapshots the stage plan; the UI follows that plan from here.
  async function handleStartReel() {
    if (!client || !selectedPipeline) return;
    if (willInject && !injectedScript.trim()) {
      alert("Paste the script to continue.");
      return;
    }
    setIsStarting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          pipelineId: selectedPipeline.id,
          voiceover: selectedPipeline.hasVoiceStages ? voiceover : true,
          injectedScript: willInject ? injectedScript : undefined,
          productImageUrls: productUrls,
          // Both are settled HERE, at creation, so the row carries the user's
          // choice from the instant it exists — not once a later stage happens
          // to complete. Labels and booleans only; the server resolves them.
          brollFrequency,
          productOverridesResearch,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const job = data.job;
      const plan: string[] = job.stage_plan ?? [];
      setJobId(job.id);
      setActivePlan(plan);
      setTargetDuration(String(selectedPipeline.duration.defaultSec));
      resetArtifacts();

      if (plan.includes("topic")) {
        setStep(1);
        setInFlow(true);
        setSetupMode(false);
        await generateTopics(job.id, "");
      } else {
        // Injected / client-supplied script: no topic or script generation.
        setEnglishScript(injectedScript);
        if (plan.includes("adapt_voice")) {
          const hin = await fetch("/api/generate-hinglish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId: client.id, jobId: job.id, topic: "", englishScript: injectedScript }),
          });
          const hd = await hin.json();
          if (!hin.ok) throw new Error(hd.error);
          setFinalScript(hd.script);
        } else {
          setFinalScript({
            topic: "Client-supplied script",
            template: "—",
            wordCount: injectedScript.trim().split(/\s+/).length,
            estimatedDuration: `${selectedPipeline.duration.defaultSec}s`,
            fullScript: injectedScript,
          });
        }
        setStep(2);
        setInFlow(true);
        setSetupMode(false);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsStarting(false);
    }
  }

  async function generateTopics(jid: string, customQuery: string) {
    if (!client) return;
    setIsGeneratingTopics(true);
    setSuggestedTopics([]);
    try {
      const res = await fetch("/api/generate-topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, jobId: jid, query: customQuery }),
      });
      const data = await res.json();
      if (res.ok) setSuggestedTopics(data.topics);
      else alert("Failed to generate topics: " + data.error);
    } catch {
      alert("Error generating topics");
    } finally {
      setIsGeneratingTopics(false);
    }
  }

  const handleGenerateFullScript = async () => {
    if (!topic || !client || !jobId) return;
    setIsGeneratingScript(true);
    try {
      const selectedTopicObj = suggestedTopics.find((t) => t.topic === topic);
      let templateToUse = "Auto";
      if (manualOverrides[topic]) {
        templateToUse = manualOverrides[topic];
      } else if (selectedTopicObj && selectedTopicObj.primaryTemplate) {
        templateToUse = selectedTopicObj.secondaryTemplate
          ? `${selectedTopicObj.primaryTemplate} + ${selectedTopicObj.secondaryTemplate}`
          : selectedTopicObj.primaryTemplate;
      }

      const payload: any = { clientId: client.id, jobId, topic, targetDuration };
      if (templateToUse !== "Auto") payload.forceTemplate = templateToUse;

      const resEng = await fetch("/api/generate-english", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const dataEng = await resEng.json();
      if (!resEng.ok) throw new Error(dataEng.error);
      setEnglishScript(dataEng.englishScript);

      // Voice adaptation only when this reel's plan includes it.
      if (hasStage("adapt_voice")) {
        const resHin = await fetch("/api/generate-hinglish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id, jobId, topic, englishScript: dataEng.englishScript }),
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

  // The frequency chip is still editable here — a production choice tuned after
  // reading the script — so persist it before navigating on, exactly as
  // persistScriptEdits does. broll_frequency is already on the PATCH allowlist.
  // A failure is swallowed: the value still travels in the generate-broll-plan
  // body, so the worst case is today's behaviour and the reel is never blocked.
  const persistBrollFrequency = async () => {
    if (!jobId || !hasStage("broll_plan")) return;
    try {
      await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broll_frequency: brollFrequency }),
      });
    } catch {}
  };

  // No-voiceover reels skip audio entirely and go straight to the visual stages.
  // isProceeding is raised BEFORE the awaited persist so the button is disabled
  // from the click rather than from the PATCH's completion, and lowered in a
  // finally that runs whether the persist rejects, a dispatched handler rejects,
  // or a handler returns early before setting its own flag — so the button can
  // never be double-fired and can never be left permanently disabled.
  const proceedFromArchitect = async () => {
    setIsProceeding(true);
    try {
      await persistBrollFrequency();
      if (hasStage("audio")) await handleGenerateAudio();
      else await handleGenerateVideoPipeline();
    } finally {
      setIsProceeding(false);
    }
  };

  const handleGenerateVideoPipeline = async () => {
    if (!client) return;
    setIsGeneratingVideoPipeline(true);
    setAvatarVideoUrl(null);
    setBrollPlan(null);
    try {
      if (hasStage("avatar")) {
        const avatarRes = await fetch("/api/generate-avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id, jobId, audioUrl, avatarLabel: selectedAvatar }),
        });
        const avatarData = await avatarRes.json();
        if (!avatarData.success) throw new Error(avatarData.error);
        setAvatarVideoUrl(avatarData.avatarVideoUrl);
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
    setAssembleWarnings([]);
    try {
      const assembleRes = await fetch("/api/assemble-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, jobId, avatarVideoUrl, brollPlan }),
      });
      const assembleData = await assembleRes.json();
      if (!assembleData.success) throw new Error(assembleData.error);
      setFinalAssembledVideoUrl(assembleData.finalVideoUrl);
      // The reel shipped — these are notes, not failures, so they are shown on
      // the Final screen rather than raised as an alert.
      setAssembleWarnings(assembleData.warnings ?? []);
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
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${color}`}>
        {stageLabel(job.current_stage)} · {statusLabel(job.stage_status)}
      </span>
    );
  };

  // ---------------------------------------------------------------------------
  // SCREEN: client picker
  // ---------------------------------------------------------------------------
  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-card p-8 sm:p-12 max-w-md w-full text-center space-y-6 shadow-2xl">
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
                  className="w-full py-4 px-4 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)]"
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
  // SCREEN: reel setup (pipeline + per-reel choices)
  // ---------------------------------------------------------------------------
  if (setupMode) {
    return (
      <main className="min-h-screen w-full min-w-0 py-8 sm:py-12 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
        <div className="flex justify-between items-center gap-4 mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">New Reel</h1>
          <button onClick={backToHome} className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors shrink-0">
            Cancel
          </button>
        </div>

        <div className="space-y-6">
          {/* Pipeline picker */}
          {client.pipelines.length > 1 && (
            <div className="glass-card p-6">
              <h2 className="text-lg font-bold text-white mb-4">1. Choose pipeline</h2>
              <div className="space-y-3">
                {client.pipelines.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPipelineId(p.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${selectedPipelineId === p.id ? "bg-primary/20 border-primary" : "bg-indigo-950/30 border-gray-700 hover:border-gray-500"}`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-white font-semibold">{p.name}</span>
                      {p.productInput && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                          <Package size={11} /> product
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.stagePlan.map((s) => (
                        <span key={s.name} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{s.label}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedPipeline && (
            <div className="glass-card p-6 space-y-6">
              <h2 className="text-lg font-bold text-white">
                {client.pipelines.length > 1 ? "2. This reel" : "This reel"}
                <span className="text-gray-500 font-normal text-sm ml-2">{selectedPipeline.name}</span>
              </h2>

              {client.pipelines.length === 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedPipeline.stagePlan.map((s) => (
                    <span key={s.name} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{s.label}</span>
                  ))}
                </div>
              )}

              {/* Voiceover toggle — per reel, not per client */}
              {selectedPipeline.hasVoiceStages && (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white font-semibold text-sm">Include voiceover</p>
                    <p className="text-gray-500 text-xs mt-1">
                      Off = no voice script and no text-to-speech for this reel (video + music only). The avatar step is skipped too — it needs an audio track.
                    </p>
                  </div>
                  <button
                    onClick={() => setVoiceover(!voiceover)}
                    className={`shrink-0 px-4 py-2 rounded-lg border font-semibold text-sm transition-all ${voiceover ? "bg-green-500/20 text-green-400 border-green-500/40" : "bg-gray-800/40 text-gray-400 border-gray-700"}`}
                  >
                    {voiceover ? "ON" : "OFF"}
                  </button>
                </div>
              )}

              {/* Script injection */}
              {!mustPasteScript && pipelineHasStage(selectedPipeline, "script") && (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white font-semibold text-sm">Use my own script</p>
                    <p className="text-gray-500 text-xs mt-1">Paste a script instead of generating one — skips topic &amp; script generation.</p>
                  </div>
                  <button
                    onClick={() => setInjectMode(!injectMode)}
                    className={`shrink-0 px-4 py-2 rounded-lg border font-semibold text-sm transition-all ${injectMode ? "bg-green-500/20 text-green-400 border-green-500/40" : "bg-gray-800/40 text-gray-400 border-gray-700"}`}
                  >
                    {injectMode ? "ON" : "OFF"}
                  </button>
                </div>
              )}

              {willInject && (
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">
                    {mustPasteScript ? "Your script (required)" : "Your script"}
                  </label>
                  <textarea
                    value={injectedScript}
                    onChange={(e) => setInjectedScript(e.target.value)}
                    placeholder="Paste the script here. It will be optimized for the downstream tools before the reel is produced."
                    className="w-full bg-black/40 border border-gray-700 text-sm rounded-lg p-4 text-white outline-none focus:ring-1 focus:ring-primary h-40 resize-none leading-relaxed"
                  />
                </div>
              )}

              {/* Product priority — offered only once photos are actually
                  attached, since there is nothing to prioritise without them. */}
              {productUrls.length > 0 && (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white font-semibold text-sm">Make this reel about the product</p>
                    <p className="text-gray-500 text-xs mt-1">
                      The uploaded product takes priority over the research doc&apos;s usual topics when the topics are suggested. Everything else is unchanged — templates, hooks and closes still come from the research doc.
                    </p>
                  </div>
                  <button
                    onClick={() => setProductOverridesResearch(!productOverridesResearch)}
                    className={`shrink-0 px-4 py-2 rounded-lg border font-semibold text-sm transition-all ${productOverridesResearch ? "bg-green-500/20 text-green-400 border-green-500/40" : "bg-gray-800/40 text-gray-400 border-gray-700"}`}
                  >
                    {productOverridesResearch ? "ON" : "OFF"}
                  </button>
                </div>
              )}

              {/* B-roll frequency — recorded on the reel at creation, so the row
                  reads the user's choice before any stage has run. Only offered
                  when this pipeline actually plans B-roll. */}
              {pipelineHasStage(selectedPipeline, "broll_plan") && (
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">B-roll frequency</label>
                  <p className="text-gray-500 text-xs mb-3">How densely this reel cuts to B-roll. You can still change it in the Architect room after reading the script.</p>
                  <div className="flex gap-3 sm:gap-4 flex-wrap">
                    {BROLL_OPTIONS.map((freq) => (
                      <button
                        key={freq}
                        onClick={() => setBrollFrequency(freq)}
                        className={`flex-1 min-w-[6rem] py-3 rounded-lg border transition-all font-semibold ${brollFrequency === freq ? "bg-primary text-white border-primary shadow-lg" : "bg-gray-800/40 text-gray-400 border-gray-700 hover:border-gray-500"}`}
                      >
                        {freq}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Per-reel product photos */}
              {selectedPipeline.productInput && (
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">
                    Product photos <span className="text-gray-600 normal-case font-normal">({productUrls.length}/{client.productImageLimit})</span>
                  </label>
                  <p className="text-gray-500 text-xs mb-3">Uploaded per reel — used as reference for this generation only. Nothing is saved to the client. Up to {client.productImageLimit} per reel; every photo you add is used. Photos may total up to {client.productImagePayloadLimitMb} MB for the whole reel.</p>
                  <div className="flex flex-wrap gap-3 mb-3">
                    {productUrls.map((u, i) => (
                      <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-700">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt={`Product ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => {
                            setProductUrls(productUrls.filter((_, j) => j !== i));
                            setProductBytes(productBytes.filter((_, j) => j !== i));
                          }}
                          className="absolute top-0.5 right-0.5 bg-black/70 rounded-full p-0.5 text-gray-300 hover:text-white"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {productUrls.length < client.productImageLimit && (
                      <label className={`w-20 h-20 rounded-lg border border-dashed border-gray-600 flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-gray-400 transition-colors ${isUploading ? "opacity-50" : ""}`}>
                        {isUploading ? <Loader2 size={18} className="animate-spin text-primary" /> : <Upload size={18} className="text-gray-500" />}
                        <span className="text-[10px] text-gray-500">Add</span>
                        <input type="file" accept="image/*" multiple className="hidden" disabled={isUploading} onChange={(e) => handleProductFiles(e.target.files)} />
                      </label>
                    )}
                  </div>
                </div>
              )}

              <button
                onClick={handleStartReel}
                disabled={isStarting || isUploading}
                className="w-full py-4 bg-primary hover:bg-primary-hover text-white rounded-xl font-extrabold text-lg flex justify-center items-center gap-3 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] disabled:opacity-50"
              >
                {isStarting ? <Loader2 className="animate-spin" size={20} /> : <ArrowRight size={20} />}
                Start Reel
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // SCREEN: client home — new reel + recent jobs (resume)
  // ---------------------------------------------------------------------------
  if (!inFlow) {
    return (
      <main className="min-h-screen w-full min-w-0 py-8 sm:py-12 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-10">
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight truncate">
              {client.displayName} <span className="gradient-text">Studio</span>
            </h1>
            <p className="text-gray-400 text-sm mt-1 truncate">
              {client.pipelines.length > 0 ? client.pipelines.map((p) => p.name).join(" · ") : "No active pipelines"}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
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
          onClick={openSetup}
          className="w-full py-5 mb-10 bg-primary hover:bg-primary-hover text-white rounded-xl font-extrabold text-lg flex justify-center items-center gap-3 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)]"
        >
          <Plus size={22} /> Start New Reel
        </button>

        <div className="glass-card p-6 sm:p-8">
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
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {new Date(job.created_at).toLocaleString()}
                      {job.pipeline_name ? ` · ${job.pipeline_name}` : ""}
                    </p>
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
    <main className="min-h-screen w-full min-w-0 py-8 sm:py-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-10">
        <div className="min-w-0">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight truncate">
            {client.displayName} <span className="gradient-text">Studio</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1 truncate">
            {stepperSteps.map((s) => s.label).join(" → ")}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={backToHome}
            className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
          >
            All Reels
          </button>
          <div className="px-3 py-1.5 rounded-full bg-green-500/20 text-green-400 text-sm font-semibold border border-green-500/30 flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0"></span>
            <span className="truncate">{client.displayName}</span>
          </div>
        </div>
      </div>

      {/* Stepper (rendered from this reel's stage plan) */}
      <div className="flex items-start justify-between mb-10 relative">
        <div className="absolute top-5 left-0 w-full h-1 bg-gray-800 -z-10"></div>
        <div
          className="absolute top-5 left-0 h-1 bg-primary -z-10 transition-all duration-500"
          style={{ width: `${stepperSteps.length > 1 ? (stepperIndex / (stepperSteps.length - 1)) * 100 : 0}%` }}
        ></div>

        {stepperSteps.map((s, idx) => (
          <div key={s.label} className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 shrink-0 ${step >= s.num ? 'bg-primary text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
              {idx + 1}
            </div>
            <span className={`text-[10px] sm:text-xs font-semibold truncate max-w-full ${step >= s.num ? 'text-white' : 'text-gray-600'}`}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* STEP 1: TOPIC SELECTION */}
      {step === 1 && showTopic && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <div className="glass-card p-6 sm:p-8">
            <div className="flex justify-between items-center gap-4 mb-6 flex-wrap">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Sparkles className="text-primary"/> Auto-Suggested Topics</h2>
              <button
                type="button"
                onClick={() => jobId && generateTopics(jobId, topic)}
                disabled={isGeneratingTopics}
                className="flex items-center gap-2 text-sm px-4 py-2 bg-indigo-900/40 text-primary hover:bg-indigo-900/60 rounded-lg transition-colors disabled:opacity-50 border border-primary/20"
              >
                {isGeneratingTopics ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Refresh Suggestions
              </button>
            </div>

            <div className="mb-6">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Type a custom topic or select one below..."
                className="w-full px-4 py-4 bg-black/40 border border-gray-700 rounded-lg focus:ring-2 focus:ring-primary text-white placeholder-gray-500 outline-none text-lg"
              />
            </div>

            {/* Custom topic that matches no suggestion — go straight to script. */}
            {topic.trim() && !suggestedTopics.some((t) => t.topic === topic) && (
              <div className="mb-6 p-5 rounded-xl border border-primary/40 bg-primary/10 space-y-4 animate-in fade-in">
                <div>
                  <p className="text-white font-semibold">Use your own topic</p>
                  <p className="text-gray-400 text-sm mt-1 break-words">&ldquo;{topic}&rdquo;</p>
                  <p className="text-gray-500 text-xs mt-2">The AI picks the best template for it. Or hit Refresh Suggestions to get angles on this topic first.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Target Duration ({targetDuration}s)</label>
                  <input
                    type="range"
                    min={selectedPipeline?.duration.minSec ?? 15}
                    max={selectedPipeline?.duration.maxSec ?? 90}
                    step="5"
                    value={targetDuration}
                    onChange={(e) => setTargetDuration(e.target.value)}
                    className="w-full accent-primary h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer mt-1"
                  />
                </div>
                <button
                  onClick={handleGenerateFullScript}
                  disabled={isGeneratingScript}
                  className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold flex justify-center items-center gap-2 disabled:opacity-40 transition-all"
                >
                  {isGeneratingScript ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                  Generate Script with this topic
                </button>
              </div>
            )}

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
                        <div className="flex-1 space-y-2 min-w-0">
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
                          <div className="group relative shrink-0">
                            <Info size={20} className="text-gray-400 hover:text-primary transition-colors cursor-help" />
                            <div className="absolute right-0 top-6 w-[min(18rem,80vw)] p-4 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-sm space-y-3">
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
                            <div className="flex justify-between items-center gap-3 mb-2 flex-wrap">
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
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setShowTemplateDropdown(prev => ({...prev, [item.topic]: !prev[item.topic]}))}
                                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 rounded-md text-sm font-medium transition-colors"
                                >
                                  Change Template
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
                              <div className="flex gap-2 flex-wrap">
                                <select
                                  value={manualOverrides[item.topic] || item.primaryTemplate || ""}
                                  onChange={(e) => setManualOverrides(prev => ({...prev, [item.topic]: e.target.value}))}
                                  className="flex-1 min-w-[12rem] bg-black/50 border border-gray-600 text-sm rounded-md p-2 text-white outline-none focus:ring-1 focus:ring-primary"
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
                              min={selectedPipeline?.duration.minSec ?? 15}
                              max={selectedPipeline?.duration.maxSec ?? 90}
                              step="5"
                              value={targetDuration}
                              onChange={(e) => setTargetDuration(e.target.value)}
                              className="w-full accent-primary h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer mt-1"
                            />
                          </div>

                          <div className="mt-6 flex justify-end">
                            <button
                              onClick={handleGenerateFullScript}
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
        <div className="glass-card p-6 sm:p-8 animate-in fade-in slide-in-from-right-8 space-y-6">
          <div className="flex items-center justify-between gap-4 border-b border-gray-800 pb-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Edit3 className="text-primary" />
              <h2 className="text-2xl font-bold text-white">Review &amp; Revise Script</h2>
            </div>
            {showTopic && (
              <button
                onClick={() => setStep(1)}
                className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
              >
                Back to Topics
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-8">
            <div className="col-span-1">
               <ScriptDisplay
                 clientId={client.id}
                 jobId={jobId}
                 script={finalScript}
                 targetDurationSec={scriptTargetSec}
                 wordsPerSec={client.speechWordsPerSec}
                 targetSource={scriptTargetSource}
                 onScriptUpdate={(newText) => setFinalScript({ ...finalScript, fullScript: newText })}
               />
               <div className="mt-8 pt-8 border-t border-gray-800">
                 {showArchitect ? (
                   <button
                     onClick={async () => { await persistScriptEdits(); setStep(3); }}
                     className="w-full py-4 bg-primary hover:bg-primary-hover text-white rounded-xl font-bold text-lg flex justify-center items-center gap-2 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)]"
                   >
                     <Video size={20} />
                     Next: Architect Video
                   </button>
                 ) : (
                   <div className="text-center space-y-4">
                     <p className="text-green-400 font-semibold flex items-center justify-center gap-2"><UserCheck size={18}/> Script complete — this reel&apos;s pipeline ends here.</p>
                     <button
                       onClick={async () => { await persistScriptEdits(); backToHome(); }}
                       className="px-8 py-3 bg-white text-black hover:bg-gray-200 rounded-lg font-bold transition-colors shadow-lg"
                     >
                       <Copy size={16} className="inline mr-2" />Save &amp; Back to Reels
                     </button>
                   </div>
                 )}
               </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: VIDEO ARCHITECT */}
      {step === 3 && showArchitect && (
        <div className="glass-card p-6 sm:p-8 animate-in fade-in slide-in-from-right-8 space-y-8 max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-4 border-b border-gray-800 pb-4 flex-wrap">
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
                <h3 className="text-lg font-bold text-white mb-4">Choose Avatar Look</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {client.avatars.map(avatar => (
                    <div
                      key={avatar.label}
                      onClick={() => setSelectedAvatar(avatar.label)}
                      className={`p-4 rounded-xl border text-center cursor-pointer transition-all ${selectedAvatar === avatar.label ? 'bg-primary/20 border-primary shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'bg-gray-800/40 border-gray-700 hover:border-gray-500'}`}
                    >
                      <div className={`w-16 h-16 mx-auto rounded-full mb-3 flex items-center justify-center overflow-hidden border-2 transition-all ${selectedAvatar === avatar.label ? 'border-primary' : 'border-indigo-900'}`}>
                        {avatar.previewImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatar.previewImageUrl} alt={avatar.label} className="w-full h-full object-cover" />
                        ) : (
                          <UserCheck size={24} className="text-gray-500" />
                        )}
                      </div>
                      <span className="font-semibold text-gray-200 text-sm break-words">{avatar.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {productUrls.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Package size={18} className="text-amber-300" /> Product Photos</h3>
                <div className="flex flex-wrap gap-3">
                  {productUrls.map((u, i) => (
                    <div key={i} className="w-20 h-20 rounded-lg overflow-hidden border border-gray-700">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Product ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasStage("broll_plan") && (
              <>
                <div>
                  <h3 className="text-lg font-bold text-white mb-4">B-Roll Frequency</h3>
                  <div className="flex gap-3 sm:gap-4 flex-wrap">
                    {BROLL_OPTIONS.map(freq => (
                      <button
                        key={freq}
                        onClick={() => setBrollFrequency(freq)}
                        className={`flex-1 min-w-[6rem] py-3 rounded-lg border transition-all font-semibold ${brollFrequency === freq ? 'bg-primary text-white border-primary shadow-lg' : 'bg-gray-800/40 text-gray-400 border-gray-700 hover:border-gray-500'}`}
                      >
                        {freq}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-white mb-4">Creative Director / Edit Instructions</h3>
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
                onClick={proceedFromArchitect}
                disabled={proceedBusy}
                className="w-full py-4 bg-primary hover:bg-primary-hover text-white rounded-xl font-extrabold text-lg flex justify-center items-center gap-3 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] disabled:opacity-50"
              >
                {proceedBusy ? <Loader2 className="animate-spin" size={20} /> : <Mic size={20} />}
                {showAudio
                  ? (proceedBusy ? "Directing Voice & Rendering Audio..." : "Generate Audio")
                  : (proceedBusy ? "Planning Visuals (this takes a few mins)..." : "Continue to Assets")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: AUDIO READY */}
      {step === 4 && showAudio && (
        <div className="glass-card p-6 sm:p-12 animate-in fade-in slide-in-from-right-8 space-y-8 max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <Mic size={48} className="text-green-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white">Audio &amp; Blueprint Ready</h2>
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
                <li className="break-words"><strong>Topic:</strong> {finalScript?.topic || topic}</li>
                <li><strong>Target Duration:</strong> {targetDuration}s</li>
                {hasStage("avatar") && <li><strong>Avatar Style:</strong> {selectedAvatar}</li>}
                {hasStage("broll_plan") && <li><strong>B-Roll Frequency:</strong> {brollFrequency}</li>}
                {hasStage("broll_plan") && <li className="break-words"><strong>Editor Notes:</strong> {editorInstructions || 'None'}</li>}
                {productUrls.length > 0 && <li><strong>Product Photos:</strong> {productUrls.length}</li>}
                {productUrls.length > 0 && <li><strong>Product priority:</strong> {productOverridesResearch ? 'On' : 'Off'}</li>}
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
            {showAssets ? (
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
                <UserCheck size={18}/> Audio complete — this reel&apos;s pipeline ends here.
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
      {step === 5 && showAssets && (
        <div className="glass-card p-6 sm:p-12 animate-in fade-in slide-in-from-right-8 space-y-8 max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <Sparkles size={48} className="text-purple-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white">Production Assets Ready</h2>
            <p className="text-gray-400 mt-2">
              {hasStage("avatar") ? "Avatar generated" : "Assets generated"}{hasStage("broll_plan") ? " and B-roll timeline fully mapped." : "."}
            </p>
          </div>

          <div className={`grid grid-cols-1 ${hasStage("avatar") ? "md:grid-cols-2" : ""} gap-8`}>
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
                  <p className="text-sm text-gray-400">
                    {hasStage("avatar")
                      ? "Your blueprint is ready. The B-roll prompts below will be generated in parallel and stitched over the avatar video."
                      : "Your blueprint is ready. These clips will be generated and stitched together into the finished reel."}
                  </p>
                  <div className="space-y-4 my-4 max-h-96 overflow-y-auto pr-2">
                    {(Array.isArray(brollPlan) ? brollPlan : (brollPlan?.broll || [])).map((b: any, i: number) => (
                      <div key={i} className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                        <p className="text-sm text-primary font-bold mb-1">
                          Clip {i + 1} (Starts {b.start_second ?? b.start ?? 0}s)
                          {b.media_type === "product_image" && <span className="ml-2 text-amber-300 text-xs">product photo</span>}
                        </p>
                        <div className="flex gap-2">
                          <p className="text-xs text-gray-300 bg-black/50 p-2 rounded flex-1 break-words">{b.veo_prompt || b.prompt || b.scene}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {showFinal ? (
                <button
                  onClick={handleAssembleFinalVideo}
                  disabled={isAssembling || (hasStage("avatar") ? !avatarVideoUrl : !brollPlan)}
                  className="w-full py-6 bg-green-600 hover:bg-green-500 text-white rounded-xl font-extrabold text-xl flex justify-center items-center gap-3 transition-all shadow-[0_0_20px_rgba(22,163,74,0.4)] disabled:opacity-50 mt-4"
                >
                  {isAssembling ? <Loader2 className="animate-spin" size={24} /> : <Video size={24} />}
                  {isAssembling ? "Generating video & stitching (Takes ~60s)..." : "Assemble Final Video"}
                </button>
              ) : (
                <p className="text-center text-green-400 font-semibold flex items-center justify-center gap-2 mt-4">
                  <UserCheck size={18}/> Assets complete — this reel&apos;s pipeline ends here.
                </p>
              )}
            </div>
          </div>

          <div className="text-center mt-8 pt-6 border-t border-gray-800 flex justify-center gap-4 flex-wrap">
            <button
              onClick={() => setStep(showAudio ? 4 : 3)}
              className="px-8 py-3 bg-gray-800 text-white hover:bg-gray-700 rounded-lg font-bold transition-colors"
            >
              {showAudio ? "Back to Audio Room" : "Back to Architect Room"}
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
      {step === 6 && showFinal && (
        <div className="glass-card p-6 sm:p-12 animate-in fade-in slide-in-from-right-8 space-y-8 max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <Sparkles size={48} className="text-green-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white">Final Video Ready</h2>
            <p className="text-gray-400 mt-2">{hasStage("avatar") ? "B-rolls and Avatar perfectly stitched." : "Your clips are stitched into the finished reel."}</p>
          </div>

          <div className="space-y-4">
            {/* The reel SHIPPED — these are notes about what it came out like,
                not failures, so they inform rather than interrupt. */}
            {assembleWarnings.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
                <p className="font-semibold flex items-center gap-2">
                  <TriangleAlert size={16} className="shrink-0" /> Worth a look before you publish
                </p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  {assembleWarnings.map((w, i) => (
                    <li key={i} className="break-words">{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {finalAssembledVideoUrl ? (
              <video src={finalAssembledVideoUrl} controls autoPlay className="w-full rounded-xl border border-gray-700 shadow-xl" />
            ) : (
              <div className="p-8 bg-gray-900 border border-gray-800 rounded-xl text-center text-gray-500">Final video failed to load.</div>
            )}
          </div>

          <div className="text-center mt-8 pt-6 border-t border-gray-800 flex justify-center gap-4 flex-wrap">
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
                <p className="text-sm text-gray-400 mb-8 pr-10">Because you selected <strong>Auto</strong>, the AI will evaluate the topic and automatically choose the highest converting format from the options below:</p>
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
                <h3 className="text-xl font-bold text-white mb-2 pr-10">{previewTemplateModal} Example</h3>
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

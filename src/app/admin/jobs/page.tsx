"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, RotateCcw, ExternalLink } from "lucide-react";

// Maps a job's current stage to the route + payload that re-runs it.
// All inputs live on the job row — that's what makes retry possible.
function retryRequest(job: any): [string, any] | null {
  const base = { clientId: job.client_id, jobId: job.id };
  switch (job.current_stage) {
    case "script":
      return ["/api/generate-english", { ...base, topic: job.topic, targetDuration: job.target_duration_sec, forceTemplate: job.template }];
    case "adapt_voice":
      return ["/api/generate-hinglish", { ...base, topic: job.topic, englishScript: job.english_script }];
    case "audio":
      return ["/api/generate-audio", { ...base, text: job.full_script, globalSpeed: job.speech_speed }];
    case "avatar":
      return ["/api/generate-avatar", { ...base, audioUrl: job.audio_url, avatarLabel: job.avatar_label }];
    case "broll_plan":
      return ["/api/generate-broll-plan", { ...base, script: job.full_script, timestamps: job.audio_timestamps, brollFrequency: job.broll_frequency, editorNotes: job.editor_notes }];
    case "assemble":
      return ["/api/assemble-video", { ...base, avatarVideoUrl: job.avatar_video_url, brollPlan: job.broll_plan }];
    default:
      return null;
  }
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = () =>
    fetch("/api/admin/jobs?limit=100")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .finally(() => setIsLoading(false));

  useEffect(() => {
    load();
  }, []);

  const toggleExpand = async (jobId: string) => {
    if (expanded === jobId) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(jobId);
    setDetail(null);
    const d = await fetch(`/api/admin/jobs/${jobId}`).then((r) => r.json());
    setDetail(d);
  };

  const handleRetry = async (job: any) => {
    const req = retryRequest(job);
    if (!req) return alert("Nothing to retry for this stage.");
    const [url, payload] = req;
    if (!confirm(`Re-run stage "${job.current_stage}"? This will call the vendor again.`)) return;
    setRetrying(job.id);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert("Stage completed successfully.");
      await load();
      if (expanded === job.id) await toggleExpand(job.id);
    } catch (err: any) {
      alert("Retry failed: " + err.message);
      await load();
    } finally {
      setRetrying(null);
    }
  };

  const badge = (job: any) => {
    const color =
      job.stage_status === "failed"
        ? "bg-red-500/20 text-red-400 border-red-500/30"
        : job.stage_status === "done"
        ? "bg-green-500/20 text-green-400 border-green-500/30"
        : job.stage_status === "running"
        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
        : "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>{job.current_stage} · {job.stage_status}</span>;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold text-white">Jobs</h1>
        <button onClick={() => { setIsLoading(true); load(); }} className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-semibold transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="glass-card p-6">
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-primary" size={28} /></div>
        ) : jobs.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No jobs yet.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="rounded-xl border bg-indigo-950/30 border-gray-700">
                <button onClick={() => toggleExpand(job.id)} className="w-full flex items-center justify-between gap-4 p-4 text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold truncate">
                      <span className="text-primary">{job.client_id}</span> · {job.topic || "Untitled reel"}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{new Date(job.created_at).toLocaleString()} {job.created_by ? `· ${job.created_by}` : ""}</p>
                  </div>
                  {badge(job)}
                </button>

                {expanded === job.id && (
                  <div className="border-t border-gray-800 p-4 space-y-4">
                    {!detail ? (
                      <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-primary" size={20} /></div>
                    ) : (
                      <>
                        {detail.job.error && (
                          <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-sm text-red-300 font-mono whitespace-pre-wrap">{detail.job.error}</div>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          {detail.job.audio_url && <ArtifactLink href={detail.job.audio_url} label="Audio" />}
                          {detail.job.avatar_video_url && <ArtifactLink href={detail.job.avatar_video_url} label="Avatar video" />}
                          {detail.job.final_video_url && <ArtifactLink href={detail.job.final_video_url} label="Final video" />}
                          {detail.job.broll_plan && (
                            <span className="text-gray-400 px-3 py-2 bg-black/30 rounded-lg border border-gray-700">B-roll plan: {(Array.isArray(detail.job.broll_plan) ? detail.job.broll_plan.length : 0)} clips</span>
                          )}
                        </div>

                        {detail.job.stage_status === "failed" && retryRequest(detail.job) && (
                          <button
                            onClick={() => handleRetry(detail.job)}
                            disabled={retrying === job.id}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                          >
                            {retrying === job.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                            Retry stage &quot;{detail.job.current_stage}&quot;
                          </button>
                        )}

                        <div>
                          <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Event log</h4>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {detail.events.length === 0 ? (
                              <p className="text-xs text-gray-600">No events recorded.</p>
                            ) : (
                              detail.events.map((e: any) => (
                                <div key={e.id} className="flex items-center gap-3 text-xs font-mono">
                                  <span className="text-gray-600 shrink-0">{new Date(e.created_at).toLocaleTimeString()}</span>
                                  <span className="text-gray-300">{e.stage}</span>
                                  <span className={e.event === "failed" ? "text-red-400" : e.event === "succeeded" ? "text-green-400" : "text-gray-400"}>{e.event}</span>
                                  {e.detail && Object.keys(e.detail).length > 0 && (
                                    <span className="text-gray-600 truncate">{JSON.stringify(e.detail)}</span>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary px-3 py-2 bg-black/30 rounded-lg border border-gray-700 hover:border-primary/50 transition-colors">
      <ExternalLink size={14} /> {label}
    </a>
  );
}

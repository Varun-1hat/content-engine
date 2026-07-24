import { NextResponse } from 'next/server';
import { supabaseAdmin } from './clients/loadConfig';
import { normalizeBrollFrequency } from './pipeline/broll';
import { getJobStagePlan, resolveReelStages, validate, type StageName } from './pipeline/stages';

// Job persistence: one row per reel, artifacts written as each stage completes.
// The browser holds a job id, never the artifacts — refresh/resume is free.

export type StageStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobRow {
  id: string;
  client_id: string;
  pipeline_id: string | null;
  stage_plan: string[] | null;
  current_stage: StageName;
  stage_status: StageStatus;
  created_by: string | null;
  topic: string | null;
  template: string | null;
  target_duration_sec: number | null;
  english_script: string | null;
  full_script: string | null;
  script_meta: Record<string, unknown> | null;
  avatar_label: string | null;
  broll_frequency: string | null;
  editor_notes: string | null;
  speech_speed: number | null;
  product_image_urls: string[];
  /** Per-reel: the uploaded product outranks the research doc for TOPIC choice. */
  product_overrides_research: boolean;
  audio_url: string | null;
  audio_timestamps: unknown[] | null;
  avatar_video_url: string | null;
  broll_plan: unknown[] | null;
  final_video_url: string | null;
  provider_job_ids: Record<string, unknown>;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// Fields the PUBLIC PATCH endpoint may write. Deliberately narrow: only things
// a user edits by hand in the Studio. Stage progression, artifact URLs,
// provider ids, stage_plan, pipeline binding are all SERVER-controlled and are
// written via updateJobInternal from the stage routes only. (Hardening N1.)
//
// product_overrides_research is DELIBERATELY ABSENT. It is a per-reel BEHAVIOUR
// flag, and the existing behaviour flag (stage_plan) is absent for the same
// reason: allowing it here would let any authenticated user of the owning client
// flip prompt weighting on an already-created reel and then have an admin retry
// run under different weighting than the reel was ordered under. It is written
// once, by createJob, and every consumer reads it off the row.
const PATCHABLE_FIELDS = new Set([
  'topic',
  'template',
  'target_duration_sec',
  'english_script',
  'full_script',
  'avatar_label',
  'broll_frequency',
  'editor_notes',
  'speech_speed',
]);

export function filterJobPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([k]) => PATCHABLE_FIELDS.has(k)));
}

interface CreateJobOpts {
  pipelineId: string;
  voiceover?: boolean;          // per-reel; false skips adapt_voice/audio/avatar
  injectedScript?: string;      // per-reel; when set, drops topic/script
  productImageUrls?: string[];  // per-reel product photos (Cloudinary URLs)
  brollFrequency?: string;      // per-reel label; normalised against the allowlist
  productOverridesResearch?: boolean; // per-reel; topic-stage prompt weighting
  createdBy?: string;
}

/**
 * Create a reel job bound to a pipeline. Resolves the per-reel stage_plan from
 * the pipeline's enabled_stages + the voiceover / inject-script choices, and
 * seeds an injected script when supplied. Throws (caller maps to 4xx) when the
 * pipeline is unknown, inactive, or belongs to another client.
 */
export async function createJob(clientId: string, opts: CreateJobOpts): Promise<JobRow> {
  const supabase = supabaseAdmin();
  const { data: pipeline, error: pErr } = await supabase
    .from('client_pipelines')
    .select('*')
    .eq('id', opts.pipelineId)
    .maybeSingle();
  if (pErr) throw new Error(`Failed to load pipeline: ${pErr.message}`);
  if (!pipeline || pipeline.client_id !== clientId || !pipeline.active) {
    throw new Error('PIPELINE_INVALID');
  }

  const injectScript = !!opts.injectedScript;
  const stagePlan = resolveReelStages(pipeline.enabled_stages, {
    voiceover: opts.voiceover,
    injectScript,
  });
  // The pipeline was validated when it was saved, but the per-reel toggles above
  // subtract stages from it — and a subset of a valid plan is not necessarily
  // valid (dropping avatar can strand assemble with no visual source). Re-check
  // what this reel will actually run, so a broken plan is refused at creation
  // instead of dead-ending at the stage that can't run.
  const planErrors = validate(stagePlan, { scriptSupplied: injectScript });
  if (planErrors.length) throw new Error(`PLAN_INVALID: ${planErrors.join(' ')}`);

  const productImageUrls = opts.productImageUrls ?? [];
  const insert: Record<string, unknown> = {
    client_id: clientId,
    pipeline_id: pipeline.id,
    stage_plan: stagePlan,
    current_stage: stagePlan[0],
    product_image_urls: productImageUrls,
    // Written HERE, at creation, not when broll_plan completes. The column
    // defaults to 'Standard', so persisting late meant every read before the
    // stage finished — resume, admin retry, the reel record itself — reported a
    // frequency nobody chose.
    broll_frequency: normalizeBrollFrequency(opts.brollFrequency),
    // Only meaningful on a reel that actually has photos: the flag says the
    // uploaded product outranks the research doc, and with no product there is
    // nothing to outrank it with. Closes the "product pipeline, zero photos"
    // case without a 400.
    product_overrides_research: opts.productOverridesResearch === true && productImageUrls.length > 0,
    created_by: opts.createdBy ?? null,
  };
  if (injectScript) {
    insert.english_script = opts.injectedScript;
    // No adapt_voice pass → the injected script IS the final script.
    if (!stagePlan.includes('adapt_voice')) insert.full_script = opts.injectedScript;
  }

  const { data, error } = await supabase.from('jobs').insert(insert).select().single();
  if (error) throw new Error(`Failed to create job: ${error.message}`);
  const job = data as JobRow;
  if (injectScript) {
    await logJobEvent(job.id, 'script', 'succeeded', { source: 'injected' });
  }
  return job;
}

export async function getJob(id: string): Promise<JobRow | null> {
  const { data, error } = await supabaseAdmin().from('jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load job ${id}: ${error.message}`);
  return (data as JobRow) ?? null;
}

export async function listJobs(clientId: string, limit = 50): Promise<any[]> {
  const { data, error } = await supabaseAdmin()
    .from('jobs')
    .select('*, client_pipelines(name)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list jobs for ${clientId}: ${error.message}`);
  return (data ?? []).map((j: any) => ({ ...j, pipeline_name: j.client_pipelines?.name ?? null }));
}

/** Internal writer — unrestricted. Used by stage routes only. */
export async function updateJobInternal(id: string, patch: Record<string, unknown>): Promise<JobRow> {
  if (Object.keys(patch).length === 0) throw new Error('Empty job patch');
  const { data, error } = await supabaseAdmin()
    .from('jobs')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update job ${id}: ${error.message}`);
  return data as JobRow;
}

/** Public writer — filtered to user-editable fields (PATCH /api/jobs/[id]). */
export async function updateJob(id: string, patch: Record<string, unknown>): Promise<JobRow> {
  const filtered = filterJobPatch(patch);
  if (Object.keys(filtered).length === 0) {
    throw new Error('No valid job fields in patch');
  }
  return updateJobInternal(id, filtered);
}

export async function logJobEvent(
  jobId: string,
  stage: string,
  event: 'started' | 'succeeded' | 'failed' | 'retried',
  detail: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('job_events')
    .insert({ job_id: jobId, stage, event, detail });
  // Event logging is diagnostics — never fail the pipeline over it.
  if (error) console.error(`Failed to log job event (${jobId}/${stage}/${event}): ${error.message}`);
}

/**
 * Tenancy guard for stage routes: the jobId in a request body must belong to
 * the claimed client. Returns a ready 404/403 response on mismatch, null when
 * OK. Prevents cross-tenant job writes via a foreign jobId.
 */
export async function jobClientMismatch(jobId: string, clientId: string): Promise<NextResponse | null> {
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (job.client_id !== clientId) {
    return NextResponse.json({ error: 'Job does not belong to this client' }, { status: 403 });
  }
  return null;
}

/**
 * Stage guard: the requested stage must be part of this job's resolved plan.
 * Returns a ready 409 response when the stage was toggled off for this reel.
 */
export function stageNotInPlan(job: JobRow, stage: StageName): NextResponse | null {
  if (!getJobStagePlan(job).includes(stage)) {
    return NextResponse.json(
      { error: `Stage "${stage}" is not part of this reel's pipeline` },
      { status: 409 }
    );
  }
  return null;
}

// --- Stage transitions (used by stage routes) -------------------------------

export async function startStage(jobId: string, stage: StageName): Promise<JobRow> {
  const job = await updateJobInternal(jobId, { current_stage: stage, stage_status: 'running', error: null });
  await logJobEvent(jobId, stage, 'started');
  return job;
}

export async function completeStage(
  jobId: string,
  stage: StageName,
  artifacts: Record<string, unknown> = {}
): Promise<JobRow> {
  const job = await updateJobInternal(jobId, { ...artifacts, current_stage: stage, stage_status: 'done' });
  await logJobEvent(jobId, stage, 'succeeded');
  return job;
}

export async function failStage(jobId: string, stage: StageName, err: unknown): Promise<JobRow> {
  const message = err instanceof Error ? err.message : String(err);
  const job = await updateJobInternal(jobId, { current_stage: stage, stage_status: 'failed', error: message });
  await logJobEvent(jobId, stage, 'failed', { error: message });
  return job;
}

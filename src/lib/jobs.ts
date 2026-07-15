import { NextResponse } from 'next/server';
import { supabaseAdmin } from './clients/loadConfig';
import type { StageName } from './pipeline/stages';

// Job persistence: one row per reel, artifacts written as each stage completes.
// The browser holds a job id, never the artifacts — refresh/resume is free.

export type StageStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobRow {
  id: string;
  client_id: string;
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

// Fields the API's PATCH endpoint may write. Everything else (id, client_id,
// timestamps) is server-controlled.
const PATCHABLE_FIELDS = new Set([
  'current_stage',
  'stage_status',
  'topic',
  'template',
  'target_duration_sec',
  'english_script',
  'full_script',
  'script_meta',
  'avatar_label',
  'broll_frequency',
  'editor_notes',
  'speech_speed',
  'audio_url',
  'audio_timestamps',
  'avatar_video_url',
  'broll_plan',
  'final_video_url',
  'provider_job_ids',
  'error',
]);

export function filterJobPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([k]) => PATCHABLE_FIELDS.has(k)));
}

export async function createJob(clientId: string, createdBy?: string): Promise<JobRow> {
  const { data, error } = await supabaseAdmin()
    .from('jobs')
    .insert({ client_id: clientId, created_by: createdBy ?? null })
    .select()
    .single();
  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return data as JobRow;
}

export async function getJob(id: string): Promise<JobRow | null> {
  const { data, error } = await supabaseAdmin().from('jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load job ${id}: ${error.message}`);
  return (data as JobRow) ?? null;
}

export async function listJobs(clientId: string, limit = 50): Promise<JobRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('jobs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list jobs for ${clientId}: ${error.message}`);
  return (data ?? []) as JobRow[];
}

export async function updateJob(id: string, patch: Record<string, unknown>): Promise<JobRow> {
  const filtered = filterJobPatch(patch);
  if (Object.keys(filtered).length === 0) {
    throw new Error('No valid job fields in patch');
  }
  const { data, error } = await supabaseAdmin()
    .from('jobs')
    .update(filtered)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update job ${id}: ${error.message}`);
  return data as JobRow;
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

// --- Stage transitions (used by stage routes in Phase 2) --------------------

export async function startStage(jobId: string, stage: StageName): Promise<JobRow> {
  const job = await updateJob(jobId, { current_stage: stage, stage_status: 'running', error: null });
  await logJobEvent(jobId, stage, 'started');
  return job;
}

export async function completeStage(
  jobId: string,
  stage: StageName,
  artifacts: Record<string, unknown> = {}
): Promise<JobRow> {
  const job = await updateJob(jobId, { ...artifacts, current_stage: stage, stage_status: 'done' });
  await logJobEvent(jobId, stage, 'succeeded');
  return job;
}

export async function failStage(jobId: string, stage: StageName, err: unknown): Promise<JobRow> {
  const message = err instanceof Error ? err.message : String(err);
  const job = await updateJob(jobId, { current_stage: stage, stage_status: 'failed', error: message });
  await logJobEvent(jobId, stage, 'failed', { error: message });
  return job;
}

// =============================================================================
// SCRIPT (LLM) ADAPTER — base contract
//
// To add a new provider (e.g. anthropic, openai):
//   1. Create ./<provider>.ts exporting a `const <provider>ScriptAdapter: ScriptAdapter`.
//   2. Register it in ./index.ts under its slug: { anthropic: anthropicScriptAdapter }.
//   3. Point a client at it: clients.script_provider = '<slug>' (Supabase).
//
// Rules every implementation must follow:
//   - API keys come from process.env ONLY. Throw early with the env-var name
//     if missing. Never read secrets from the DB or accept them as arguments.
//   - Retries + fallback-model handling live INSIDE the adapter. Callers make
//     exactly one call and never reimplement resilience.
//   - When opts.json is true, request the provider's native JSON mode. Callers
//     still run the result through extractJson() (index.ts) as a safety net.
//   - Return the raw response text. No parsing, no trimming beyond the
//     provider's own artifacts.
// =============================================================================

export interface ScriptGenerateOptions {
  prompt: string;
  system?: string;
  model: string;
  fallbackModel?: string;
  /** Ask the provider for native JSON output (no markdown fences). */
  json?: boolean;
}

export interface ScriptAdapter {
  generate(opts: ScriptGenerateOptions): Promise<string>;
}

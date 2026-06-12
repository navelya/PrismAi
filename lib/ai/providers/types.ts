import { ExecutionContext, NodeExecutionResult } from '@/lib/nodes/types';

export interface ProviderAdapterModel {
  provider_model_id?: string | null;
  replicate_model_id?: string | null;
  inputs_schema?: any;
  outputs_schema?: any;
  [key: string]: any;
}

export interface ProviderAdapterArgs {
  /** The ai_models row (provider_model_id, schemas, etc.). */
  model: ProviderAdapterModel;
  /** API inputs already resolved by api_mapping_key (controls + input handles). */
  inputs: Record<string, any>;
  /** Fan-out index (0 for single runs); used to disambiguate storage paths. */
  iterationIndex: number;
  /** Execution context (executionId, sessionId, nodeId, ...). */
  ctx: ExecutionContext;
}

/**
 * A provider adapter knows the three things that differ per external provider:
 * how to authenticate, how to shape the request, and how to call the API. Sync
 * adapters upload their result bytes to storage and return a permanent { url }
 * in `data`, with status 'success' — which the dispatcher completes through the
 * same path as Replicate's local-sync results.
 */
export interface ProviderAdapter {
  key: string;                       // matches providers.adapter_key
  mode: 'sync' | 'async-webhook';
  execute(args: ProviderAdapterArgs): Promise<NodeExecutionResult>;
}

/**
 * Normalized failure classes the orchestrator acts on, independent of how each
 * provider spells its errors. `transient` = capacity/outage/timeout (failover or
 * retry); `validation` = bad input (terminal); `moderation` = content rejected
 * (terminal, no retry/failover).
 */
export type ErrorClass = 'transient' | 'validation' | 'moderation';

/** Normalized poll result from an async provider. `outputs` are RAW provider URLs
 *  (the completion pipeline mirrors them — adapters never mirror). */
export interface ProviderPollResult {
  status: 'pending' | 'completed' | 'failed';
  outputs?: any;            // raw provider output (URLs/strings/objects), pre-normalization
  error?: string | null;
}

/**
 * Async provider adapter. Separate from the sync `ProviderAdapter` so the sync
 * path (ElevenLabs) never carries dead submit/poll branches. `submit` creates the
 * job and returns its provider id; `poll` is the authoritative completion source;
 * `classifyError` is operation-aware (a 429 on a POLL is back-off, not failover).
 */
export interface AsyncProviderAdapter {
  key: string;                       // matches providers.adapter_key; 'replicate' for the default
  mode: 'async';
  submit(
    model: ProviderAdapterModel,
    inputs: Record<string, any>,
    ctx: ExecutionContext,
    opts?: { webhookUrl?: string }
  ): Promise<{ providerJobId: string; status: 'pending' | 'completed'; outputs?: any }>;
  poll(providerJobId: string): Promise<ProviderPollResult>;
  classifyError(op: 'submit' | 'poll', httpStatus: number | null, body: unknown): ErrorClass;
  fetchSchema?(modelSlug: string): Promise<ProviderSchemaResult>;   // optional; per-provider schema fetch
  parseWebhook?(req: Request): { providerJobId: string } | null;  // optional; Phase B
}

/**
 * Result of a provider schema fetch, normalized for the admin model form. The
 * `openapi_schema` is shaped so the shared parseReplicateSchema() can read it:
 * `components.schemas.Input` (+ optional `Output`). `display_name`/`description`
 * are the provider's own metadata when available (so the form doesn't guess from
 * the slug).
 */
export interface ProviderSchemaResult {
  openapi_schema: any;
  display_name?: string;
  description?: string;
}

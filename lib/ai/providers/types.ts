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

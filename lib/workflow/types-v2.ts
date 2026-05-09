/**
 * Workflow Engine v2 - Type Definitions
 * Shared types for the new execution engine
 */

export interface NodeConfig {
  id: string;
  type: string;
  data: {
    label?: string;
    model?: string;
    prompt?: string;
    version?: string;
    input?: Record<string, any>;
    [key: string]: any;
  };
  position?: { x: number; y: number };
}

export interface EdgeConfig {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface GraphJson {
  nodes: NodeConfig[];
  edges: EdgeConfig[];
  // Inputs precomputed by the start route for nodes whose parents include
  // generative ancestors outside the execution set. The orchestrator merges
  // these into the inputs map at dispatch time so non-root nodes still
  // receive ancestor values across the in-process and webhook boundaries.
  preseedInputs?: Record<string, Record<string, any>>;
}

export interface NodeState {
  status: 'pending' | 'running' | 'completed' | 'failed';
  result_type?: 'image' | 'video' | 'audio' | '3d' | 'text' | 'json';
  result_data?: any[];
  result_url?: string; // legacy
  replicate_prediction_id?: string;
  dispatched_at?: string;
  completed_at?: string;
  error?: string;
  output?: any;
}

export interface ExecutionV2 {
  id: string;
  session_id: string;
  user_id: string;
  graph_json: GraphJson;
  node_states: Record<string, NodeState>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface ExecutionEvent {
  id: number;
  execution_id: string;
  node_id: string;
  event_type: 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retried';
  correlation_id: string;
  payload: Record<string, any>;
  created_at: string;
}

/**
 * Replicate-specific types
 */
export interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: any;
  error?: string;
  urls: {
    get: string;
    cancel?: string;
  };
}

/**
 * Node persistence types (compatible with existing canvas state)
 */
export type NodePersistence = 'persistent' | 'ephemeral';

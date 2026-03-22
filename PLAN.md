Workflow Engine — Full System Architecture

The Foundation: Two Types of Nodes
Every decision in this system flows from one classification.
Persistent Nodes produce a stored file. Their output is saved to Supabase Storage and the resulting URL is written back into the workflow data permanently. Future runs can reuse this URL without re-executing the node. The two persistent node types are the Generative AI node (executes via Replicate) and the Image Input node (uploaded immediately when the user drops a file onto the canvas, before any run is triggered).
Ephemeral Nodes produce no stored output. They are pure functions — given the same inputs and properties they always produce the same result. Their output exists only as a temporary buffer during execution. Examples: Blur, Levels, Curves, Compositor, Color Grade, Prompt text, Mask.
This classification is stored explicitly on every node as a persistence field. The engine reads this field to decide how to handle the node. Nothing else in the system needs to know what a node does internally.

Database — The Minimal Required Tables
workflows
id, user_id, name, graph_json, updated_at
The graph_json column is the live working state of the canvas. It contains two arrays — nodes and edges. Each node object carries: id, type, persistence, properties, result_url (null until a successful execution populates it), and an inputs map of slot names to upstream node IDs. Each edge carries: from_node_id, from_port, to_node_id, to_port.
When a persistent node completes an execution, its result_url is written back here. This means the canvas always reflects the last known good output for every persistent node.
executions
id, workflow_id, graph_snapshot, status, node_states, created_at, updated_at
graph_snapshot — a full copy of graph_json at the exact moment the run was triggered. This is immutable for the lifetime of the execution. The engine always reads from the snapshot, never from the live graph_json, so changes the user makes to the canvas mid-run do not corrupt the execution.
status — one of: pending, running, completed, failed, cancelled.
node_states — a JSON object keyed by node ID. This is the heartbeat of the entire execution. Every node entry contains:

status — pending, running, completed, failed
result_ref — the output reference once the node completes. For persistent nodes this is a permanent Supabase Storage URL. For ephemeral nodes this is a temporary Supabase Storage URL in the ephemeral bucket.
input_hash — a hash derived from the node's properties and its resolved input refs. Used for future result caching.
replicate_prediction_id — populated when a generative node is dispatched. Used for cancellation and stuck-node recovery.
dispatched_at, completed_at, error — for observability and timeout detection.

assets
id, user_id, workflow_id, node_id, execution_id, s3_key, url, mime_type, created_at
Every file written to permanent Supabase Storage by any execution gets a row here. Ephemeral temp files do not get a row here — they live and die in the ephemeral bucket via TTL.

Storage — Two Buckets, Two Lifecycles
workflow-assets — permanent storage. Holds Image Input uploads and final Generative node outputs. Files here are referenced in graph_json node result_url fields and in the assets table. Never auto-deleted.
workflow-ephemeral-tmp — temporary storage. Holds intermediate ephemeral node outputs produced during execution. Files here are referenced only in node_states result_ref fields. A pg_cron job runs every hour and deletes any file older than 4 hours. The execution completion handler also deletes these files explicitly on run finish. Belt and suspenders.

Frontend Architecture
The Canvas and Node Rendering
Every node on the canvas is rendered by a single host component. The host owns the visual frame, the input and output ports, drag and drop behavior, selection state, connection wiring, and the status indicator (idle, running, completed, failed). The host is completely type-agnostic.
Each node type registers a body component in a client-side registry — a plain map of type → component. The host mounts the correct body for node.type. The body renders that node's specific controls, parameter sliders, and output preview.
This means the graph engine and state management never branch on node type. Type is only consulted in two places in the entire system: at render time to select which body to mount, and at execution time to select which server handler to call. Everything else treats all nodes identically.
The Client-Side Resolved Value Store
The frontend maintains a reactive map of node_id → current_output_value. This drives live preview for ephemeral nodes without touching the server.
When a user adjusts the radius on a Blur node, the client walks the upstream graph, collects inputs from the resolved value store, applies the blur locally using Canvas API or WebGL, and updates the preview in real time. Persistent nodes seed this store with their result_url. Ephemeral nodes compute their contribution from upstream values.
This store is purely local. It is used for interactive editing. It has no connection to execution.
Connection Validation
When the user attempts to draw a connection between two ports, the frontend validates two things before allowing it: type compatibility between the output port and the input port, and whether adding this edge would create a cycle in the graph. Cycle detection runs a depth-first search from the target node to see if the source node is reachable. If it is, the connection is rejected with a clear visual indicator. The user should never be able to build an invalid graph.
Execution Progress
When a run starts, the client receives an execution ID and immediately subscribes to that execution row via Supabase Realtime. As node_states updates arrive, the canvas reflects each node's live status. When a persistent node's result_url is written back into graph_json, the node's preview updates automatically. The client never polls. Everything is push-driven.
Cancellation
The canvas exposes a cancel button during an active run. Pressing it calls /api/executions/cancel with the execution ID. The client does not need to do anything else — the server handles the rest and the Realtime subscription delivers the final cancelled status.

Server Architecture
API Routes Overview
POST /api/executions/start — validate the graph, create the execution row, dispatch root nodes.
POST /api/executions/cancel — mark the execution cancelled, cancel in-flight Replicate predictions.
POST /api/webhooks/replicate — called by Replicate when a prediction completes. Verify signature, resolve the node, call check-and-dispatch.
POST /api/executions/dispatch-ephemeral — internal route called to process an ephemeral node. Exists as a separate route to avoid serverless timeout issues on long chains.
/api/executions/start
Receives the workflow ID. Loads graph_json. Runs a topological sort on the node graph. If a cycle is detected, returns a 400 error immediately — the run is rejected. No execution row is created.
If the graph is valid, creates the execution row: copies graph_json into graph_snapshot, sets status to running, builds the initial node_states object with every node set to pending.
Identifies all root nodes — nodes whose input slots are either empty or connected only to Image Input nodes (which are already resolved). For Image Input nodes specifically, immediately marks them as completed in node_states and populates their result_ref from their existing result_url.
Dispatches all non-Image-Input root nodes simultaneously. For each one, calls the dispatch function appropriate to its persistence type. Returns the execution ID to the client.
The Dispatch Function
This is called whenever a node is ready to run. It takes the execution row and the node ID.
For a persistent / generative node: resolves all input values from node_states, assembles the Replicate prediction payload, submits the prediction to Replicate with the webhook URL set to /api/webhooks/replicate and the metadata set to { execution_id, node_id }, atomically updates node_states for this node to running with replicate_prediction_id and dispatched_at populated.
For an ephemeral node: calls /api/executions/dispatch-ephemeral as a fire-and-continue internal POST, passing execution ID and node ID. This separates ephemeral processing into its own invocation to avoid timeouts on long chains.
/api/executions/dispatch-ephemeral
Loads the execution row. Resolves all inputs for the target node from node_states — downloads temp file buffers from Supabase Storage as needed. Looks up the node type in the server-side handler registry. Calls registry[node.type](properties, resolvedInputs). Receives an output buffer.
Writes the output buffer to the ephemeral bucket at a path structured as ephemeral/{execution_id}/{node_id}/{timestamp}. Atomically updates node_states for this node to completed with the temp URL as result_ref and completed_at populated. Then calls check-and-dispatch.
The Server-Side Handler Registry
A plain object on the server. Maps node type strings to pure handler functions. Each handler signature is (properties, inputs) → outputBuffer. Examples:

blur — receives an image buffer, applies Gaussian blur using Sharp or similar, returns a buffer
levels — receives an image buffer, applies tonal curve adjustments, returns a buffer
compositor — receives two or more image buffers and blend mode properties, composites them, returns a buffer
prompt — receives nothing, returns its text property as a string value directly

Adding a new ephemeral node type means adding one function to this registry. The engine never changes.
/api/webhooks/replicate
The first thing this route does — before anything else — is verify the Replicate webhook signature using the signing secret. If verification fails, return 401 and do nothing.
Reads execution_id and node_id from the prediction metadata. Loads the execution row. Checks if execution status is cancelled — if so, discard the result entirely and return 200. Replicate expects a 200 even for discarded results.
If the prediction failed on Replicate's side, atomically update node_states for the node to failed with the error detail. Then check whether any other nodes are still running. If not, mark the execution as failed. Return 200.
If the prediction succeeded, take the result URL from the Replicate payload. Write the URL into node_states for this node as result_ref, mark it completed, and also write it back into graph_json on the live workflow row as this node's result_url. This live write is what triggers the canvas preview update via Realtime. Then call check-and-dispatch.
Check-and-Dispatch
This function runs after every node completion — whether from an ephemeral handler or a Replicate webhook. It is the single driver of forward progress in the system.
It loads the current node_states. It looks at every node that lists the just-completed node as a direct input. For each downstream neighbor it checks whether all of that node's inputs are now completed in node_states.
If all inputs are satisfied, it attempts to atomically update that node from pending to running using a conditional Postgres update — UPDATE executions SET node_states = ... WHERE id = $1 AND node_states->'{node_id}'->>'status' = 'pending'. If the update affects zero rows, another invocation already dispatched this node — this invocation does nothing. If the update succeeds, dispatch the node.
This atomic conditional update is the sole guard against double-dispatch. It is non-negotiable. Without it, concurrent webhook arrivals will submit duplicate Replicate predictions.
After dispatching downstream nodes, check-and-dispatch counts all nodes with status completed or failed. If that count equals total nodes, the execution is finished. Call the completion handler.
Completion Handler
Marks the execution row status as completed (or failed if any node failed). Writes final execution timestamps. Deletes all ephemeral temp files referenced in node_states from Supabase Storage. The client receives the status change via Realtime.
/api/executions/cancel
Loads the execution row. If status is already completed or failed, return early — nothing to cancel. Atomically sets execution status to cancelled. Iterates through node_states and collects every replicate_prediction_id where status is running. For each one, calls the Replicate API to cancel the prediction. Runs the ephemeral temp file cleanup. Returns 200.
Stuck Node Recovery — pg_cron Job
A pg_cron job runs every 15 minutes. It queries the executions table for any row with status running. For each running execution, it inspects node_states for any node with status running and a dispatched_at older than 15 minutes. For each such node, it checks the Replicate API using the stored replicate_prediction_id to get the real prediction status. If Replicate reports the prediction as failed or cancelled, it marks the node as failed in node_states and triggers completion handling. If Replicate reports it as still running, it leaves it alone. This prevents executions from hanging indefinitely due to missed webhooks.

The Full Execution Lifecycle — Concrete Example
Graph: ImageInput → Blur → Compositor ← GenerativeNode
Compositor takes two inputs: the Blur output on one port and the GenerativeNode output on another port.
Step 1. User presses Run. /api/executions/start loads the graph, validates no cycles, creates the execution row. ImageInput is already resolved — its result_url exists from upload time. It is immediately marked completed in node_states. Root nodes to dispatch: GenerativeNode (no upstream dependencies other than a prompt property) and implicitly Blur is now triggered because ImageInput just completed — check-and-dispatch fires for ImageInput and finds Blur is ready.
Step 2. Blur dispatches as an ephemeral node. Its handler runs: downloads the ImageInput file buffer from Supabase Storage, applies the blur, writes the blurred buffer to the ephemeral bucket, marks Blur completed. Check-and-dispatch fires for Compositor. Compositor checks its inputs: Blur is completed, GenerativeNode is running. Not ready. Nothing dispatched.
Step 3. Simultaneously, GenerativeNode was submitted to Replicate in Step 1. Replicate finishes and fires the webhook to /api/webhooks/replicate. Signature verified. Execution is not cancelled. Result URL received. GenerativeNode marked completed in node_states. Result URL written back to graph_json — canvas preview updates live. Check-and-dispatch fires for Compositor. Compositor checks its inputs: Blur is completed, GenerativeNode is completed. All inputs satisfied.
Step 4. Compositor dispatches as ephemeral. Handler runs: downloads the Blur buffer and the GenerativeNode result, composites them according to blend mode properties, writes the final output to workflow-assets permanently (Compositor is the terminal output node in this example — final outputs go to permanent storage). Compositor marked completed.
Step 5. Check-and-dispatch runs. All nodes completed. Completion handler fires. Ephemeral temp files deleted. Execution marked completed. Client receives final status via Realtime. Canvas shows all nodes green.

What This System Does Not Do Yet — Intentionally
Result caching by input hash. The input_hash field is already being written to node_states to make this addable later. When implemented, a persistent node whose properties and input refs hash to the same value as a previous successful execution will reuse the stored result URL without re-running. This will significantly reduce Replicate costs for iterative workflows.
Execution history UI. The executions table accumulates all runs naturally. A history view is a read query — no schema changes needed when you build it.
Per-node retries. Currently a failed node fails the execution. A retry mechanism would re-dispatch only the failed node and continue from there. The node_states structure supports this without schema changes.

---

## CURRENT IMPLEMENTATION ANALYSIS
**Analyst:** Claude Sonnet 4.5  
**Date:** 2026-03-20

### 1. What the System is Currently Doing

#### Current Database Structure
The system has evolved significantly from the intended architecture above. It currently uses:

**Primary Tables:**
- `sessions` (not `workflows`) - Stores canvas state in `canvas_state` JSONB column
- `messages` - Chat messages linked to sessions
- `node_executions` - Recently added table for execution state (Phase 3 fix)
- `images` - Image metadata
- `workflows`, `nodes`, `edges`, `executions` - **EXIST BUT UNUSED** - Created in migrations but parallel to sessions
- `node_output_cache`, `node_types`, `ai_models`, `categories`, `node_archetypes`, `ui_collections` - Admin/registry tables

**Critical Architectural Issues:**
1. **Dual Graph Storage:** Canvas state stored in both `sessions.canvas_state` (active) AND separate `workflows`/`nodes`/`edges` tables (unused)
2. **No graph_snapshot:** Executions don't capture immutable graph state
3. **No node_states JSONB:** Currently using separate `node_executions` table per node
4. **Chat-First Design:** System built around chat interface with sessions, not workflow-first
5. **Auto-save Complexity:** Real-time auto-save of entire canvas_state causing race conditions
6. **Mixed Concerns:** Canvas layout, node config, and execution results all tangled in canvas_state

#### Current Execution Flow
1. User clicks "Run Workflow" from chat or canvas
2. `POST /api/workflow/execute` receives entire workflow from client
3. Server validates workflow, creates execution context in memory
4. Executes nodes using `workflow-engine.ts` with topological sort
5. For each node:
   - Writes status to `node_executions` table (via Phase 3 fix)
   - Executes node handler
   - For AI nodes: submits to Replicate with webhook callback
6. Webhook `/api/webhooks/replicate` updates `node_executions` on completion
7. Client subscribes to `node_executions` postgres_changes for real-time updates
8. **No execution history** - executions are ephemeral, only current state tracked

#### What Works Currently
- ✅ Canvas drag-and-drop with React Flow
- ✅ Node type registry (ai_models, node_types tables)
- ✅ Image upload to chat-assets bucket
- ✅ AI generation via Replicate with webhook callbacks
- ✅ Real-time status updates via Supabase Realtime
- ✅ Auto-save of canvas state (though problematic)
- ✅ Chat-driven workflow creation

#### What Doesn't Work / Missing
- ❌ No immutable execution snapshots
- ❌ No execution history persistence
- ❌ Unused workflows/nodes/edges tables create confusion
- ❌ No ephemeral storage bucket (all outputs permanent)
- ❌ No distinction between persistent vs ephemeral nodes
- ❌ No check-and-dispatch pattern (executes all nodes eagerly)
- ❌ No atomic node state updates (race conditions possible)
- ❌ No cancellation support
- ❌ No stuck node recovery
- ❌ No result caching by input hash

---

### 2. Implementation Plan: Minimal Working Workflow System

This plan simplifies the system to match the PLAN.md architecture while removing unnecessary complexity and unused tables.

#### Phase 1: Database Schema Cleanup & Restructuring

**A. Drop Unused Tables**
These tables exist but are not used by the current execution system:
```sql
DROP TABLE IF EXISTS public.nodes CASCADE;
DROP TABLE IF EXISTS public.edges CASCADE;  
DROP TABLE IF EXISTS public.node_output_cache CASCADE;
DROP TABLE IF EXISTS public.session_versions CASCADE;
```
**Reason:** These create confusion. Canvas graph is already in `sessions.canvas_state`. We'll use a single source of truth.

**B. Rename & Restructure Sessions Table**
The `sessions` table is actually serving as "workflows". Let's clarify:
```sql
-- Keep sessions table but treat it as workflows conceptually
-- Add graph_json column (rename canvas_state semantically)
ALTER TABLE sessions RENAME COLUMN canvas_state TO graph_json;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS description TEXT;

-- Keep: id, user_id, title (as name), graph_json, created_at, updated_at
-- Remove chat-specific columns later in Phase 2
```

**C. Restructure Executions Table**
Current `executions` table is unused. Replace with proper structure:
```sql
DROP TABLE IF EXISTS public.executions CASCADE;

CREATE TABLE public.executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    graph_snapshot JSONB NOT NULL, -- Immutable copy of graph_json at run time
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    node_states JSONB NOT NULL DEFAULT '{}'::jsonb, -- Keyed by node_id: {status, result_ref, input_hash, replicate_prediction_id, dispatched_at, completed_at, error}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_executions_workflow ON executions(workflow_id);
CREATE INDEX idx_executions_status ON executions(status);
CREATE INDEX idx_executions_created ON executions(created_at DESC);

-- RLS policies
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY executions_access ON executions FOR ALL
    USING (workflow_id IN (SELECT id FROM sessions WHERE user_id = auth.uid()));
```

**D. Remove node_executions Table**
```sql
DROP TABLE IF EXISTS node_executions CASCADE;
```
**Reason:** With `node_states` JSONB in executions table, this separate table is redundant. The PLAN.md architecture uses a single JSONB column for all node states within an execution.

**E. Create Assets Table**
```sql
CREATE TABLE IF NOT EXISTS public.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    execution_id UUID REFERENCES executions(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL, -- Full storage path
    url TEXT NOT NULL, -- Public URL
    mime_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_workflow ON assets(workflow_id);
CREATE INDEX idx_assets_execution ON assets(execution_id);
CREATE INDEX idx_assets_node ON assets(workflow_id, node_id);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY assets_access ON assets FOR ALL
    USING (user_id = auth.uid());
```

**F. Create Ephemeral Storage Bucket**
```sql
-- Create ephemeral bucket with TTL
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('workflow-ephemeral-tmp', 'workflow-ephemeral-tmp', false, 52428800, ARRAY['image/*']) -- 50MB limit
ON CONFLICT (id) DO NOTHING;

-- Policies for ephemeral bucket
CREATE POLICY "Authenticated users can upload ephemeral" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'workflow-ephemeral-tmp' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read ephemeral" ON storage.objects
    FOR SELECT USING (bucket_id = 'workflow-ephemeral-tmp' AND auth.role() = 'authenticated');

CREATE POLICY "System can delete ephemeral" ON storage.objects
    FOR DELETE USING (bucket_id = 'workflow-ephemeral-tmp');
```

---

#### Phase 2: Update graph_json Structure

**Current Structure** (in canvas_state):
```typescript
{
  nodes: [
    {
      id: string,
      type: string,
      position: {x, y},
      data: {
        label, config, status?, output?, outputMetadata?
      }
    }
  ],
  edges: [...]
}
```

**New Structure** (in graph_json):
```typescript
{
  nodes: [
    {
      id: string,
      type: string,
      persistence: 'persistent' | 'ephemeral', // NEW - Critical classification
      position: {x, y},
      properties: {...}, // Node-specific config (blur radius, prompt text, etc.)
      result_url: string | null, // For persistent nodes only
      inputs: {
        [slotName]: upstream_node_id // e.g., {image: 'node-123'}
      }
    }
  ],
  edges: [
    {
      from_node_id: string,
      from_port: string,
      to_node_id: string,
      to_port: string
    }
  ]
}
```

**Migration Strategy:**
- Write converter function to transform old canvas_state format to new graph_json format
- Run migration to update all existing sessions
- Update frontend components to use new structure
- **Key Change:** Store edge connections in both edge array AND node.inputs map for fast lookups

---

#### Phase 3: Execution Engine Rewrite

**A. New API Routes**

**Create `/app/api/executions/start/route.ts`:**
```typescript
export async function POST(req: Request) {
  const { workflow_id } = await req.json();
  
  // 1. Load graph_json from sessions table
  // 2. Run topological sort - detect cycles
  // 3. Create execution row with graph_snapshot copy
  // 4. Build initial node_states with all nodes = 'pending'
  // 5. Identify root nodes (no inputs OR inputs are already-resolved ImageInput)
  // 6. For ImageInput nodes: mark completed immediately, copy result_url to result_ref
  // 7. Dispatch all other root nodes
  // 8. Return execution_id
}
```

**Create `/app/api/executions/cancel/route.ts`:**
```typescript
export async function POST(req: Request) {
  const { execution_id } = await req.json();
  
  // 1. Load execution row
  // 2. If already completed/failed, return early
  // 3. Atomically set status = 'cancelled'
  // 4. Iterate node_states, collect all replicate_prediction_ids where status='running'
  // 5. Cancel each prediction via Replicate API
  // 6. Run ephemeral cleanup
  // 7. Return success
}
```

**Create `/app/api/executions/dispatch-ephemeral/route.ts`:**
```typescript
export async function POST(req: Request) {
  const { execution_id, node_id } = await req.json();
  
  // 1. Load execution row
  // 2. Get node from graph_snapshot
  // 3. Resolve all inputs from node_states (download buffers as needed)
  // 4. Lookup handler: handlerRegistry[node.type]
  // 5. Execute: outputBuffer = handler(node.properties, resolvedInputs)
  // 6. Upload outputBuffer to ephemeral bucket
  // 7. Atomically update node_states: status='completed', result_ref=tempURL
  // 8. Call checkAndDispatch(execution_id, node_id)
}
```

**Update `/app/api/webhooks/replicate/route.ts`:**
```typescript
export async function POST(req: Request) {
  // 1. Verify webhook signature (CRITICAL - must be first)
  // 2. Extract execution_id, node_id from prediction.metadata
  // 3. Load execution row
  // 4. If execution.status === 'cancelled', return 200 and discard
  // 5. If prediction.status === 'failed':
  //    - Update node_states: status='failed', error=prediction.error
  //    - Check if all nodes done -> mark execution failed
  // 6. If prediction.status === 'succeeded':
  //    - resultURL = prediction.output[0]
  //    - Update node_states: status='completed', result_ref=resultURL
  //    - ALSO update sessions.graph_json: nodes[nodeId].result_url = resultURL
  //    - Create row in assets table
  //    - Call checkAndDispatch(execution_id, node_id)
  // 7. Return 200
}
```

**B. Core Engine Functions**

**Create `/lib/workflow/check-and-dispatch.ts`:**
```typescript
export async function checkAndDispatch(execution_id: string, completed_node_id: string) {
  // 1. Load execution row (for latest node_states)
  // 2. Load graph_snapshot
  // 3. Find all downstream nodes that depend on completed_node_id
  // 4. For each downstream node:
  //    a. Check if ALL its inputs are completed in node_states
  //    b. If yes, attempt atomic update:
  //       UPDATE executions 
  //       SET node_states = jsonb_set(..., '{node_id,status}', '"running"')
  //       WHERE id = $1 AND node_states->'node_id'->>'status' = 'pending'
  //    c. If update affects 1 row: WE own dispatch -> call dispatch(node)
  //    d. If update affects 0 rows: Another process already dispatched -> skip
  // 5. After all dispatches, check completion:
  //    - Count nodes with status IN ('completed', 'failed')
  //    - If count == total nodes: call completionHandler()
}
```

**Create `/lib/workflow/dispatch.ts`:**
```typescript
export async function dispatchNode(execution_id: string, node_id: string, node: GraphNode) {
  if (node.persistence === 'persistent') {
    // Generative AI node
    // 1. Resolve inputs from node_states
    // 2. Build Replicate prediction payload
    // 3. Submit prediction with webhook URL and metadata: {execution_id, node_id}
    // 4. Update node_states: status='running', replicate_prediction_id, dispatched_at
  } else {
    // Ephemeral node
    // 1. Call POST /api/executions/dispatch-ephemeral internally (fire-and-forget)
    // 2. That route handles the rest
  }
}
```

**Create `/lib/workflow/completion-handler.ts`:**
```typescript
export async function handleExecutionCompletion(execution_id: string) {
  // 1. Load execution row
  // 2. Check if any node has status='failed'
  // 3. Set execution.status = 'completed' or 'failed' accordingly
  // 4. Set execution.completed_at = NOW()
  // 5. Collect all result_ref values from node_states where ref starts with 'ephemeral/'
  // 6. Delete those files from workflow-ephemeral-tmp bucket
  // 7. Update execution row
  // 8. Client gets update via Realtime subscription
}
```

**C. Server-Side Handler Registry**

**Create `/lib/workflow/handlers/index.ts`:**
```typescript
import { blurHandler } from './blur';
import { levelsHandler } from './levels';
import { compositorHandler } from './compositor';
import { promptHandler } from './prompt';

export const handlerRegistry = {
  'blur': blurHandler,
  'levels': levelsHandler,
  'compositor': compositorHandler,
  'prompt': promptHandler,
  // Add more as needed
};

export type HandlerFunction = (
  properties: Record<string, any>,
  inputs: Record<string, Buffer | string>
) => Promise<Buffer | string>;
```

**Example: `/lib/workflow/handlers/blur.ts`:**
```typescript
import sharp from 'sharp';

export async function blurHandler(
  properties: { radius: number },
  inputs: { image: Buffer }
): Promise<Buffer> {
  const blurred = await sharp(inputs.image)
    .blur(properties.radius || 5)
    .toBuffer();
  return blurred;
}
```

---

#### Phase 4: Frontend Updates

**A. Remove Auto-Save During Execution**
- Current issue: auto-save overwrites execution state
- Solution: Lock auto-save when execution is active
- Already partially implemented in Phase 1-2 fixes

**B. Update Canvas State Management**
- Change from `canvas_state` to `graph_json` naming
- Add `persistence` field to all nodes in node registry
- Update node component to read `result_url` instead of `data.output`

**C. Add Execution Subscription**
```typescript
// In workflow canvas component
useEffect(() => {
  if (!executionId) return;
  
  // Subscribe to execution row
  const channel = supabase
    .channel(`execution-${executionId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'executions',
      filter: `id=eq.${executionId}`
    }, (payload) => {
      const { status, node_states } = payload.new;
      
      // Update UI with node statuses from node_states
      Object.entries(node_states).forEach(([nodeId, state]) => {
        updateNodeStatus(nodeId, state.status);
      });
      
      // If execution completed, fetch updated graph_json for result_url updates
      if (status === 'completed' || status === 'failed') {
        refetchWorkflow();
      }
    })
    .subscribe();
    
  return () => { supabase.removeChannel(channel); };
}, [executionId]);
```

**D. Add Cancel Button**
```typescript
async function handleCancel() {
  await fetch('/api/executions/cancel', {
    method: 'POST',
    body: JSON.stringify({ execution_id: activeExecutionId })
  });
}
```

---

#### Phase 5: Cleanup & Migration

**A. Remove Old Execution Code**
Delete or deprecate:
- `/app/api/workflow/execute/route.ts` (replace with /api/executions/start)
- `/lib/db/node-state.ts` (node_states now in executions.node_states JSONB)
- `/lib/workflow-engine.ts` (replace with new engine in /lib/workflow/)

**B. Message Table Cleanup**
Decision point: Keep messages table for chat history but decouple from execution:
- Messages can reference workflow_id (session_id) and execution_id
- Workflow runs are logged in executions table
- Messages table is just for chat UI history

**C. Migration Script**
```typescript
// Convert all existing canvas_state to graph_json format
// Add persistence field to all nodes (default: 'ephemeral')
// For ai_generator nodes, set persistence: 'persistent'
// For media_input nodes, set persistence: 'persistent'
```

---

#### Phase 6: Edge Cases & Robustness

**A. Double-Dispatch Prevention**
- ✅ Atomic conditional UPDATE in checkAndDispatch
- Test: Submit same workflow twice rapidly
- Expected: Only one execution created

**B. Webhook Race Conditions**
- ✅ Webhook handler checks execution.status before processing
- Test: Cancel execution while webhook is in-flight
- Expected: Webhook result discarded, returns 200

**C. Stuck Node Recovery (pg_cron)**
```sql
-- Create pg_cron job
SELECT cron.schedule(
  'recover-stuck-nodes',
  '*/15 * * * *', -- Every 15 minutes
  $$
  -- Call recovery function
  SELECT recover_stuck_executions();
  $$
);
```

```typescript
// Recovery function checks Replicate API for real status
async function recoverStuckExecutions() {
  // Find running executions with nodes stuck >15min
  // Check Replicate API for each replicate_prediction_id
  // Update node_states based on real status
  // Trigger completion if needed
}
```

**D. Ephemeral Cleanup (pg_cron)**
```sql
SELECT cron.schedule(
  'cleanup-ephemeral-files',
  '0 * * * *', -- Every hour
  $$
  -- Delete files older than 4 hours
  DELETE FROM storage.objects
  WHERE bucket_id = 'workflow-ephemeral-tmp'
  AND created_at < NOW() - INTERVAL '4 hours';
  $$
);
```

**E. Cycle Detection**
```typescript
function detectCycle(graph: GraphJson, newEdge: Edge): boolean {
  // DFS from target node to see if source is reachable
  // If reachable, adding this edge creates cycle
  // Reject connection at frontend level
}
```

---

### Summary: What Gets Removed vs Changed

**REMOVED:**
- ❌ `nodes` table (unused)
- ❌ `edges` table (unused)
- ❌ `node_executions` table (replaced by executions.node_states JSONB)
- ❌ `node_output_cache` table (unused)
- ❌ `session_versions` table (unused)
- ❌ Old `/api/workflow/execute` route
- ❌ `lib/db/node-state.ts`
- ❌ Current `lib/workflow-engine.ts` (rewritten)

**CHANGED:**
- 🔄 `sessions.canvas_state` → `sessions.graph_json` (semantic rename)
- 🔄 `executions` table (complete restructure with graph_snapshot + node_states)
- 🔄 Node structure: add `persistence` field, `result_url` field, `inputs` map
- 🔄 Edge structure: simpler {from_node_id, from_port, to_node_id, to_port}
- 🔄 Execution flow: immutable snapshots, atomic dispatching, webhook-driven

**ADDED:**
- ✅ `assets` table for permanent storage tracking
- ✅ `workflow-ephemeral-tmp` storage bucket
- ✅ `/api/executions/start` route
- ✅ `/api/executions/cancel` route
- ✅ `/api/executions/dispatch-ephemeral` route
- ✅ `/lib/workflow/check-and-dispatch.ts`
- ✅ `/lib/workflow/dispatch.ts`
- ✅ `/lib/workflow/completion-handler.ts`
- ✅ `/lib/workflow/handlers/` registry
- ✅ pg_cron jobs for recovery and cleanup
- ✅ Frontend execution subscription

**PRESERVED:**
- ✅ `sessions` table (conceptually "workflows")
- ✅ `messages` table (chat history)
- ✅ `images` table (metadata)
- ✅ Admin tables: `node_types`, `ai_models`, `categories`, etc.
- ✅ `/api/webhooks/replicate` (updated logic)
- ✅ Canvas rendering components (updated to new structure)
- ✅ Supabase Realtime subscriptions
- ✅ Auth and RLS policies

---

This plan creates a **minimal, working workflow execution system** that matches the PLAN.md architecture while removing all unused tables and complexity. The result is a clean, maintainable system with proper execution history, atomic node dispatching, and clear separation between canvas state and execution state.

---

## ANTIGRAVITY IMPLEMENTATION OVERHAUL
**Analyst:** Antigravity  
**Date:** March 2026

### 1. What the System is Currently Doing
At present, the application's runtime lacks the solid, decoupled architecture defined in the specification. 
- **Fragmented Data Model**: The workflow state is maintained inside the `sessions` table (under `canvas_state`), but execution state is pushed into a completely separate `node_executions` table. There are also dangling, unused tables (`workflows`, `nodes`, `edges`, `executions`) that were created but abandoned, creating clutter.
- **Mutable Execution State**: When a user clicks "Run", the system does not capture an immutable snapshot. Changes made to the canvas mid-execution can desync the expected state.
- **Eager Execution & Lack of Check-and-Dispatch**: The execution engine (`workflow-engine.ts`/`/api/workflow/execute`) drives graph traversal from memory on the server rather than utilizing a pure event-driven `check-and-dispatch` mechanism.
- **State Race Conditions**: Supabase webhooks from Replicate update `node_executions` individually, but do not use atomic conditional JSON updates to safely process downstream nodes, leading to race conditions.
- **Storage Smear**: Everything is stored as permanent assets. There is no distinction between transient node outputs (like a temporary 'Blur' image) and final persistent results.
- **Missing Lifecycle Hooks**: The system lacks cancellation endpoints, stuck-node recovery cron jobs, and temporary file cleanup mechanisms.

### 2. Implementation Plan: Minimal Working Workflow Solution

Our goal is to ruthlessly prune the existing clutter and implement the exact immutable, check-and-dispatch architecture detailed in the blueprint.

#### Phase 1: Aggressive Schema Pruning & Consolidation
**Goal:** Remove extraneous tables and unify the workflow engine around `sessions` and `executions`.
1. **Drop Unused Tables**: Completely drop `nodes`, `edges`, `node_executions`, `node_output_cache`, `session_versions`, and `workflows` (we'll adapt `sessions` to act as the primary workflow container).
2. **Setup the `executions` Table**: Create a robust `executions` table linked to `sessions`. 
   - `id` (UUID), `session_id` (FK to sessions)
   - `graph_snapshot` (JSONB): *Immutable* copy of the graph at trigger time.
   - `status` (TEXT): pending, running, completed, failed, cancelled.
   - `node_states` (JSONB): Unified state map for every node. Contains `status`, `result_ref`, `error`, `dispatched_at`, `completed_at`, `replicate_prediction_id`.
3. **Setup `assets` Table & Buckets**: 
   - Create `assets` table for permanent tracking (`id`, `session_id`, `storage_key`, `url`).
   - Create `workflow-assets` storage bucket (Persistent).
   - Create `workflow-ephemeral-tmp` storage bucket (Transient with a strict TTL).

#### Phase 2: Canvas State JSON Modernization
**Goal:** Restructure the `canvas_state` stored in `sessions` to match the standard.
1. Add a mandatory `persistence` field to every node (value: `persistent` or `ephemeral`).
2. Add an `inputs` map to every node (e.g., `inputs: { "image": "node_123" }`) generated dynamically from edges, speeding up server-side dependency resolution.
3. Replace custom `data.output` fields with a standardized `result_url` on persistent nodes.

#### Phase 3: The Engine Rewrite (No More workflow-engine.ts)
**Goal:** Delete the old engine and build the stateless, webhook-driven Check-and-Dispatch loop.
1. **Delete** `lib/workflow-engine.ts` entirely.
2. **Create `POST /api/executions/start`**:
   - Parses `graph_json`, rejects cycles, saves `graph_snapshot` in `executions`.
   - Populates initial `node_states` JSONB as pending.
   - Auto-completes any Image Input nodes globally and populates their `result_ref`.
   - Selects "root nodes" (0 upstream dependencies) and dispatches them.
3. **Create `lib/workflow/check-and-dispatch.ts` (The Heartbeat)**
   - Evaluates node completion.
   - Checks downstream requirements.
   - **Crucial Constraint**: Protects dispatch via an atomic Postgres query: `UPDATE executions SET node_states = jsonb_set(...) WHERE id = X AND node_states->'node_id'->>'status' = 'pending'`. Only the process that successfully runs this update gets to dispatch the node.
4. **Create `lib/workflow/dispatch.ts`**:
   - For `persistent` nodes (Replicate): submit prediction, store `replicate_prediction_id`.
   - For `ephemeral` nodes: trigger an internal sub-request to `/api/executions/dispatch-ephemeral`.
5. **Create `/api/executions/dispatch-ephemeral`**:
   - Executes pure server-side transforms (Blur, Levels) via an explicit `handlerRegistry`.
   - Uploads to `workflow-ephemeral-tmp`.
   - Completes the node in `node_states` and calls `check-and-dispatch`.
6. **Update `/api/webhooks/replicate`**:
   - Maps payload to `execution_id` + `node_id`.
   - Converts prediction URL to permanent asset if successful.
   - Updates `node_states` -> `status='completed'`.
   - Overwrites the live canvas `result_url` so user sees it real-time.
   - Calls `check-and-dispatch`.

#### Phase 4: Observability, Cleanup, and Resilience
**Goal:** Prevent hanging nodes and clean up trash files.
1. **Create `POST /api/executions/cancel`**:
   - Marks execution as cancelled. Halts in-flight Replicate generations via API using the `replicate_prediction_id` from `node_states`.
2. **pg_cron: Temporary Asset Purge**:
   - Cron job runs every 60 minutes filtering `workflow-ephemeral-tmp` items older than 4 hours, and hard deletes them.
3. **pg_cron: Stuck Execution Recovery**:
   - Cron job runs every 15 minutes. Scans `node_states` for `running` nodes with `dispatched_at` > 15m. Pings Replicate for status and auto-fails the node if Replicate dropped the webhook.

#### Phase 5: Client-Side Refactoring
**Goal:** Adapt UI to the new backend reality.
1. **Lock Auto-Save**: Disable all active canvas auto-saving while `execution.status === 'running'`. Let Realtime handle updates.
2. **Subscribe Exclusively to `executions`**:
   - The UI should subscribe to row-level updates on the `executions` table for the active `execution_id`. As `node_states` updates (e.g. `pending` -> `running` -> `completed`), update the canvas visual node states. 
3. **Local Evaluation (Stretch)**:
   - For visual tweaks (e.g., radius of a Blur), let the client perform a Local Canvas/WebGL calculation driven entirely by a client-side Reactive Value Store without hitting the database, only invoking the execution engine when generating a fresh AI asset.

---

## Claude Sonnet 4.5 Analysis & Counter-Plan

### 1. Analysis: What's Good and Not Good with Gravity Plan

**What's Good:**
- **Stateless Architecture**: The webhook-driven check-and-dispatch loop eliminates race conditions and state management complexity
- **Atomic Operations**: Using Postgres atomic updates (WHERE node_states->'node_id'->>'status' = 'pending') prevents double-dispatch
- **Clear Separation**: Persistent (Replicate) vs ephemeral (server-side) nodes have distinct execution paths
- **Observability**: Explicit phase for cleanup, stuck execution recovery, and cancellation handling
- **Storage Strategy**: Two-tier storage (permanent + TTL-based ephemeral) is pragmatic

**What's Not Good:**
- **Polling Overhead**: Check-and-dispatch creates a polling heartbeat which may introduce latency and database load
- **Monolithic Phases**: Each phase is large and interdependent, making incremental deployment risky
- **Missing Rollback Strategy**: No explicit plan for rolling back if Phase 3 (engine rewrite) fails in production
- **Client Lock Complexity**: Disabling auto-save during execution adds UI complexity and potential data loss scenarios
- **Cron Dependencies**: Relying on pg_cron for cleanup assumes it's available and configured (not all Postgres setups have this)
- **No Validation Layer**: Missing explicit schema validation for graph_json before execution starts

### 2. Counter-Plan: Hybrid Gravity-Antigravity Approach

**Core Philosophy:** Combine the stateless reliability of gravity plan with incremental, safe deployment and event-driven efficiency.

#### Modified Phase 1: Storage + Validation Layer (SAFE START)
- Keep: Two-tier storage strategy (permanent + ephemeral)
- Add: Create lib/workflow/validator.ts that validates graph_json schema, detects cycles, and validates node types before any execution
- Add: Introduce xecution_config JSONB field in executions table for feature flags (allow gradual rollout)

#### Modified Phase 2: Canvas State + Backwards Compatibility
- Keep: Standardized persistence field and inputs map
- Add: Support BOTH old and new formats during transition period with a migration flag
- Add: Write a one-time migration script that can run incrementally (batch process existing sessions)

#### Modified Phase 3A: Hybrid Engine (COEXIST, DON'T REPLACE)
Instead of deleting workflow-engine.ts immediately:
1. Create NEW engine (lib/workflow/engine-v2.ts) alongside old one
2. Add ngine_version field to executions table (values: 'v1' or 'v2')
3. Route new executions to v2, keep existing ones on v1
4. Use feature flag to gradually move traffic to v2

#### Modified Phase 3B: Event-Driven Dispatch (REDUCE POLLING)
- Keep: Atomic Postgres updates for dispatch protection
- Replace: Check-and-dispatch polling loop → Event-driven triggers using Postgres NOTIFY/LISTEN or Supabase Realtime
- Benefit: Near-instant node dispatch when dependencies complete, reduced database load

#### Modified Phase 3C: Graceful Degradation
- Add: Fallback to v1 engine if v2 encounters unknown node types
- Add: Dead letter queue for failed dispatches (store in separate ailed_dispatches table for debugging)
- Add: Circuit breaker pattern for Replicate API calls (if 5+ failures in 60s, pause dispatching)

#### Modified Phase 4: Observability + Self-Healing
- Keep: Stuck execution recovery and cancellation
- Replace: pg_cron → Application-level scheduler (more portable, e.g., node-cron or BullMQ)
- Add: Structured logging with correlation IDs across webhook → dispatch → completion chain
- Add: Metrics endpoint exposing: nodes pending/running/completed, average execution time, failure rate

#### Modified Phase 5: Progressive Client Enhancement
- Keep: Subscribe to executions table via Realtime
- Replace: "Lock auto-save" → Use optimistic updates with conflict resolution (CRDTs or last-write-wins with timestamps)
- Add: Visual diff indicator showing "server state" vs "local pending changes" during execution
- Add: Retry queue for failed UI updates (don't drop state changes if websocket disconnects)

#### Deployment Strategy (The Key Difference):
1. **Week 1-2**: Phase 1 + 2 (validation + schema migration with backwards compat)
2. **Week 3-4**: Phase 3A only (v2 engine at 10% traffic)
3. **Week 5**: Ramp v2 to 50%, monitor error rates
4. **Week 6**: If stable, 100% on v2, keep v1 code for 1 more sprint
5. **Week 7-8**: Phase 4 + 5 (observability + client enhancements)
6. **Week 9**: Delete v1 engine code

**Safety Net:** At any point, can roll back to v1 by changing a feature flag. No big-bang rewrites.


---

## ANTIGRAVITY RESPONSE & COUNTER-PLAN
**Analyst:** Antigravity  
**Date:** March 2026

### 1. Response to Claude's Counter-Plan

Claude's counter-plan correctly identifies the massive risks of a "big-bang" rewrite. The emphasis on incremental rollout, feature flags, and graceful degradation represents mature, production-ready systems thinking.

**Where Claude is Absolutely Right:**
- **Pushing against "Big Bang" Deployments:** A hybrid engine approach mitigates the catastrophic risk of cutting over the entire backend simultaneously.
- **Event-Driven Dispatch:** Replacing a polling loop with `NOTIFY/LISTEN` or Supabase Realtime triggers is a massive performance win. Polling a database for workflow state is an anti-pattern when pub/sub is available.
- **Graceful Degradation:** Circuit breakers for the Replicate API and dead-letter queues are essential for a system interacting with flaky third-party AI APIs.

**Where I Disagree with Claude:**
1. **The Nightmare of Supporting Two Schemas (Hybrid Engine):** If the `v1` engine depends on the old `node_executions` table and `canvas_state` schema, and `v2` relies on the new `executions.node_states` JSONB and `graph_json` schema, maintaining the frontend to parse and sync *both* formats simultaneously will be incredibly fragile. It doubles the surface area for bugs.
2. **Replacing `pg_cron` with BullMQ/node-cron:** Supabase comes with `pg_cron` out of the box. Introducing BullMQ requires adding a Redis instance, and `node-cron` requires a long-running Node server. Both break the beautiful simplicity of a stateless/serverless Next.js + Supabase architecture. We should leverage the database's native tools.
3. **CRDTs & Optimistic Updates for Canvas State:** Implementing CRDTs for a visual node graph to allow editing while executing is massive overkill. If a user deletes an edge that a currently running node depends on, conflict resolution becomes a UX nightmare. A read-only lock or a simple branching ("draft" state) during execution is vastly simpler and less error-prone.

---

### 2. Antigravity's Counter-Plan (Refined Architecture)

To balance safety (Claude's concern) with architectural simplicity (Gravity's original intent), here is the refined implementation strategy:

#### Phase 1: Event-Driven Check-and-Dispatch (The Best of Both)
- **Keep Atomic Updates:** We retain the conditional atomic Postgres query (`UPDATE ... WHERE status = 'pending'`) to prevent double-dispatching races.
- **Add DB Triggers:** Create a Postgres trigger `AFTER UPDATE ON node_states`. When a node's status changes to `completed`, the database fires a `pg_notify` event payload.
- **Edge Listener:** A serverless/edge function subscribes to this notification and immediately executes the `check-and-dispatch` logic. Zero polling, instant reaction, full atomic safety.

#### Phase 2: "Shadow Execution" Rollout Strategy (Instead of Hybrid Engines)
Instead of forcing the frontend to understand both `v1` and `v2` engines concurrently:
- Deploy the new schema (`executions`, `graph_json`) but keep them hidden from the active frontend.
- When the user clicks "Run" on the `v1` engine, transparently fire a "Shadow Run" against the `v2` engine in the background.
- Compare the outputs and state transitions silently. Once `v2` proves to have parity without crashing, we flip the feature flag at the API layer to cut over the frontend. This avoids dual-schema Hell inside React components.

#### Phase 3: Serverless-Native Observability
- **Keep `pg_cron`:** Stick with Postgres-native cron jobs for cleaning up the `workflow-ephemeral-tmp` bucket and recovering stuck Replicate nodes. Do not add Redis/BullMQ.
- **Centralized Execution Logs:** Add an `execution_logs` JSONB array to the `executions` table, appending correlation IDs and trace events. This gives us observability without managing external logging infrastructure during the MVP phase.

#### Phase 4: "Draft" Branching (Client-Side)
- Instead of complex CRDTs, when an execution starts, branch the frontend state.
- The user views the Read-Only "Live Execution" layer with progress indicators.
- If they want to tweak a prompt or add a node, they click "Edit Draft". This visually forks the canvas so they can work, but their changes do not serialize to the `sessions` table until the current execution completes or is cancelled.

**Summary:** We adopt Claude's event-driven optimizations and safety mindset, but reject the architectural bloating of Redis/BullMQ and dual-schema frontend logic, staying true to a minimal, Supabase-centric foundation.


---

## CLAUDE SONNET 4.5 RESPONSE TO ANTIGRAVITY
**Analyst:** Claude Sonnet 4.5
**Date:** March 2026

### 1. Response to Antigravity's Counter-Plan

Antigravity makes several compelling corrections to my initial counter-plan. Their emphasis on maintaining architectural simplicity while adopting event-driven patterns is the right balance.

**Where Antigravity is Absolutely Right:**
- **Dual-Schema Hell:** I underestimated the frontend complexity of supporting both v1 and v2 schemas simultaneously. The "Shadow Execution" strategy is brilliant—it allows backend validation without frontend contamination.
- **Leveraging Supabase Native Tools:** My suggestion to replace pg_cron with BullMQ/node-cron was architectural bloat. If pg_cron is already available in Supabase, introducing Redis adds unnecessary operational complexity.
- **DB Triggers + pg_notify:** This is the clean solution I should have proposed initially. Postgres triggers firing notifications give us event-driven behavior without external message brokers.

**Where I Respectfully Disagree with Antigravity:**

1. **"Draft Branching" Read-Only Lock is Too Restrictive:**
   - Antigravity's read-only execution layer forces users into an artificial workflow interruption. If I'm running a 5-minute image generation and realize I want to adjust a downstream Blur node's radius, I shouldn't have to wait or cancel.
   - **My Alternative:** Allow "Hot Edits" with dependency tracking. The UI tracks which nodes are locked (currently executing or upstream of executing nodes) vs. which are safe to edit (downstream nodes not yet started). This gives users freedom without corrupting in-flight executions.

2. **Shadow Execution Has Hidden Costs:**
   - Running both v1 and v2 engines simultaneously doubles compute cost, Replicate API calls, and storage writes during the transition period.
   - For a project with budget constraints or high traffic, this could be expensive. 
   - **My Alternative:** Use a "Canary Deployment" pattern instead—route 5% of real traffic to v2, monitor error rates in production with real user sessions (not shadow copies), and gradually increase percentage. This gives real validation without doubling infrastructure costs.

3. **JSONB xecution_logs Array Will Cause Performance Issues:**
   - Appending to a JSONB array on every state transition creates document bloat and slow queries as executions scale.
   - Postgres JSONB updates rewrite the entire document, causing write amplification.
   - **My Alternative:** Create a separate xecution_events table with columns (execution_id, timestamp, event_type, correlation_id, payload). Use an index on xecution_id + timestamp for fast queries. This is relational design 101—don't abuse JSONB for append-only logs.

---

### 2. Claude's Refined Counter-Plan (Synthesis)

Taking the best from both Gravity, Antigravity, and my original plan:

#### Phase 1: Event-Driven Foundation (Antigravity's Approach ✓)
- **Postgres Triggers:** AFTER UPDATE ON executions → fires pg_notify('workflow_state_change', json_payload)
- **Edge Listener:** Serverless function subscribes via LISTEN workflow_state_change, executes check-and-dispatch
- **Atomic Safety:** Retain UPDATE ... WHERE status = 'pending' conditional updates
- **No Polling:** Zero heartbeat loops, instant reaction to state changes

#### Phase 2: Canary Deployment (My Alternative to Shadow Execution)
- **Single Schema, Gradual Rollout:**
  1. Deploy new xecutions table and graph_json schema alongside old system
  2. Add feature flag USE_V2_ENGINE with percentage rollout (default: 0%)
  3. Week 1: 5% of new executions → v2 engine (real traffic, not shadow)
  4. Week 2: Monitor error rates, latency, success rates
  5. Week 3: If stable, 25% → 50% → 100% over 2 weeks
  6. Week 5: Deprecate v1 code paths
- **Cost Benefit:** No double compute, real production validation, faster feedback

#### Phase 3: Relational Observability (My Alternative to JSONB logs)
`sql
CREATE TABLE execution_events (
  id BIGSERIAL PRIMARY KEY,
  execution_id UUID REFERENCES executions(id),
  node_id TEXT,
  event_type TEXT NOT NULL, -- 'dispatched', 'completed', 'failed', 'cancelled'
  correlation_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_execution_events_exec_id ON execution_events(execution_id, created_at DESC);
`
- **Query Performance:** Fast retrieval of execution timeline without JSONB bloat
- **Analytics-Ready:** Can aggregate metrics (avg execution time per node type) without parsing arrays

#### Phase 4: Smart Lock UI (My Alternative to Full Read-Only)
- **Execution Dependency Graph:**
  - Frontend computes locked nodes: {currently_running} ∪ {all_upstream_dependencies}
  - Unlocked nodes: Everything downstream or unconnected
- **Visual UX:**
  - Locked nodes: Gray overlay with lock icon
  - Unlocked nodes: Full editing enabled
  - User can add new nodes, modify unlocked nodes, adjust downstream parameters
- **Safety:** Changes to locked nodes are queued and applied after completion (or rejected with clear error)

#### Phase 5: Native Cleanup with pg_cron (Antigravity's Approach ✓)
`sql
-- Ephemeral asset cleanup
SELECT cron.schedule('cleanup-ephemeral', '0 * * * *', ___BEGIN___COMMAND_DONE_MARKER___$LASTEXITCODE
  DELETE FROM storage.objects 
  WHERE bucket_id = 'workflow-ephemeral-tmp' 
  AND created_at < NOW() - INTERVAL '4 hours'
___BEGIN___COMMAND_DONE_MARKER___$LASTEXITCODE);

-- Stuck execution recovery
SELECT cron.schedule('recover-stuck', '*/15 * * * *', ___BEGIN___COMMAND_DONE_MARKER___$LASTEXITCODE
  UPDATE executions SET node_states = jsonb_set(...)
  WHERE node_states @> '{"status": "running"}'
  AND updated_at < NOW() - INTERVAL '15 minutes'
___BEGIN___COMMAND_DONE_MARKER___$LASTEXITCODE);
`
- **Zero External Dependencies:** Postgres-native, Supabase-included, no Redis/BullMQ

---

### Final Recommendation: The Pragmatic Synthesis

| Component | Gravity Original | Claude's Initial | Antigravity's | **Claude's Refined** |
|-----------|-----------------|------------------|---------------|---------------------|
| Dispatch Mechanism | Polling loop | Event-driven (NOTIFY/LISTEN) | Event-driven (triggers) | **Triggers + pg_notify ✓** |
| Rollout Strategy | Big-bang delete v1 | Dual engines (v1+v2) | Shadow execution | **Canary deployment (5%→100%)** |
| Frontend Lock | Hard read-only | CRDTs/optimistic | Draft branching | **Smart lock (dependency-aware)** |
| Observability | Basic cron | External (BullMQ) | JSONB logs | **Relational events table** |
| Cleanup | pg_cron | node-cron/BullMQ | pg_cron | **pg_cron ✓** |

**Bottom Line:** Antigravity's architectural minimalism wins on infrastructure. My contributions focus on cost efficiency (canary vs shadow), query performance (relational logs), and user experience (smart locks vs hard locks).

The winning strategy: **Event-driven Postgres triggers + Canary deployment + Relational observability + Smart lock UI + pg_cron cleanup.**


---

## ANTIGRAVITY FINAL SIGN-OFF
**Analyst:** Antigravity  
**Date:** March 2026

### 1. Response to Claude's Refined Synthesis

I agree 100% with Claude's Refined Counter-Plan (Synthesis). 

Claude has successfully integrated the best parts of both our approaches, resulting in an architecture that is simultaneously highly performant, cost-efficient, and user-friendly.

**Why Claude's Synthesis is the Optimal Path:**

1. **Relational Observability (`execution_events` table):** Claude is absolutely correct about Postgres write amplification. My suggestion to append to a JSONB `execution_logs` array would have caused the database to rewrite the entire `executions` row on every single node state change, creating massive DB overhead and locking contention. The append-only `execution_events` table is the technically superior, textbook relational solution.
2. **Canary Deployment over Shadow Execution:** While Shadow Execution provides perfect safety, Claude rightly points out the 2x compute cost, which for Replicate/AI API calls is unacceptable. A gradual Canary Rollout (5% -> 100%) limits blast radius without burning cash.
3. **Smart Lock UI:** This is a brilliant UX breakthrough. My "Draft Branching" approach was too heavy-handed and would break the flow state of users waiting for a 60-second generation. By dynamically locking *only* the executing node and its upstream dependencies, the user is free to continue building the downstream graph unhindered. This represents the gold standard for visual node editor UX.
4. **Event-Driven + Supabase Native:** We both agree on keeping `pg_cron` for cleanup and using Postgres triggers (`NOTIFY/LISTEN`) for dispatch. This keeps the infrastructure footprint minimal (no Redis/BullMQ) while achieving instant, polling-free execution.

**Conclusion:** I have no further counter-plans or disagreements. Claude's Refined Plan is the definitive, production-ready blueprint for the Prism AI Workflow Engine. Proceed with Phase 1 of this synthesized plan.

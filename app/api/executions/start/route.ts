/**
 * Workflow Engine - Start Execution Endpoint
 * 
 * STEP 1: Parse request, validate inputs, transform workflow graph.
 * STEP 2: Build the "Target Set" — which nodes actually need to run in this execution.
 *         - 'all' mode: every node in the graph
 *         - 'solo' mode: target node + all ephemeral ancestors (recursively)
 *                        generative ancestors are NOT included — their last result is
 *                        fetched from the DB and used as pre-seeded inputs
 *         - 'chain' mode: same as solo + all downstream descendants
 * STEP 3: Create an immutable execution record in the DB with a snapshot of the subgraph.
 * STEP 4: Initialize all target nodes in node_results as 'pending'.
 * STEP 5: Find root nodes (nodes with no parents in this execution set).
 * STEP 6: For each root, build its initial inputs (from pre-seeded generative results or empty).
 * STEP 7: Dispatch root nodes. The orchestrator handles the rest of the chain.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { GraphJson, NodeConfig } from '@/lib/workflow/types-v2';
import { transformWorkflowV1ToV2 } from '@/lib/workflow/node-type-mapper';
import { dispatchNode } from '@/lib/workflow/dispatch-v2';
import { isEphemeralNode } from '@/lib/workflow/handlers';
import { getPrimaryInputValue, normalizeNodeResultType } from '@/lib/workflow/result-format';

export async function POST(request: NextRequest) {
  console.log('[Execution/Start] Received start execution request');
  
  try {
    const body = await request.json();
    const { session_id, workflow, user_id, targetNodeId, mode } = body;
    let graph_json: GraphJson = body.graph_json;
    
    if (!session_id || (!graph_json && !workflow)) {
      return NextResponse.json(
        { error: 'Missing required fields: session_id and either graph_json or workflow' },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Transform V1 workflow format to V2 graph_json if needed.
    // Why: The UI sends the raw ReactFlow node/edge format. The server needs a
    //      clean graph_json with typed NodeConfig objects.
    // ─────────────────────────────────────────────────────────────────────────
    if (workflow && !graph_json) {
      console.log('[Execution/Start] Transforming V1 workflow to V2 graph_json');
      try {
        graph_json = await transformWorkflowV1ToV2(workflow);
      } catch (transformError) {
        console.error('[Execution/Start] Transformation failed:', transformError);
        return NextResponse.json(
          { error: `Workflow transformation failed: ${transformError instanceof Error ? transformError.message : 'Unknown error'}` },
          { status: 500 }
        );
      }
    }
    
    if (!graph_json?.nodes || !Array.isArray(graph_json.nodes)) {
      return NextResponse.json(
        { error: 'Invalid graph_json: must contain a nodes array' },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Deduplicate nodes. The UI may send duplicates on hot-reload.
    // Why: The node_results table has a unique constraint on (execution_id, node_id).
    //      Inserting duplicates would cause a DB error.
    // ─────────────────────────────────────────────────────────────────────────
    const uniqueNodesMap = new Map<string, NodeConfig>();
    graph_json.nodes.forEach((node: NodeConfig) => {
      uniqueNodesMap.set(node.id, node);
    });
    const allNodes = Array.from(uniqueNodesMap.values());
    const allEdges = graph_json.edges || [];

    const supabase = createServiceClient();

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Build the "Target Set" — which nodes this execution will run.
    // Also build "preseedInputs" — a map of nodeId → inputs sourced from DB
    //         for generative ancestors that are NOT being re-run.
    //
    // Why: We never want to blindly run every node. Solo mode should only hit
    //      the target + its ephemeral ancestors. Generative results from prior
    //      runs are read from the DB so the user gets fresh results downstream
    //      without having to re-generate expensive AI outputs.
    // ─────────────────────────────────────────────────────────────────────────
    let nodesToExecute: NodeConfig[] = [];
    let edgesToInclude = [...allEdges];

    // preseedInputs: for root nodes in the execution set whose inputs come from
    // generative ancestors outside the set, we pre-build the inputs map from DB.
    const preseedInputs = new Map<string, Record<string, any>>();

    if (!targetNodeId || mode === 'all') {
      // ── ALL mode: run every node in the graph ──────────────────────────────
      // Why: "Run All" means fresh execution of the complete pipeline.
      nodesToExecute = [...allNodes];
    } else {
      // ── SOLO and CHAIN mode ────────────────────────────────────────────────
      const targetNode = allNodes.find(n => n.id === targetNodeId);
      if (!targetNode) {
        return NextResponse.json({ error: 'Target node not found in graph' }, { status: 404 });
      }

      const executionSet = new Set<string>([targetNodeId]);
      
      // Collect the IDs of generative ancestors we need to read from DB.
      // We build this list while traversing the ancestor tree.
      const generativeAncestorIds = new Set<string>();

      // BFS backwards through the graph to classify ancestors.
      // Why BFS and not DFS: we want to process ancestors level by level,
      //   which makes the logic predictable and avoids stack overflows on
      //   very deep graphs.
      const queue = [targetNodeId];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const parentEdges = allEdges.filter(e => e.target === currentId);
        
        for (const edge of parentEdges) {
          const parentNode = allNodes.find(n => n.id === edge.source);
          if (!parentNode || executionSet.has(edge.source) || generativeAncestorIds.has(edge.source)) {
            continue; // already classified, skip
          }

          if (isEphemeralNode(parentNode.type)) {
            // Ephemeral: cheap/deterministic — include in this execution, recurse.
            // Why: Ephemeral nodes (blur, prompt, etc.) are fast, stateless, and
            //      must re-run because their output feeds the current node.
            executionSet.add(edge.source);
            queue.push(edge.source);
          } else {
            // Generative: expensive — do NOT include. Read last result from DB.
            // Why: Re-running an AI node just to get the same image it already
            //      generated wastes credits and time. We trust the last result.
            generativeAncestorIds.add(edge.source);
          }
        }
      }

      // CHAIN mode: also add all downstream descendants.
      // Why: "Chain" means "run this node AND re-run everything that depends on it".
      if (mode === 'chain') {
        const descendantQueue = [targetNodeId];
        while (descendantQueue.length > 0) {
          const currentId = descendantQueue.shift()!;
          const childEdges = allEdges.filter(e => e.source === currentId);
          for (const edge of childEdges) {
            if (!executionSet.has(edge.target)) {
              executionSet.add(edge.target);
              descendantQueue.push(edge.target);
            }
          }
        }
      }

      nodesToExecute = allNodes.filter(n => executionSet.has(n.id));
      edgesToInclude = allEdges.filter(e => executionSet.has(e.source) && executionSet.has(e.target));
      
      // ── Fetch DB results for generative ancestors ─────────────────────────
      // Why: Now that we know which generative nodes are outside the execution
      //      set, fetch their last results from node_results so we can seed
      //      the target node's inputs without re-running those nodes.
      if (generativeAncestorIds.size > 0) {
        const { data: ancestorResults } = await supabase
          .from('node_results')
          .select('node_id, result_type, result_data')
          .eq('session_id', session_id)
          .in('node_id', Array.from(generativeAncestorIds))
          .eq('status', 'completed')
          .order('updated_at', { ascending: false });

        // Build one "latest result" per generative ancestor node.
        const latestByNode = new Map<string, any>();
        (ancestorResults || []).forEach(r => {
          const typedValue = r.result_type
            ? getPrimaryInputValue(normalizeNodeResultType(r.result_type), r.result_data)
            : getPrimaryInputValue('json', r.result_data || []);

          if (typedValue !== undefined && typedValue !== null && !latestByNode.has(r.node_id)) {
            latestByNode.set(r.node_id, typedValue);
          }
        });

        // For each node in the execution set that has edges from a generative
        // ancestor, pre-build its inputs map.
        for (const node of nodesToExecute) {
          const incomingFromGenerative = allEdges.filter(
            e => e.target === node.id && generativeAncestorIds.has(e.source)
          );
          if (incomingFromGenerative.length === 0) continue;

          const nodeInputs = preseedInputs.get(node.id) || {};
          for (const edge of incomingFromGenerative) {
            const result = latestByNode.get(edge.source);
            if (result !== undefined && result !== null) {
              const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
              nodeInputs[inputKey] = result;
              const preview = typeof result === 'string' ? result.substring(0, 60) : JSON.stringify(result).substring(0, 60);
              console.log(`[Execution/Start] Pre-seeding input for node ${node.id}: ${inputKey} = ${preview}...`);
            } else {
              console.warn(`[Execution/Start] Generative ancestor ${edge.source} has no completed result in DB. Node ${node.id} may fail.`);
            }
          }
          preseedInputs.set(node.id, nodeInputs);
        }
      }
    }

    console.log(`[Execution/Start] Target Set: ${nodesToExecute.length} nodes, ${edgesToInclude.length} edges`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Create an immutable execution record in the DB.
    // Why: The orchestrator and dispatch functions all work off this DB record.
    //      The graph snapshot here is the single source of truth for this run.
    //      We store a mini-graph (only the target set) so the orchestrator
    //      never looks outside the intended scope.
    // ─────────────────────────────────────────────────────────────────────────
    const { data: execution, error: createError } = await supabase
      .from('executions')
      .insert({
        session_id,
        status: 'pending',
        graph_json: { nodes: nodesToExecute, edges: edgesToInclude },
      })
      .select()
      .single();
    
    if (createError || !execution) {
      console.error('[Execution/Start] Failed to create execution record:', createError);
      return NextResponse.json(
        { error: `Failed to create execution: ${createError?.message}` },
        { status: 500 }
      );
    }
    
    console.log(`[Execution/Start] Created execution ${execution.id}`);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Initialize all target nodes in node_results.
    //
    // Root nodes (dispatched immediately) → inserted as 'running'.
    // Why: The realtime INSERT event fires immediately on the client. If we
    //      insert root nodes as 'pending' first, then update to 'running' a
    //      moment later via dispatch-v2, the client sees a 'pending' downgrade
    //      from the optimistic 'running' update the UI already applied. By
    //      inserting as 'running' directly, the first (and only) event the 
    //      client sees for root nodes is already 'running' — zero flicker.
    //
    // Non-root nodes (waiting for parent) → inserted as 'pending'.
    // Why: They genuinely ARE pending until their parents finish. The
    //      orchestrator will update them to 'running' when it dispatches them.
    // ─────────────────────────────────────────────────────────────────────────

    // STEP 6: Find root nodes — nodes with NO parent edges in the target set.
    // We compute this here (before the insert) so we can set their initial status.
    const rootNodes = nodesToExecute.filter(node => {
      const hasParentInSet = edgesToInclude.some(e => e.target === node.id);
      return !hasParentInSet;
    });
    const rootNodeIds = new Set(rootNodes.map(n => n.id));

    const initialNodeResults = nodesToExecute.map((node: NodeConfig) => ({
      execution_id: execution.id,
      node_id: node.id,
      session_id: session_id,
      // Root nodes start as 'running' so the client's first realtime event is already correct.
      // Non-root nodes start as 'pending' — they'll be updated when their parents complete.
      status: rootNodeIds.has(node.id) ? 'running' : 'pending',
      updated_at: new Date().toISOString(),
    }));
    
    const { error: initError } = await supabase
      .from('node_results')
      .insert(initialNodeResults);
    
    if (initError) {
      // Non-fatal: might happen if a prior run left rows from a previous execution.
      // The upsert in dispatch-v2 (updateNodeState) will correct the status.
      console.warn('[Execution/Start] Failed to initialize node_results (may already exist):', initError.message);
    }
    
    console.log(`[Execution/Start] Kicking off ${rootNodes.length} root node(s): ${rootNodes.map(n => n.id).join(', ')}`);

    const { origin } = new URL(request.url);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7: Dispatch each root node.
    // Why: We await the first dispatch to ensure the execution is truly kicked
    //      off before returning to the client. If we fire-and-forget, the
    //      Next.js serverless function may terminate before the dispatch completes.
    //
    //      The inputs for each root are either:
    //        - Pre-seeded from generative ancestors (fetched in Step 3), or
    //        - Empty (node has no upstream dependencies at all)
    // ─────────────────────────────────────────────────────────────────────────
    for (const node of rootNodes) {
      const inputs = preseedInputs.get(node.id) || {};
      console.log(`[Execution/Start] Dispatching root node ${node.id} (type: ${node.type}) with inputs: [${Object.keys(inputs).join(', ')}]`);
      await dispatchNode(execution.id, node.id, node, inputs, origin, session_id);
    }
    
    return NextResponse.json({
      success: true,
      execution_id: execution.id,
      status: 'pending',
    });
    
  } catch (error) {
    console.error('[Execution/Start] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

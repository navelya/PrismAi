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
import { isEphemeralNode } from '@/lib/nodes/core/server-registry';
import { coerceResultDataArray, getPrimaryInputValue, normalizeNodeResultType } from '@/lib/workflow/result-format';
import { getAiArrayInputKeys } from '@/lib/workflow/orchestrator';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { computeExecutionCost, MAX_EXECUTION_COST, type CostNode } from '@/lib/billing/cost';
import { validateExecution } from '@/lib/workflow/validate-execution';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { clampSelectedIndex } from '@/lib/nodes/plugins/ai_generator/outputs';

export async function POST(request: NextRequest) {
  console.log('[Execution/Start] Received start execution request');

  try {
    // Authenticate the caller. We use the authenticated user.id for the
    // debit — never trust user_id from the body, which would let one user
    // drain another's credits.
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const authedUserId = auth.user.id;

    const body = await request.json();
    const { session_id, workflow, targetNodeId, targetNodeIds, mode } = body;
    let graph_json: GraphJson = body.graph_json;

    if (!session_id || (!graph_json && !workflow)) {
      return NextResponse.json(
        { error: 'Missing required fields: session_id and either graph_json or workflow' },
        { status: 400 }
      );
    }

    // 'selection' mode runs an arbitrary set of nodes together — the multi-select
    // toolbar's Run button. Normalize early so the rest of the pipeline can read
    // a single canonical array regardless of which legacy field was sent.
    const selectionTargets: string[] = mode === 'selection' && Array.isArray(targetNodeIds)
      ? Array.from(new Set(targetNodeIds.filter((id: any) => typeof id === 'string')))
      : [];
    if (mode === 'selection' && selectionTargets.length === 0) {
      return NextResponse.json(
        { error: 'selection mode requires a non-empty targetNodeIds array' },
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

    // Group nodes are visual organization only — they have no handles, no
    // executor, and must never be dispatched. Strip them from the executable
    // node set before any downstream logic runs.
    const executableNodes = allNodes.filter((n: NodeConfig) => n.type !== 'group_container');

    const supabase = createServiceClient();

    // ─────────────────────────────────────────────────────────────────────────
    // COLLAB: Verify the runner has edit rights on this canvas session.
    // The service client bypasses RLS, so we must check explicitly.
    // An owner is identified by: sessions row has no canvas_session_id (it IS
    // the canonical canvas) and user_id matches the authed caller.
    // An editor collaborator is accepted via session_collaborators.role.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { data: canvasRow } = await supabase
        .from('sessions').select('user_id, canvas_session_id').eq('id', session_id).single();
      const isOwner = canvasRow && !canvasRow.canvas_session_id && canvasRow.user_id === authedUserId;
      if (!isOwner) {
        const { data: collab } = await supabase
          .from('session_collaborators').select('role')
          .eq('session_id', session_id).eq('user_id', authedUserId).single();
        if (!collab || collab.role !== 'editor') {
          return NextResponse.json({ error: 'No edit access' }, { status: 403 });
        }
      }
    }

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

    if (mode !== 'selection' && (!targetNodeId || mode === 'all')) {
      // ── ALL mode: run every node in the graph ──────────────────────────────
      // Why: "Run All" means fresh execution of the complete pipeline.
      nodesToExecute = [...executableNodes];
    } else {
      // ── SOLO, CHAIN, and SELECTION modes ───────────────────────────────────
      // Selection seeds the BFS with N targets at once and SKIPS chain expansion;
      // otherwise the logic is identical to solo (auto-include ephemeral
      // ancestors, pre-seed generative ones from the DB).
      const seedIds: string[] = mode === 'selection'
        ? selectionTargets
        : [targetNodeId];

      for (const id of seedIds) {
        if (!executableNodes.find(n => n.id === id)) {
          return NextResponse.json({ error: `Target node not found in graph: ${id}` }, { status: 404 });
        }
      }

      const executionSet = new Set<string>(seedIds);

      // Collect the IDs of generative ancestors we need to read from DB.
      // We build this list while traversing the ancestor tree.
      const generativeAncestorIds = new Set<string>();

      // BFS backwards through the graph to classify ancestors.
      // Why BFS and not DFS: we want to process ancestors level by level,
      //   which makes the logic predictable and avoids stack overflows on
      //   very deep graphs.
      const queue = [...seedIds];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const parentEdges = allEdges.filter(e => e.target === currentId);
        
        for (const edge of parentEdges) {
          const parentNode = executableNodes.find(n => n.id === edge.source);
          if (!parentNode || executionSet.has(edge.source) || generativeAncestorIds.has(edge.source)) {
            continue; // already classified, or it's a group (non-executable)
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

      nodesToExecute = executableNodes.filter(n => executionSet.has(n.id));
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
        const latestByNode = new Map<
          string,
          { resultType: ReturnType<typeof normalizeNodeResultType>; resultData: any[]; primary: any }
        >();

        // A node's persisted selected output is the authoritative value it
        // provides downstream (the user picked it; we do NOT re-run the node).
        // Prefer it over the latest node_results row when present.
        const selectionByNode = new Map<string, { value: any; type: any }>();
        for (const n of executableNodes) {
          if (!generativeAncestorIds.has(n.id)) continue;
          const cfg = (n as any).data?.config || {};
          const outputs = Array.isArray(cfg.outputs) ? cfg.outputs : null;
          if (outputs && outputs.length > 0) {
            const idx = clampSelectedIndex(cfg.selected_output_index, outputs.length);
            const item = outputs[idx];
            if (item && item.value !== undefined && item.value !== null && item.value !== '') {
              selectionByNode.set(n.id, { value: item.value, type: item.type });
            }
          } else if (cfg.last_output !== undefined && cfg.last_output !== null && cfg.last_output !== '') {
            selectionByNode.set(n.id, { value: cfg.last_output, type: undefined });
          }
        }

        (ancestorResults || []).forEach(r => {
          const resultType = normalizeNodeResultType(r.result_type);
          let resultData = coerceResultDataArray(r.result_data || []);
          let primary = getPrimaryInputValue(resultType, resultData);

          // Honor the user's selected output for this ancestor (Plan A).
          const selected = selectionByNode.get(r.node_id);
          if (selected !== undefined) {
            primary = selected.value;
            // Lead resultData with the selection so array-handle consumers also
            // lead with it, preserving the remaining items.
            // values are URL/text primitives, so strict !== de-dupes correctly
            resultData = [selected.value, ...resultData.filter((v) => v !== selected.value)];
          }

          if ((primary !== undefined && primary !== null) || resultData.length > 0) {
            if (!latestByNode.has(r.node_id)) {
              latestByNode.set(r.node_id, { resultType, resultData, primary });
            }
          }
        });

        // An ancestor may have a persisted selection but no completed node_results
        // row (e.g. results pruned). Seed it from the selection so downstream still gets a value.
        for (const [ancestorId, sel] of selectionByNode.entries()) {
          if (latestByNode.has(ancestorId)) continue;
          const resultType = normalizeNodeResultType(sel.type);
          latestByNode.set(ancestorId, { resultType, resultData: [sel.value], primary: sel.value });
        }

        // For each node in the execution set that has edges from a generative
        // ancestor, pre-build its inputs map.
        for (const node of nodesToExecute) {
          const incomingFromGenerative = allEdges.filter(
            e => e.target === node.id && generativeAncestorIds.has(e.source)
          );
          if (incomingFromGenerative.length === 0) continue;
          const arrayInputKeys = await getAiArrayInputKeys(supabase, node);

          const nodeInputs = preseedInputs.get(node.id) || {};
          for (const edge of incomingFromGenerative) {
            const parentResult = latestByNode.get(edge.source);
            if (parentResult) {
              const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
              const result = arrayInputKeys.has(inputKey) ? parentResult.resultData : parentResult.primary;
              // Array handles can be fed by multiple edges (e.g. several
              // generative ancestors into one `image_input` slot). Concatenate
              // rather than overwrite so no upstream's images get dropped —
              // mirrors buildInputsFromParents in orchestrator.ts.
              if (arrayInputKeys.has(inputKey)) {
                const existing = nodeInputs[inputKey];
                const existingArr = Array.isArray(existing)
                  ? existing
                  : existing !== undefined && existing !== null
                    ? [existing]
                    : [];
                const incomingArr = Array.isArray(result) ? result : [result];
                nodeInputs[inputKey] = [...existingArr, ...incomingArr];
              } else {
                nodeInputs[inputKey] = result;
              }
              // Compositor layers store `layer.sourceHandleId = edge.id` because
              // every layer edge shares the same static `layers` target handle,
              // so per-edge id is the only way to disambiguate which upstream
              // value belongs to which layer. Single-input nodes are unaffected
              // (they read by handle name). Always use the non-array primary
              // here because layer lookups are single-value.
              if (edge.id && parentResult.primary !== undefined && parentResult.primary !== null) {
                nodeInputs[edge.id] = parentResult.primary;
              }
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
    // Pre-flight wiring validation (defense in depth — the client should
    // already have caught these and shown the user a per-node badge / popover).
    // Done after the target set + preseedInputs are built so we can use them
    // as the source of "completed upstream" truth, and BEFORE the executions
    // row is created so a rejected POST writes nothing to the DB and burns
    // no credits.
    // ─────────────────────────────────────────────────────────────────────────
    {
        // Models needed for ai_generator dynamic handles. Pull only the ids we
        // see referenced as ai_generator nodes in the target set.
        const aiGenModelIds = nodesToExecute
            .filter((n: any) => n.type === 'ai_generator')
            .map((n: any) => Number((n.data?.config?.model_id) ?? (n.data?.model_id)))
            .filter((id: number) => Number.isFinite(id));
        let modelsForValidation: any[] = [];
        if (aiGenModelIds.length > 0) {
            const { data: modelRows } = await supabase
                .from('ai_models')
                .select('id, inputs_schema, outputs_schema')
                .in('id', aiGenModelIds);
            modelsForValidation = modelRows ?? [];
        }

        const completedNodeIds = new Set<string>(preseedInputs.keys());
        const errors = validateExecution({
            workflow: { name: '', nodes: nodesToExecute as any, edges: edgesToInclude as any },
            runMode: (mode as any) ?? 'all',
            targetNodeId: targetNodeId ?? null,
            targetNodeIds: mode === 'selection' ? selectionTargets : undefined,
            completedNodeIds,
            sharedRegistry,
            models: modelsForValidation as any,
        });
        if (errors.length > 0) {
            console.warn(`[Execution/Start] Validation failed (${errors.length} error(s)) — rejecting before DB write.`);
            return NextResponse.json(
                { error: 'VALIDATION_FAILED', errors },
                { status: 400 }
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Create an immutable execution record in the DB.
    // Why: The orchestrator and dispatch functions all work off this DB record.
    //      The graph snapshot here is the single source of truth for this run.
    //      We store a mini-graph (only the target set) so the orchestrator
    //      never looks outside the intended scope.
    // ─────────────────────────────────────────────────────────────────────────
    // Persist preseeded inputs alongside the graph so the orchestrator can
    // deliver outside-the-set generative-ancestor values to NON-root nodes
    // during the chain reaction. Without this, a node like
    //   [GenA] ──▶ [Target T]
    //   [Eph B] ──▶ [Target T]
    // run in solo mode loses GenA's value: T is non-root (B is in-set), so
    // the dispatch loop's preseed delivery is skipped, and the orchestrator's
    // own input building queries node_results scoped to THIS execution_id —
    // GenA has no row there. Stashing preseeds in graph_json crosses both the
    // in-process dispatch chain and the Replicate webhook boundary cleanly.
    const preseedInputsObj: Record<string, Record<string, any>> = {};
    for (const [nodeId, inputs] of preseedInputs.entries()) {
      preseedInputsObj[nodeId] = inputs;
    }

    const { data: execution, error: createError } = await supabase
      .from('executions')
      .insert({
        session_id,
        status: 'pending',
        graph_json: {
          nodes: nodesToExecute,
          edges: edgesToInclude,
          preseedInputs: preseedInputsObj,
        },
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
    // Charge the user's credits BEFORE dispatching any nodes.
    //
    // Cost is computed server-side from the actual ai_models rows — the client
    // estimate is advisory only. If the user can't pay, mark the execution
    // failed and return 402; nothing has been dispatched yet so there's
    // nothing to roll back. Idempotency key is the execution id, so a retried
    // request never double-charges.
    // ─────────────────────────────────────────────────────────────────────────
    // V2 NodeConfig stores user data under `data`, not `config`. The shape can
    // be either `data.config.model_id` (V1 preserved) or `data.model_id` (V2
    // flattened). Mirror the same reads dispatch-v2 and orchestrator do.
    const costNodes: CostNode[] = nodesToExecute.map((n: NodeConfig) => {
      const data = (n as any).data || {};
      const inner = data.config || {};
      return {
        id: n.id,
        type: n.type,
        config: {
          model_id: inner.model_id ?? data.model_id,
          control_values: inner.control_values ?? data.control_values,
          iterations: inner.iterations ?? data.iterations,
        },
      };
    });

    const generativeNodeIds = costNodes
      .filter(n => n.type === 'ai_generator')
      .map(n => Number(n.config?.model_id))
      .filter(id => Number.isFinite(id));

    let cost = 0;
    if (generativeNodeIds.length > 0) {
      const { data: modelRows } = await supabase
        .from('ai_models')
        .select('id, credit_cost, inputs_schema')
        .in('id', generativeNodeIds);

      const modelsById = new Map<number, any>();
      (modelRows || []).forEach((m: any) => modelsById.set(m.id, m));

      // Connected-media pricing is counted from the FULL graph (executableNodes /
      // allEdges), never the trimmed target set — otherwise media from an
      // out-of-set media_input node would be undercounted and the debit would
      // drift below the client estimate.
      const graphForCost = {
        allNodes: executableNodes.map((n: any) => {
          const data = n.data || {};
          const inner = data.config || {};
          return {
            id: n.id,
            type: n.type,
            config: {
              model_id: inner.model_id ?? data.model_id,
              control_values: inner.control_values ?? data.control_values,
              iterations: inner.iterations ?? data.iterations,
              images: inner.images ?? data.images,
            },
          };
        }),
        edges: allEdges.map((e: any) => ({
          source: e.source,
          target: e.target,
          targetHandle: e.targetHandle ?? null,
        })),
      };

      const result = computeExecutionCost(costNodes, modelsById, graphForCost);
      cost = result.cost;

      console.log(`[Execution/Start] Cost calc — generative nodes: ${result.generativeCount}, total cost: ${cost}, model rows fetched: ${modelRows?.length ?? 0}, model ids referenced: [${generativeNodeIds.join(', ')}]`);

      if (result.missingModels.length > 0) {
        console.warn(`[Execution/Start] Missing model rows for ids: ${result.missingModels.join(', ')}`);
      }
    } else {
      console.log(`[Execution/Start] No ai_generator nodes in target set — cost is 0, skipping debit.`);
    }

    if (cost > MAX_EXECUTION_COST) {
      await supabase
        .from('executions')
        .update({ status: 'failed', error_message: 'Cost exceeds per-execution ceiling.' })
        .eq('id', execution.id);
      return NextResponse.json(
        { error: `Computed cost (${cost}) exceeds the per-execution maximum (${MAX_EXECUTION_COST}). This is likely a configuration bug — please contact support.` },
        { status: 400 }
      );
    }

    if (cost > 0) {
      console.log(`[Execution/Start] Debiting ${cost} credits from user ${authedUserId} for execution ${execution.id}`);
      const { error: debitError } = await supabase.rpc('debit_tokens', {
        p_user_id: authedUserId,
        p_amount: cost,
        p_reason: 'execution_debit',
        p_idempotency_key: `exec:${execution.id}`,
        p_execution_id: execution.id,
        p_metadata: { mode: mode ?? 'all', node_count: nodesToExecute.length },
      });

      if (debitError) {
        const isInsufficient = (debitError as any).message?.includes('INSUFFICIENT_TOKENS');
        await supabase
          .from('executions')
          .update({
            status: 'failed',
            error_message: isInsufficient ? 'Insufficient credits' : `Debit failed: ${debitError.message}`,
          })
          .eq('id', execution.id);

        if (isInsufficient) {
          return NextResponse.json(
            { error: 'INSUFFICIENT_TOKENS', message: 'Not enough credits to run this execution.' },
            { status: 402 }
          );
        }
        console.error('[Execution/Start] Debit failed:', debitError);
        return NextResponse.json(
          { error: `Debit failed: ${debitError.message}` },
          { status: 500 }
        );
      }
    }

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

    // "Initially running" set: graph-topological roots PLUS any node whose
    // every parent in the execution set is ephemeral (prompt, media_input,
    // blur, compositor — server-side handlers that run in <100ms). These
    // downstream nodes are what the user actually perceives as generating;
    // marking them 'pending' costs ~2s of "idle-looking" UI on a refresh
    // mid-execution while the orchestrator's realtime 'running' event
    // propagates. The dispatch loop below still walks ONLY graph roots —
    // this set is for the initial node_results status only.
    const initiallyRunningIds = new Set<string>(rootNodeIds);
    for (const node of nodesToExecute) {
      if (initiallyRunningIds.has(node.id)) continue;
      const parentEdgesInSet = edgesToInclude.filter(e => e.target === node.id);
      if (parentEdgesInSet.length === 0) continue;
      const allParentsEphemeral = parentEdgesInSet.every(e => {
        const parent = nodesToExecute.find(n => n.id === e.source);
        return !!parent && isEphemeralNode(parent.type);
      });
      if (allParentsEphemeral) initiallyRunningIds.add(node.id);
    }

    const initialNodeResults = nodesToExecute.map((node: NodeConfig) => ({
      execution_id: execution.id,
      node_id: node.id,
      session_id: session_id,
      // Stamp the source node type once, here at the single creation point for
      // every row. Later upserts (dispatch, ephemeral executor, webhooks) merge
      // on (execution_id, node_id) and don't include node_type, so they retain
      // this value. Asset views read it to hide reference-only rows (character).
      node_type: node.type,
      status: initiallyRunningIds.has(node.id) ? 'running' : 'pending',
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

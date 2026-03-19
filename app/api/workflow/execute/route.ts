import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow, executeWorkflowFromNode, validateWorkflow, stripHeavyNodeData } from '@/lib/workflow-engine';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { saveExecution, upsertNodeExecution, clearSessionExecutions } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';
import { generateNodeId } from '@/lib/utils';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { validateWorkflowState, logValidationResults } from '@/lib/workflow/validate-node-state';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * CONCURRENCY FIX: Create a fresh Supabase admin client for every request.
 */
function createAdminClient() {
    return createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
        global: {
            fetch: (url, options) =>
                fetch(url, {
                    ...options,
                    keepalive: true,
                }),
        },
        realtime: {
            params: {
                eventsPerSecond: 10,
            },
        },
    });
}

/**
 * Helper: Get all downstream node IDs from a given node
 */
function getDownstreamNodeIds(workflow: any, startNodeId: string): string[] {
    const downstreamIds = new Set<string>();
    const queue = [startNodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        // Find all edges where this node is the source
        const outgoingEdges = workflow.edges.filter((e: any) => e.source === nodeId);
        outgoingEdges.forEach((edge: any) => {
            if (!downstreamIds.has(edge.target)) {
                downstreamIds.add(edge.target);
                queue.push(edge.target);
            }
        });
    }

    return Array.from(downstreamIds);
}


export async function POST(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;
        const { user } = auth;

        const body = await request.json();
        const { workflow, sessionId, runFromNodeId, runMode, executionId: clientExecutionId } = body;

        if (!sessionId) {
            return NextResponse.json({ error: 'Missing mandatory sessionId context' }, { status: 400 });
        }

        if (!workflow || !workflow.nodes) {
            return NextResponse.json({ error: 'Invalid workflow' }, { status: 400 });
        }

        const validation = validateWorkflow(workflow as Workflow);
        if (!validation.valid) {
            return NextResponse.json({ success: false, error: 'Workflow validation failed', errors: validation.errors }, { status: 400 });
        }

        const executionId = clientExecutionId || generateNodeId();
        const userId = user.id;

        // STAGE 1: Pre-flight - Initialize relevant nodes to 'idle' for immediate UI feedback
        // This happens BEFORE waitUntil, so the DB is updated before the 202 response
        const adminSupabaseSync = createAdminClient();
        
        // For targeted execution, only initialize nodes that will actually run
        let nodeIdsToInitialize: string[];
        if (runMode === 'solo' && runFromNodeId) {
            // Solo mode: Only initialize the single target node
            nodeIdsToInitialize = [runFromNodeId];
        } else if (runMode === 'chain' && runFromNodeId) {
            // Chain mode: Initialize target and its downstream nodes
            const targetNode = workflow.nodes.find((n: any) => n.id === runFromNodeId);
            if (targetNode) {
                const downstreamIds = getDownstreamNodeIds(workflow, runFromNodeId);
                nodeIdsToInitialize = [runFromNodeId, ...downstreamIds];
            } else {
                nodeIdsToInitialize = [runFromNodeId];
            }
        } else {
            // Full workflow: Initialize all nodes
            nodeIdsToInitialize = workflow.nodes.map((n: any) => n.id);
        }
        
        // ✅ PHASE 3 FIX: Initialize nodes in node_executions table (not canvas_state)
        for (const nodeId of nodeIdsToInitialize) {
            await upsertNodeExecution(sessionId, nodeId, 'pending');
        }

        // 1. Fetch ALL existing node executions to hydrate the engine's cache
        // This is critical for chain/solo runs where ancestors might already be completed
        const { data: existingExecutions } = await adminSupabaseSync
            .from('node_executions')
            .select('node_id, status, output')
            .eq('session_id', sessionId);

        const cachedOutputs: Record<string, any> = {};
        if (existingExecutions) {
            existingExecutions.forEach((exec: any) => {
                if (exec.status === 'success' && exec.output) {
                    // Strip metadata for engine consumption
                    const rawOutput = exec.output?._metadata ? { ...exec.output } : exec.output;
                    if (rawOutput?._metadata) delete rawOutput._metadata;
                    cachedOutputs[exec.node_id] = rawOutput;
                }
            });
        }

        // LOGGING: Execution lifecycle start
        const executionStartTime = Date.now();
        console.log(`[Execution:${executionId}] START - sessionId: ${sessionId}, mode: ${runMode}, targetNode: ${runFromNodeId || 'all'}, nodesQueued: ${nodeIdsToInitialize.length}, cachedNodes: ${Object.keys(cachedOutputs).length}`);

        waitUntil((async () => {
            const adminSupabase = createAdminClient();

            try {
                const { persistNodeOutputs } = await import('@/lib/workflow/persist-node');
                const { computeNodeHash } = await import('@/lib/nodes/hash-inputs');

                const totalNodes = workflow.nodes.length;
                let completedNodeCount = 0;

                const actionDescriptions: Record<string, string> = {
                    ai_generate_image: 'Generating AI image',
                    ai_generator: 'Generating with AI model', // ✅ PHASE 2 FIX: Add ai_generator description
                    media_input: 'Processing upload',
                    compositor: 'Compositing layers',
                    prompt: 'Setting prompt',
                };

                const execChannel = adminSupabase.channel(`execution_${sessionId}`);

                await new Promise<void>((resolve) => {
                    execChannel.subscribe((status) => {
                        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            resolve();
                        }
                    });
                });

                const onStatusUpdate = async (nodeId: string, status: string, currentWorkflow?: any) => {
                    const payload: any = { nodeId, status, executionId };
                    
                    // LOGGING: Status update
                    const elapsed = Date.now() - executionStartTime;
                    console.log(`[Execution:${executionId}] STATUS_UPDATE - node: ${nodeId}, status: ${status}, elapsed: ${elapsed}ms`);

                    // Prepare DB update data
                    const dbUpdate: any = { status };

                    if (status === 'success' && currentWorkflow) {
                        const node = currentWorkflow.nodes.find((n: any) => n.id === nodeId);
                        if (node) {
                            const nodeOutput = node.data?.output;
                            const nodeMetadata = node.data?.outputMetadata;
                            
                            // Check for base64 to avoid bloating DB
                            const hasBase64 = Array.isArray(nodeOutput)
                                ? nodeOutput.some((o: any) => typeof o?.url === 'string' && o.url.startsWith('data:'))
                                : typeof nodeOutput?.url === 'string' && nodeOutput.url.startsWith('data:');

                            if (nodeOutput && !hasBase64) {
                                dbUpdate.output = nodeOutput;
                                payload.output = nodeOutput;
                            }

                            if (nodeMetadata) {
                                dbUpdate.outputMetadata = nodeMetadata;
                                if (nodeMetadata.thumbnailUrls) {
                                    payload.outputMetadata = { thumbnailUrls: nodeMetadata.thumbnailUrls };
                                }
                            }
                        }
                    } else if (status === 'error' && currentWorkflow) {
                        const node = currentWorkflow.nodes.find((n: any) => n.id === nodeId);
                        if (node?.data?.error) {
                            dbUpdate.error = node.data.error;
                        }
                    }

                    // ✅ PHASE 3 FIX: Write to node_executions table (Primary Source of Truth)
                    try {
                        await upsertNodeExecution(
                            sessionId,
                            nodeId,
                            dbUpdate.status!,
                            dbUpdate.output,
                            dbUpdate.error,
                            dbUpdate.outputMetadata
                        );
                    } catch (e) {
                        console.error('[API/Execute] DB update failed for node', nodeId, ':', e);
                    }

                    // Broadcast for low-latency UI updates (Secondary, Optional)
                    try {
                        await execChannel.send({
                            type: 'broadcast',
                            event: 'node_execution',
                            payload,
                        });
                    } catch (e) {
                        console.warn('[API/Execute] Broadcast failed:', e);
                    }

                    if (status === 'running') {
                        const node = workflow.nodes.find((n: any) => n.id === nodeId);
                        const action = node ? (actionDescriptions[node.type] || 'Processing') : 'Processing';
                        const stepMsg = `${action} (${completedNodeCount + 1}/${totalNodes})`;
                        Promise.resolve(adminSupabase.from('sessions').update({ status_message: stepMsg }).eq('id', sessionId))
                            .catch((e: any) => console.warn('[API/Execute] Status update failed:', e));
                    } else if (status === 'success' || status === 'error') {
                        completedNodeCount++;
                    }
                };

                const onNodePersist = async (
                    nodeId: string,
                    nodeType: string,
                    config: any,
                    inputUrls: string[],
                    output: any,
                    prevThumbnailPaths: string[] = [],
                    isLeafNode: boolean = false,
                    forceOverwrite: boolean = false
                ) => {
                    const isEphemeral = sharedRegistry[nodeType]?.meta?.ephemeral;

                    if (isEphemeral) {
                        let rawUrls: string[] = [];
                        if (Array.isArray(output)) {
                            rawUrls = output.filter((o: any) => o?.url).map((o: any) => o.url);
                        } else if (output?.url) {
                            rawUrls = [output.url];
                        }

                        return {
                            thumbnailPaths: [],
                            thumbnailUrls: rawUrls,
                            resultPaths: [],
                            resultUrls: isLeafNode ? rawUrls : [],
                            computedHash: `ephemeral-${Date.now()}`
                        };
                    }

                    return persistNodeOutputs(
                        adminSupabase,
                        { userId, sessionId, nodeId, nodeType, config, inputUrls, output },
                        prevThumbnailPaths,
                        isLeafNode,
                        computeNodeHash,
                        forceOverwrite
                    );
                };

                let result;
                if (runFromNodeId) {
                    result = await executeWorkflowFromNode(
                        workflow as Workflow,
                        executionId,
                        runFromNodeId,
                        cachedOutputs,
                        onStatusUpdate,
                        undefined,
                        onNodePersist,
                        runMode || 'chain',
                        userId,
                        sessionId
                    );
                } else {
                    result = await executeWorkflow(
                        workflow as Workflow,
                        executionId,
                        onStatusUpdate,
                        undefined,
                        cachedOutputs,
                        onNodePersist,
                        userId,
                        sessionId
                    );
                }

                if (sessionId) {
                    await saveExecution(sessionId, result.success ? 'completed' : 'failed', result.result, result.error);
                }

                // LOGGING: Execution completion
                const totalElapsed = Date.now() - executionStartTime;
                console.log(`[Execution:${executionId}] COMPLETE - success: ${result.success}, elapsed: ${totalElapsed}ms, error: ${result.error || 'none'}`);

                // VALIDATION: Check final workflow state consistency
                const validationResults = validateWorkflowState(workflow);
                logValidationResults(validationResults, `Execution:${executionId}:FinalState`);

                if (sessionId) {
                    await adminSupabase.from('sessions').update({
                        status_message: result.success ? null : 'Execution failed',
                    }).eq('id', sessionId);
                }

            } catch (err) {
                console.error('[API/Execute] Background execution crashed:', err);
                const totalElapsed = Date.now() - executionStartTime;
                console.log(`[Execution:${executionId}] CRASHED - elapsed: ${totalElapsed}ms, error: ${err}`);
                if (sessionId) {
                    await adminSupabase.from('sessions').update({ status_message: 'Execution crashed' }).eq('id', sessionId);
                }
            }
        })());

        return NextResponse.json({
            success: true,
            executionId,
            message: 'Execution started in background',
        }, { status: 202 });

    } catch (error: any) {
        console.error('Error executing workflow:', error);
        return NextResponse.json({ success: false, error: 'Unknown error' }, { status: 500 });
    }
}

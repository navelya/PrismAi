import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow, executeWorkflowFromNode, validateWorkflow, stripHeavyNodeData } from '@/lib/workflow-engine';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { saveExecution } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';
import { generateNodeId } from '@/lib/utils';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * CONCURRENCY FIX: Create a fresh Supabase admin client for every request.
 *
 * The old pattern used a module-level singleton `adminSupabase`. Under concurrent
 * load, multiple `waitUntil` tasks shared that singleton's Realtime connection pool.
 * When one task's channel was torn down (or the socket was reset), the shared pool
 * threw `ECONNRESET` / `ConnectTimeoutError` for all other in-flight tasks.
 *
 * Each request now gets its own independent connection pool, eliminating that race.
 */
function createAdminClient() {
    return createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
        global: {
            fetch: (url, options) =>
                fetch(url, {
                    ...options,
                    // Increase keepalive to survive long-running AI model calls
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

export async function POST(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;
        const { user } = auth;

        const body = await request.json();
        const { workflow, sessionId, runFromNodeId, runMode } = body;

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

        const executionId = generateNodeId();
        const userId = user.id;

        waitUntil((async () => {
            // ── Per-request isolated client (concurrency-safe) ────────────────
            const adminSupabase = createAdminClient();

            try {
                const { persistNodeOutputs } = await import('@/lib/workflow/persist-node');
                const { computeNodeHash } = await import('@/lib/nodes/hash-inputs');

                const totalNodes = workflow.nodes.length;
                let completedNodeCount = 0;

                const actionDescriptions: Record<string, string> = {
                    ai_generate_image: 'Generating AI image',
                    media_input: 'Processing upload',
                    compositor: 'Compositing layers',
                    prompt: 'Setting prompt',
                };

                // ── Execution broadcast channel ───────────────────────────────
                const execChannel = adminSupabase.channel(`execution_${sessionId}`);

                await new Promise<void>((resolve) => {
                    execChannel.subscribe((status) => {
                        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            resolve();
                        }
                    });
                });

                /**
                 * ZERO-LATENCY FIX:
                 * Broadcast thumbnailUrls inline inside this same onStatusUpdate callback.
                 * The old architecture waited for a separate `handleSessionUpdate` round-trip
                 * (postgres_changes on the sessions table) to deliver image URLs to the UI —
                 * which caused 3-5 second delays after the server finished.
                 *
                 * Now: persist → get URLs → broadcast SUCCESS + URLs atomically in one payload.
                 * The client receives the image URL the exact millisecond the server is done.
                 */
                const onStatusUpdate = async (nodeId: string, status: string, currentWorkflow?: any) => {
                    const payload: any = { nodeId, status };

                    // 🛠️ DEBUG LOG: Track every broadcast to verify the feedback loop
                    console.log(`[API/Execute] Broadcasting: Node=${nodeId}, Status=${status}`);

                    if (status === 'success' && currentWorkflow) {
                        const node = currentWorkflow.nodes.find((n: any) => n.id === nodeId);
                        if (node) {
                            const thumbnailUrls = node.data?.outputMetadata?.thumbnailUrls;
                            if (Array.isArray(thumbnailUrls) && thumbnailUrls.length > 0) {
                                // ✅ Safe: these are compact Supabase Storage URLs (~200 chars each), not base64
                                payload.outputMetadata = { thumbnailUrls };
                            } else if (node.data?.output) {
                                // For text/non-image nodes — guard against accidental base64 blobs
                                const out = node.data.output;
                                const hasBase64 = Array.isArray(out)
                                    ? out.some((o: any) => typeof o?.url === 'string' && o.url.startsWith('data:'))
                                    : typeof out?.url === 'string' && out.url.startsWith('data:');

                                if (!hasBase64) {
                                    payload.output = out;
                                }
                                if (node.data.outputMetadata) {
                                    payload.outputMetadata = node.data.outputMetadata;
                                }
                            }
                        }
                    }

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
                        // Fire-and-forget: status message on sessions table
                        Promise.resolve(adminSupabase.from('sessions').update({ status_message: stepMsg }).eq('id', sessionId))
                            .catch((e: any) => console.warn('[API/Execute] Status update failed:', e));
                    } else if (status === 'success' || status === 'error') {
                        completedNodeCount++;
                    }
                };

                /**
                 * Dual-save persist callback — node-isolated, concurrency-safe.
                 * Folder-level wipe happens inside persistNodeOutputs before upload.
                 */
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
                    // GENERIC BYPASS: If a node is marked as ephemeral (e.g. Compositor)
                    // it means it just reorganizes/displays existing data. We completely skip Supabase 
                    // storage uploads and cache DB inserts, and instantly pipe the live data back 
                    // to the engine so the UI sees it.
                    const isEphemeral = sharedRegistry[nodeType]?.meta?.ephemeral;

                    if (isEphemeral) {
                        // Extract URLs from current output (which might be an array or object from the node's executor)
                        let rawUrls: string[] = [];
                        if (Array.isArray(output)) {
                            rawUrls = output.filter((o: any) => o?.url).map((o: any) => o.url);
                        } else if (output?.url) {
                            rawUrls = [output.url];
                        }

                        // Fake the persistence metadata so the UI engine renders the images perfectly 
                        // without us ever saving them to the DB or dragging down the network.
                        return {
                            thumbnailPaths: [], // No DB path
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

                // ── Execute ───────────────────────────────────────────────────
                let result;
                if (runFromNodeId) {
                    result = await executeWorkflowFromNode(
                        workflow as Workflow,
                        executionId,
                        runFromNodeId,
                        {},
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
                        undefined,
                        onNodePersist,
                        userId,
                        sessionId
                    );
                }

                // ── Post-run persistence ──────────────────────────────────────
                if (workflow.id) {
                    await saveExecution(workflow.id, result.success ? 'completed' : 'failed', result.result, result.error);
                }

                if (sessionId) {
                    await adminSupabase.from('sessions').update({
                        status_message: result.success ? null : 'Execution failed',
                        canvas_state: stripHeavyNodeData(workflow),
                    }).eq('id', sessionId);
                }

            } catch (err) {
                console.error('[API/Execute] Background execution crashed:', err);
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

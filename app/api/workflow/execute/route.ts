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

        waitUntil((async () => {
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

                    if (status === 'success' && currentWorkflow) {
                        const node = currentWorkflow.nodes.find((n: any) => n.id === nodeId);
                        if (node) {
                            const thumbnailUrls = node.data?.outputMetadata?.thumbnailUrls;
                            if (Array.isArray(thumbnailUrls) && thumbnailUrls.length > 0) {
                                payload.outputMetadata = { thumbnailUrls };
                            } else if (node.data?.output) {
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

                if (sessionId) {
                    await saveExecution(sessionId, result.success ? 'completed' : 'failed', result.result, result.error);
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

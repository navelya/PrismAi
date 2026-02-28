import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow, validateWorkflow, stripHeavyNodeData } from '@/lib/workflow-engine';
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
const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
});

export async function POST(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;
        const { user } = auth;

        const body = await request.json();
        const { workflow, sessionId } = body;

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
            try {
                const { persistNodeOutputs } = await import('@/lib/workflow/persist-node');
                const { computeNodeHash } = await import('@/lib/nodes/hash-inputs');

                const totalNodes = workflow.nodes.length;
                let completedNodeCount = 0;

                const actionDescriptions: Record<string, string> = {
                    scrape_images: 'Searching for images',
                    remove_background: 'Removing background',
                    filter_sort: 'Filtering results',
                    ai_generate_image: 'Generating AI image',
                    upscale_image: 'Upscaling image',
                    merge_image: 'Merging images',
                    media_input: 'Processing upload',
                    compositor: 'Compositing layers',
                };

                const onStatusUpdate = async (nodeId: string, status: string, currentWorkflow?: any) => {
                    if (!sessionId) return;

                    if (status === 'running') {
                        const node = workflow.nodes.find((n: any) => n.id === nodeId);
                        const action = node ? (actionDescriptions[node.type] || 'Processing') : 'Processing';
                        const stepMsg = `${action} (${completedNodeCount + 1}/${totalNodes})`;
                        const payload: Record<string, any> = { status_message: stepMsg };
                        if (currentWorkflow) payload.canvas_state = stripHeavyNodeData(currentWorkflow);

                        Promise.resolve(adminSupabase.from('sessions').update(payload).eq('id', sessionId))
                            .catch((e) => console.warn('[API/Execute] Status broadcast failed:', e));
                    } else if (status === 'success' || status === 'error') {
                        completedNodeCount++;
                        if (currentWorkflow) {
                            Promise.resolve(
                                adminSupabase.from('sessions')
                                    .update({ canvas_state: stripHeavyNodeData(currentWorkflow) })
                                    .eq('id', sessionId)
                            ).catch((e) => console.warn('[API/Execute] Success/Error broadcast failed:', e));
                        }
                    }
                };

                /**
                 * Dual-save persist callback:
                 *   isLeafNode=true  → thumbnail + flat result under {sessionId}/
                 *   isLeafNode=false → thumbnail only under {sessionId}/thumbnails/{nodeId}/
                 */
                const onNodePersist = async (
                    nodeId: string,
                    nodeType: string,
                    config: any,
                    inputUrls: string[],
                    output: any,
                    prevThumbnailPaths: string[] = [],
                    isLeafNode: boolean = false,
                ) => persistNodeOutputs(
                    adminSupabase,
                    { userId, sessionId: sessionId ?? 'manual', nodeId, nodeType, config, inputUrls, output },
                    prevThumbnailPaths,
                    isLeafNode,
                    computeNodeHash,
                );

                const result = await executeWorkflow(
                    workflow as Workflow,
                    executionId,
                    onStatusUpdate,
                    undefined,
                    undefined,
                    onNodePersist,
                );

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

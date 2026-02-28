import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { parseRequestToWorkflow } from '@/lib/ai/parse-workflow';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { waitUntil } from '@vercel/functions';
import { stripHeavyNodeData } from '@/lib/workflow-engine';

export const maxDuration = 300; // Allow up to 5 minutes for generation

/**
 * POST /api/chat/send — Async Chat Message Handler
 * 
 * This endpoint:
 * 1. Inserts user message + assistant placeholder immediately
 * 2. Returns 200 OK with message IDs (frontend shows placeholder)
 * 3. Continues processing the LLM generation AFTER the response is sent using Vercel waitUntil
 * 4. Updates the assistant message in DB when done → triggers Supabase Realtime
 * 
 * The frontend uses Supabase Realtime to pick up the completed response,
 * so it works even if the user navigated away while waiting.
 */
export async function POST(request: Request) {
    try {
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;
        const { user, supabase } = auth;

        const body = await request.json();
        const { sessionId, prompt, previousWorkflow, attachedImages, imagePaths } = body;

        if (!sessionId || !prompt) {
            return NextResponse.json(
                { error: 'sessionId and prompt are required' },
                { status: 400 },
            );
        }

        // Verify session ownership
        const { data: session } = await supabase
            .from('sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', user.id)
            .single();

        if (!session) {
            return NextResponse.json(
                { error: 'Session not found or access denied' },
                { status: 404 },
            );
        }

        const now = new Date().toISOString();

        // 1. Insert user message (completed immediately)
        const { data: userMessage, error: userMsgError } = await supabase
            .from('messages')
            .insert({
                session_id: sessionId,
                role: 'user',
                content: prompt,
                images: imagePaths || [],
                status: 'completed',
                created_at: now,
            })
            .select()
            .single();

        if (userMsgError) {
            console.error('[Send] Failed to insert user message:', userMsgError);
            return NextResponse.json({ error: userMsgError.message }, { status: 500 });
        }

        // 2. Insert assistant placeholder (processing)
        const { data: assistantMessage, error: assistantMsgError } = await supabase
            .from('messages')
            .insert({
                session_id: sessionId,
                role: 'assistant',
                content: '',
                status: 'processing',
                created_at: new Date(Date.now() + 1).toISOString(),
            })
            .select()
            .single();

        if (assistantMsgError) {
            console.error('[Send] Failed to insert assistant placeholder:', assistantMsgError);
            return NextResponse.json({ error: assistantMsgError.message }, { status: 500 });
        }

        // 3. Update session timestamp
        await supabase
            .from('sessions')
            .update({ updated_at: now })
            .eq('id', sessionId);

        // 4. Trigger the background worker natively using waitUntil (Fire-and-Forget)
        waitUntil((async () => {
            try {
                const adminSupabase = createServiceClient();
                console.log('[Worker] Starting AI generation for message:', assistantMessage.id);

                // Call the LLM
                const result = await parseRequestToWorkflow(
                    prompt,
                    previousWorkflow || null,
                    attachedImages || undefined,
                );

                if (!result.success) {
                    throw new Error(result.error || 'Failed to generate workflow');
                }

                // Build the update payload based on response type
                const updatePayload: Record<string, any> = {
                    status: 'completed',
                };

                if (result.type === 'chat') {
                    updatePayload.content = result.message || "I'm not sure how to respond to that.";
                    updatePayload.metadata = { type: 'chat' };
                } else if (result.type === 'undo') {
                    updatePayload.content = result.message || 'Undoing changes...';
                    updatePayload.metadata = { type: 'undo' };
                } else if (result.type === 'workflow') {
                    updatePayload.content = result.message || '';
                    updatePayload.workflow = result.workflow;
                    updatePayload.metadata = { type: 'workflow' };

                    // Instantly broadcast the initial workflow JSON to Realtime UI
                    try {
                        console.log('[Worker] Broadcast initial workflow blueprint to Realtime UI...');
                        await adminSupabase
                            .from('messages')
                            .update({ workflow: result.workflow })
                            .eq('id', assistantMessage.id);

                        const initSessionUpdate: Record<string, any> = { canvas_state: result.workflow };

                        if (result.workflow!.name && result.workflow!.name !== 'New Workflow' && result.workflow!.name !== 'Workflow') {
                            let officialTitle = result.workflow!.name.replace(/^Workflow:\s*/i, '');
                            if (officialTitle.length > 2) initSessionUpdate.title = officialTitle;
                        }

                        await adminSupabase
                            .from('sessions')
                            .update(initSessionUpdate)
                            .eq('id', sessionId);

                    } catch (broadcastErr) {
                        console.error('[Worker] Failed to broadcast initial blueprint:', broadcastErr);
                    }

                    // ── Execute workflow with per-node Storage persist + hash deduplification ──
                    try {
                        console.log('[Worker] Executing workflow server-side...');
                        const { executeWorkflow, stripHeavyNodeData: stripHeavy } = await import('@/lib/workflow-engine');
                        const { computeNodeHash } = await import('@/lib/nodes/hash-inputs');

                        // Fetch userId for storage paths (needed inside closure)
                        const { data: sessionData } = await adminSupabase
                            .from('sessions')
                            .select('user_id')
                            .eq('id', sessionId)
                            .single();
                        const userId = sessionData?.user_id || 'unknown';

                        // Node type → human-readable action descriptions
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

                        const totalNodes = result.workflow!.nodes.length;
                        let completedNodeCount = 0;

                        const onStatusUpdate = async (nodeId: string, status: string, currentWorkflow?: any) => {
                            if (status === 'running') {
                                const node = result.workflow!.nodes.find((n: any) => n.id === nodeId);
                                const action = node ? (actionDescriptions[node.type] || 'Processing') : 'Processing';
                                const stepMsg = `${action} (${completedNodeCount + 1}/${totalNodes})`;
                                const payload: Record<string, any> = { status_message: stepMsg };
                                if (currentWorkflow) payload.canvas_state = stripHeavy(currentWorkflow);
                                Promise.resolve(
                                    adminSupabase.from('sessions').update(payload).eq('id', sessionId)
                                ).catch((e) => console.warn('[Worker] Status broadcast failed:', e));
                            } else if (status === 'success' || status === 'error') {
                                completedNodeCount++;
                                if (currentWorkflow) {
                                    Promise.resolve(
                                        adminSupabase.from('sessions')
                                            .update({ canvas_state: stripHeavy(currentWorkflow) })
                                            .eq('id', sessionId)
                                    ).catch((e) => console.warn('[Worker] Success/Error broadcast failed:', e));
                                }
                            }
                        };

                        /**
                         * Per-node persist callback — delegates to shared dual-save helper.
                         *   isLeafNode=true  → thumbnail + flat result (leaf nodes only)
                         *   isLeafNode=false → thumbnail only (intermediate nodes)
                         */
                        const { persistNodeOutputs } = await import('@/lib/workflow/persist-node');

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
                            { userId, sessionId, nodeId, nodeType, config, inputUrls, output },
                            prevThumbnailPaths,
                            isLeafNode,
                            computeNodeHash,
                        );

                        // Execute the full workflow graph
                        const executeData = await executeWorkflow(
                            result.workflow!,
                            'server-' + Date.now().toString(),
                            onStatusUpdate,
                            undefined,    // onNodeOutput
                            undefined,    // cachedOutputs
                            onNodePersist,
                        );

                        // ── Build processedResult from terminal nodes' RESULT URLs ──────────
                        // Terminal nodes = nodes with no outgoing edges.
                        // We use resultUrls (permanent) — not thumbnailUrls — for chat history.
                        let uploadedPaths: string[] = [];
                        let processedResult = executeData.result;

                        if (result.workflow!.nodes && result.workflow!.edges) {
                            // Collect all storage paths (thumbnail + result) from every node
                            result.workflow!.nodes.forEach((node: any) => {
                                const meta = node.data?.outputMetadata;
                                if (Array.isArray(meta?.thumbnailPaths)) uploadedPaths.push(...meta.thumbnailPaths);
                                if (Array.isArray(meta?.resultPaths)) uploadedPaths.push(...meta.resultPaths);
                            });

                            // Find terminal nodes (no outgoing edges)
                            const edgeSources = new Set(
                                (result.workflow!.edges as any[]).map((e: any) => e.source)
                            );
                            const terminalNodes = result.workflow!.nodes.filter(
                                (n: any) => !edgeSources.has(n.id)
                            );

                            // Build chat result from resultUrls (permanent session history)
                            const persistedItems: any[] = terminalNodes.flatMap((node: any) => {
                                const resultUrls: string[] = (node.data as any)?.outputMetadata?.resultUrls ?? [];
                                if (resultUrls.length > 0) {
                                    const rawOutput: any[] = Array.isArray(executeData.result)
                                        ? executeData.result : [];
                                    return resultUrls.map((url: string, idx: number) => {
                                        const rawItem = rawOutput[idx];
                                        return rawItem
                                            ? { ...rawItem, url }   // preserve metadata, swap to Storage URL
                                            : { url, metadata: { title: `Output ${idx + 1}`, source: node.type } };
                                    });
                                }
                                return [];  // non-image terminal node — raw result used as fallback below
                            });

                            if (persistedItems.length > 0) {
                                processedResult = persistedItems;
                            }
                        }

                        updatePayload.metadata = {
                            type: 'workflow',
                            execution_result: processedResult,
                            execution_error: executeData.error,
                        };
                        if (uploadedPaths.length > 0) {
                            updatePayload.images = uploadedPaths;
                        }
                        if (executeData.error) {
                            updatePayload.content = `⚠️ Workflow executed partially.\n${executeData.error}`;
                        } else if (!executeData.result && result.workflow!.nodes.length > 0) {
                            updatePayload.content = `✅ Workflow finished, but produced no output.`;
                        }

                        console.log('[Worker] Workflow execution finished. Error:', executeData.error || 'None');

                    } catch (execError: any) {
                        console.error('[Worker] FATAL execution engine crash:', execError);
                        updatePayload.metadata = {
                            type: 'workflow',
                            execution_error: execError.message,
                        };
                        updatePayload.content = `⚠️ Workflow engine crashed during execution.\n${execError.message}`;
                    }
                }

                // Strip heavy base64 strings so they don't break the Supabase timeout limit
                if (result.type === 'workflow') {
                    updatePayload.workflow = stripHeavyNodeData(result.workflow!);
                }

                // Write the completed response to the database -> triggers Realtime UI updates
                const { error: updateError } = await adminSupabase
                    .from('messages')
                    .update(updatePayload)
                    .eq('id', assistantMessage.id);

                if (updateError) {
                    console.error('[Worker] Failed to update message:', updateError);
                    throw updateError;
                }

                console.log('[Worker] AI generation completed:', result.type);

                // Update session: timestamp + canvas_state for workflow responses
                const sessionUpdate: Record<string, any> = {
                    updated_at: new Date().toISOString(),
                    status_message: null,
                };
                if (result.type === 'workflow' && result.workflow) {
                    sessionUpdate.canvas_state = stripHeavyNodeData(result.workflow);

                    if (result.workflow.name && result.workflow.name !== 'New Workflow' && result.workflow.name !== 'Workflow') {
                        let officialTitle = result.workflow.name.replace(/^Workflow:\s*/i, '');
                        if (officialTitle.length > 2) sessionUpdate.title = officialTitle;
                    }
                }
                await adminSupabase
                    .from('sessions')
                    .update(sessionUpdate)
                    .eq('id', sessionId);

            } catch (error: any) {
                console.error('==========================================');
                console.error('[Worker] BACKGROUND AI ERROR:', error);
                console.error('Stack:', error.stack);
                console.error('==========================================');

                try {
                    const fallbackSupabase = createServiceClient();
                    const { error: fallbackError } = await fallbackSupabase
                        .from('messages')
                        .update({
                            status: 'failed',
                            content: `Sorry, I encountered an error during generation: ${error.message || 'Unknown error'}`,
                            metadata: { type: 'error', error: error.message, stack: error.stack },
                        })
                        .eq('id', assistantMessage.id);

                    if (fallbackError) {
                        console.error('[Worker] CRITICAL: Failed to write fallback error to DB:', fallbackError);
                    } else {
                        console.log('[Worker] Automatically logged failure to database for message:', assistantMessage.id);
                    }
                } catch (fallbackEx) {
                    console.error('[Worker] FATAL Exception during fallback write:', fallbackEx);
                }
            }
        })());

        // 5. Return immediately with both message IDs
        return NextResponse.json({
            success: true,
            userMessage,
            assistantMessage,
        });

    } catch (error: any) {
        console.error('❌ /api/chat/send error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 },
        );
    }
}

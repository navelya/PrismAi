import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { parseRequestToWorkflow } from '@/lib/ai/parse-workflow';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { waitUntil } from '@vercel/functions';

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
        // This keeps the Vercel serverless function alive to complete the LLM generation
        // even after the 200 OK is returned to the client immediately below.
        waitUntil((async () => {
            try {
                const adminSupabase = createServiceClient();
                console.log('[Worker] Starting AI generation for message:', assistantMessage.id);

                // Call the LLM (this is the long-running part)
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
                    // For workflow responses, store the workflow JSON in the dedicated column
                    // User explicitly requested NO AI text bubble for workflows, only the results.
                    updatePayload.content = result.message || '';
                    updatePayload.workflow = result.workflow;
                    updatePayload.metadata = { type: 'workflow' }; // FIX: Explicitly mark as workflow to survive Postges TOAST truncation

                    // 1. INSTANT UX FIX: Instantly broadcast the initial workflow JSON to Realtime
                    // This allows the frontend to show the Editor button IMMEDIATELY before execution starts.
                    try {
                        console.log('[Worker] Broadcast initial workflow blueprint to Realtime UI...');
                        await adminSupabase
                            .from('messages')
                            .update({ workflow: result.workflow })
                            .eq('id', assistantMessage.id);

                        // ALSO explicitly update canvas_state in the active session so refreshing/navigating back hydrates instantly
                        await adminSupabase
                            .from('sessions')
                            .update({ canvas_state: result.workflow })
                            .eq('id', sessionId);

                    } catch (broadcastErr) {
                        console.error('[Worker] Failed to broadcast initial blueprint:', broadcastErr);
                    }

                    try {
                        console.log('[Worker] Executing workflow server-side...');
                        // Import dynamically to avoid edge runtime issues if any
                        const { executeWorkflow } = await import('@/lib/workflow-engine');

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
                        let completedNodes = 0;

                        // Broadcast progress: update sessions.status_message on each node start
                        const onStatusUpdate = async (nodeId: string, status: string, currentWorkflow?: any) => {
                            if (status === 'running') {
                                const node = result.workflow!.nodes.find((n: any) => n.id === nodeId);
                                const action = node ? (actionDescriptions[node.type] || 'Processing') : 'Processing';
                                const stepMsg = `${action} (${completedNodes + 1}/${totalNodes})`;

                                // Payload for Realtime sync
                                const payload: Record<string, any> = { status_message: stepMsg };
                                if (currentWorkflow) payload.canvas_state = currentWorkflow;

                                // Fire-and-forget — MUST resolve as Promise to actually execute
                                Promise.resolve(
                                    adminSupabase
                                        .from('sessions')
                                        .update(payload)
                                        .eq('id', sessionId)
                                ).catch((e) => console.warn('[Worker] Status broadcast failed:', e));
                            } else if (status === 'success' || status === 'error') {
                                completedNodes++;
                                // Also blast the workflow state on completion so thumbnails show up immediately
                                if (currentWorkflow) {
                                    Promise.resolve(
                                        adminSupabase
                                            .from('sessions')
                                            .update({ canvas_state: currentWorkflow })
                                            .eq('id', sessionId)
                                    ).catch((e) => console.warn('[Worker] Success/Error broadcast failed:', e));
                                }
                            }
                        };

                        // Execute the full graph with progress callback
                        const executeData = await executeWorkflow(
                            result.workflow!,
                            'server-' + Date.now().toString(),
                            onStatusUpdate,
                        );

                        let uploadedPaths: string[] = [];
                        let processedResult = executeData.result;

                        // Get User ID for Storage PATH
                        const { data: sessionData } = await adminSupabase
                            .from('sessions')
                            .select('user_id')
                            .eq('id', sessionId)
                            .single();
                        const userId = sessionData?.user_id || 'unknown';

                        // If execution succeeded and we have array of images
                        if (executeData.result && Array.isArray(executeData.result)) {
                            console.log('[Worker] Processing execution results for parallel upload...');

                            // Let the UI know we are in the final save state
                            await adminSupabase
                                .from('sessions')
                                .update({ status_message: 'Finalizing results...' })
                                .eq('id', sessionId);

                            await Promise.all(executeData.result.map(async (item: any, i: number) => {
                                const isDataUri = item.url?.startsWith('data:');
                                const isExternalUrl = item.url?.startsWith('http') &&
                                    !item.url.includes(process.env.NEXT_PUBLIC_SUPABASE_URL || '.supabase.co');

                                if (item?.url && (isDataUri || isExternalUrl)) {
                                    try {
                                        // Fetch the image to buffer natively on server
                                        const response = await fetch(item.url);
                                        const arrayBuffer = await response.arrayBuffer();
                                        const buffer = Buffer.from(arrayBuffer);

                                        const mimeType = response.headers.get('content-type') ||
                                            (isDataUri ? item.url.split(';')[0].split(':')[1] : 'image/jpeg');
                                        const ext = mimeType.split('/')[1] || 'jpg';

                                        // Save to session user's folder
                                        const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;
                                        const storagePath = `${userId}/${sessionId}/${filename}`;

                                        const { data, error } = await adminSupabase.storage
                                            .from('chat-assets')
                                            .upload(storagePath, buffer, {
                                                contentType: mimeType,
                                                upsert: false
                                            });

                                        if (error) {
                                            console.error('[Worker] Failed to upload executed image to storage:', error);
                                        } else {
                                            const { data: urlData } = adminSupabase.storage.from('chat-assets').getPublicUrl(storagePath);
                                            executeData.result[i] = { ...item, url: urlData.publicUrl };
                                            if (data?.path) uploadedPaths.push(data.path);
                                        }
                                    } catch (fetchErr) {
                                        console.error('[Worker] Failed to fetch/upload generated image:', fetchErr);
                                    }
                                } else if (item?.url) {
                                    // Track existing storage paths
                                    try {
                                        const urlObj = new URL(item.url);
                                        const pathParts = urlObj.pathname.split('/storage/v1/object/public/chat-assets/');
                                        if (pathParts.length > 1) {
                                            uploadedPaths.push(pathParts[1]);
                                        }
                                    } catch (e) { }
                                }
                            }));
                            processedResult = executeData.result;
                        }

                        // Attach metadata with results and potential error
                        updatePayload.metadata = {
                            type: 'workflow',
                            execution_result: processedResult,
                            execution_error: executeData.error
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
                            execution_error: execError.message
                        };
                        updatePayload.content = `⚠️ Workflow engine crashed during execution.\n${execError.message}`;
                    }
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
                    status_message: null, // Clear progress indicator
                };
                if (result.type === 'workflow' && result.workflow) {
                    sessionUpdate.canvas_state = result.workflow;
                }
                await adminSupabase
                    .from('sessions')
                    .update(sessionUpdate)
                    .eq('id', sessionId);

                // Generate session title
                try {
                    await generateSessionTitle(adminSupabase, sessionId, prompt, result);
                } catch (titleError) {
                    console.error('[Worker] Title generation failed (non-critical):', titleError);
                }

            } catch (error: any) {
                console.error('==========================================');
                console.error('[Worker] BACKGROUND AI ERROR:', error);
                console.error('Stack:', error.stack);
                console.error('==========================================');

                try {
                    // Bypass RLS and strictly await the failure update
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
        // The frontend will receive Realtime updates when the worker finishes
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

/**
 * Generate a smart session title using Gemini (server-side).
 */
async function generateSessionTitle(
    supabase: any,
    sessionId: string,
    userPrompt: string,
    result: any,
) {
    const { data: session } = await supabase
        .from('sessions')
        .select('title')
        .eq('id', sessionId)
        .single();

    if (!session) return;

    const currentTitle = session.title || '';
    if (currentTitle && currentTitle !== 'New Workflow' && currentTitle !== 'Untitled') return;

    let title = '';

    if (result.type === 'workflow' && result.workflow?.name) {
        const workflowName = result.workflow.name;
        if (workflowName !== 'New Workflow' && workflowName !== 'Workflow' && workflowName.length > 2) {
            title = workflowName.replace(/^Workflow: /, '');
        }
    }

    if (!title) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
        const titlePrompt = `Generate a short title (max 5 words) for this chat. User said: "${userPrompt}". No quotes, focus on intent.`;
        const geminiResult = await model.generateContent(titlePrompt);
        title = geminiResult.response.text().trim();
    }

    title = title.replace(/^["']|["']$/g, '');
    if (title.length > 50) title = title.substring(0, 47) + '...';

    await supabase.from('sessions').update({ title }).eq('id', sessionId);
}

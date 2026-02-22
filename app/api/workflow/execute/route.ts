import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow, validateWorkflow } from '@/lib/workflow-engine';
import { saveExecution } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';
import { generateNodeId } from '@/lib/utils';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 120; // 2 minutes max
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

        // Run execution in the background to prevent client timeouts and stream UI naturally via DB
        const workerPromise = (async () => {
            try {
                const totalNodes = workflow.nodes.length;
                let completedNodes = 0;

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

                const onStatusUpdate = async (nodeId: string, status: string, currentWorkflow?: any) => {
                    if (!sessionId) return; // Only stream live updates if a sessionId is provided

                    if (status === 'running') {
                        const node = workflow.nodes.find((n: any) => n.id === nodeId);
                        const action = node ? (actionDescriptions[node.type] || 'Processing') : 'Processing';
                        const stepMsg = `${action} (${completedNodes + 1}/${totalNodes})`;

                        const payload: Record<string, any> = { status_message: stepMsg };
                        if (currentWorkflow) payload.canvas_state = currentWorkflow;

                        Promise.resolve(adminSupabase.from('sessions').update(payload).eq('id', sessionId))
                            .catch((e) => console.warn('[API/Execute] Status broadcast failed:', e));
                    } else if (status === 'success' || status === 'error') {
                        completedNodes++;
                        if (currentWorkflow) {
                            Promise.resolve(adminSupabase.from('sessions').update({ canvas_state: currentWorkflow }).eq('id', sessionId))
                                .catch((e) => console.warn('[API/Execute] Success/Error broadcast failed:', e));
                        }
                    }
                };

                const result = await executeWorkflow(workflow as Workflow, executionId, onStatusUpdate);

                // Handle image uploads
                if (result.result && Array.isArray(result.result) && sessionId) {
                    const { data: sessionData } = await adminSupabase.from('sessions').select('user_id').eq('id', sessionId).single();
                    const userId = sessionData?.user_id || 'unknown';

                    for (let i = 0; i < result.result.length; i++) {
                        const item = result.result[i];
                        const isDataUri = item.url?.startsWith('data:');
                        const isExternalUrl = item.url?.startsWith('http') && !item.url.includes(process.env.NEXT_PUBLIC_SUPABASE_URL || '.supabase.co');

                        if (item?.url && (isDataUri || isExternalUrl)) {
                            try {
                                const response = await fetch(item.url);
                                const buffer = Buffer.from(await response.arrayBuffer());
                                const mimeType = response.headers.get('content-type') || (isDataUri ? item.url.split(';')[0].split(':')[1] : 'image/jpeg');
                                const ext = mimeType.split('/')[1] || 'jpg';
                                const storagePath = `${userId}/${sessionId}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

                                const { data, error } = await adminSupabase.storage.from('chat-assets').upload(storagePath, buffer, { contentType: mimeType, upsert: false });
                                if (!error && data) item.url = data.path; // Write path back to the output payload
                            } catch (e) { console.error('[API/Execute] Upload error:', e); }
                        }
                    }
                }

                if (workflow.id) {
                    await saveExecution(workflow.id, result.success ? 'completed' : 'failed', result.result, result.error);
                }

                if (sessionId) {
                    await adminSupabase.from('sessions').update({
                        status_message: result.success ? 'Execution complete' : 'Execution failed',
                        canvas_state: workflow
                    }).eq('id', sessionId);
                }

            } catch (err) {
                console.error('[API/Execute] Background execution crashed:', err);
                if (sessionId) await adminSupabase.from('sessions').update({ status_message: 'Execution crashed' }).eq('id', sessionId);
            }
        })();

        // Immediately return 200 Accepted allowing realtime streams to hydrate the UI
        return NextResponse.json({
            success: true,
            executionId,
            message: 'Execution started in background'
        }, { status: 202 });

    } catch (error: any) {
        console.error('Error executing workflow:', error);
        return NextResponse.json({ success: false, error: 'Unknown error' }, { status: 500 });
    }
}

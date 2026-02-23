import { NextResponse, NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { parseRequestToWorkflow } from '@/lib/ai/parse-workflow';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * POST /api/chat/process — Background AI Generation Worker
 * 
 * This endpoint is called internally by /api/chat/send as fire-and-forget.
 * It runs the LLM generation and writes the result directly to the database.
 * The frontend picks it up via Supabase Realtime subscription.
 * 
 * IMPORTANT: This endpoint is NOT meant to be called by the frontend directly.
 * It uses a shared secret to prevent unauthorized access.
 */
export async function POST(request: NextRequest) {
    try {
        // Verify internal secret to prevent unauthorized access
        const authHeader = request.headers.get('x-internal-secret');
        const expectedSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!authHeader || authHeader !== expectedSecret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            assistantMessageId,
            sessionId,
            prompt,
            previousWorkflow,
            attachedImages,
        } = body;

        const supabase = createServiceClient();

        try {
            // 1. Call the LLM (this is the long-running part, 5-15s)
            console.log('[Worker] Starting AI generation for message:', assistantMessageId);
            const result = await parseRequestToWorkflow(
                prompt,
                previousWorkflow || null,
                attachedImages || undefined,
            );

            if (!result.success) {
                throw new Error(result.error || 'Failed to generate workflow');
            }

            // 2. Build the update payload based on response type
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
            }

            // 3. Write the completed response to the database
            const { error: updateError } = await supabase
                .from('messages')
                .update(updatePayload)
                .eq('id', assistantMessageId);

            if (updateError) {
                console.error('[Worker] Failed to update message:', updateError);
                throw updateError;
            }

            console.log('[Worker] AI generation completed:', result.type);

            const sessionUpdate: Record<string, any> = {
                updated_at: new Date().toISOString(),
            };
            if (result.type === 'workflow' && result.workflow) {
                sessionUpdate.canvas_state = result.workflow;

                // Progressive Title Generation: Override with official workflow title
                if (result.workflow.name && result.workflow.name !== 'New Workflow' && result.workflow.name !== 'Workflow') {
                    let officialTitle = result.workflow.name.replace(/^Workflow:\s*/i, '');
                    if (officialTitle.length > 2) sessionUpdate.title = officialTitle;
                }
            }
            await supabase
                .from('sessions')
                .update(sessionUpdate)
                .eq('id', sessionId);

            // 5. Title generation is now handled separately by the frontend asynchronously
            return NextResponse.json({ success: true });

        } catch (error: any) {
            console.error('[Worker] AI generation failed:', error);

            // Write the error to the database so the frontend can display it
            await supabase
                .from('messages')
                .update({
                    status: 'failed',
                    content: `Sorry, I encountered an error: ${error.message || 'Unknown error'}`,
                    metadata: { type: 'error', error: error.message },
                })
                .eq('id', assistantMessageId);

            return NextResponse.json({ error: error.message }, { status: 500 });
        }

    } catch (error: any) {
        console.error('[Worker] Process endpoint error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}


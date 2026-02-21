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

            // 4. Update session: timestamp + canvas_state (for workflow responses)
            const sessionUpdate: Record<string, any> = {
                updated_at: new Date().toISOString(),
            };
            if (result.type === 'workflow' && result.workflow) {
                sessionUpdate.canvas_state = result.workflow;
            }
            await supabase
                .from('sessions')
                .update(sessionUpdate)
                .eq('id', sessionId);

            // 5. Generate session title (server-side, survives navigation)
            try {
                await generateSessionTitle(supabase, sessionId, prompt, result);
            } catch (titleError) {
                console.error('[Worker] Title generation failed (non-critical):', titleError);
            }

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

/**
 * Generate a smart session title using Gemini (server-side).
 * Only generates if the session still has the default title.
 */
async function generateSessionTitle(
    supabase: ReturnType<typeof createServiceClient>,
    sessionId: string,
    userPrompt: string,
    result: any,
) {
    // Check if session still has generic title
    const { data: session } = await supabase
        .from('sessions')
        .select('title')
        .eq('id', sessionId)
        .single();

    if (!session) return;

    // Only generate if still using default title
    const currentTitle = session.title || '';
    if (currentTitle && currentTitle !== 'New Workflow' && currentTitle !== 'Untitled') return;

    let title = '';

    // Use workflow name if available and specific
    if (result.type === 'workflow' && result.workflow?.name) {
        const workflowName = result.workflow.name;
        if (workflowName !== 'New Workflow' && workflowName !== 'Workflow' && workflowName.length > 2) {
            title = workflowName.replace(/^Workflow: /, '');
        }
    }

    // Fall back to Gemini title generation
    if (!title) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

        const titlePrompt = `Generate a short title (max 5 words) for this chat. User said: "${userPrompt}". No quotes, focus on intent.`;
        const geminiResult = await model.generateContent(titlePrompt);
        title = geminiResult.response.text().trim();
    }

    // Clean up
    title = title.replace(/^["']|["']$/g, '');
    if (title.length > 50) title = title.substring(0, 47) + '...';

    await supabase
        .from('sessions')
        .update({ title })
        .eq('id', sessionId);
}

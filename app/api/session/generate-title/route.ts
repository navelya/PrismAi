import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { isDefaultWorkflowTitle } from '@/lib/utils/workflow-title';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const { sessionId, message, chatId, workflowName } = body;

        // Only sessionId is strictly required — message and workflowName are optional inputs
        if (!sessionId) {
            return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
        }

        const supabase = createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // A real, user-set workflow name (not a placeholder) is the mirror title and
        // always wins — the first chat must never auto-title over a manual rename.
        const manualName = isDefaultWorkflowTitle(workflowName) ? null : String(workflowName).trim();

        // Per-chat title: a short summary of the first message. Independent of the
        // session/workflow mirror title.
        let chatTitle: string | null = null;
        if (message) {
            try {
                const model = genAI.getGenerativeModel({
                    model: 'gemini-2.5-flash-lite',
                    generationConfig: { maxOutputTokens: 15 }
                });
                const prompt = `Summarize this user request into a objective 2-4 word UI title. Focus strictly on the core action or subject. Do not use conversational filler, dramatic words, quotes, or punctuation. User prompt: "${message}"`;
                const result = await model.generateContent(prompt);
                chatTitle = result.response.text().trim();
            } catch (geminiError: any) {
                console.error('[TitleGen] Gemini failed:', geminiError);
                // Non-fatal: a manual name can still seed the mirror title below.
                if (!manualName) {
                    return NextResponse.json({
                        success: false,
                        error: geminiError.message || 'Failed to generate title',
                        title: 'New Session'
                    });
                }
            }
        }

        // Cleanup the generated chat title.
        if (chatTitle) {
            chatTitle = chatTitle.replace(/^["']|["']$/g, '');
            if (chatTitle.length > 50) chatTitle = chatTitle.substring(0, 47) + '...';
        }

        // The session/workflow mirror title: a manual name wins; otherwise the
        // generated summary seeds it.
        const mirrorTitle = manualName ?? chatTitle;

        // Title the ACTIVE chat (each chat gets its own title from its first
        // message) and set the SESSION title (the mirror of the workflow name).
        // Safe — never crashes if rows don't exist yet.
        try {
            const { data: session } = await supabase
                .from('sessions')
                .select('title, active_chat_id')
                .eq('id', sessionId)
                .eq('user_id', user.id)
                .single();

            // Prefer the explicit chatId captured at send time — the active chat
            // may have moved on (user started another chat) by the time Gemini
            // returned, so reading active_chat_id here could title the wrong chat.
            const targetChatId = chatId || session?.active_chat_id;
            if (targetChatId && chatTitle) {
                await supabase.from('chats').update({ title: chatTitle }).eq('id', targetChatId);
            }

            // Session title (mirror): a manual name always wins; a generated
            // summary only seeds it when the session title is still unset, so
            // later chats never rename the workflow.
            const sessionTitleUnset = isDefaultWorkflowTitle(session?.title);
            const titleChanged = (session?.title || '').trim() !== mirrorTitle;
            if (mirrorTitle && titleChanged && (manualName || !session || sessionTitleUnset)) {
                await supabase
                    .from('sessions')
                    .update({ title: mirrorTitle })
                    .eq('id', sessionId)
                    .eq('user_id', user.id);
            }
        } catch (dbError) {
            console.error('[TitleGen] DB update failed:', dbError);
        }

        return NextResponse.json({ success: true, title: mirrorTitle ?? 'New Session' });

    } catch (error) {
        console.error('[TitleGen] Critical error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

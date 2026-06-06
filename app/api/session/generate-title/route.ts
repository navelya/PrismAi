import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const { sessionId, message, chatId } = body;

        // Only sessionId is strictly required — message and workflowName are optional inputs
        if (!sessionId) {
            return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
        }

        const supabase = createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let title = 'New Session';

        if (message) {
            try {
                const model = genAI.getGenerativeModel({
                    model: 'gemini-2.5-flash-lite',
                    generationConfig: { maxOutputTokens: 15 }
                });
                const prompt = `Summarize this user request into a objective 2-4 word UI title. Focus strictly on the core action or subject. Do not use conversational filler, dramatic words, quotes, or punctuation. User prompt: "${message}"`;
                const result = await model.generateContent(prompt);
                title = result.response.text().trim();
            } catch (geminiError: any) {
                console.error('[TitleGen] Gemini failed:', geminiError);
                return NextResponse.json({
                    success: false,
                    error: geminiError.message || 'Failed to generate title',
                    title: 'New Session'
                });
            }
        } else {
            // No useful text provided — skip title generation
            return NextResponse.json({ success: true, title: 'New Session' });
        }

        // Cleanup
        title = title.replace(/^["']|["']$/g, '');
        if (title.length > 50) title = title.substring(0, 47) + '...';

        // Title the ACTIVE chat (each chat gets its own title from its first
        // message). Also seed the SESSION title once — it names the workflow in
        // the sidebar, so only the first chat should set it; later chats must
        // not rename the workflow. Safe — never crashes if rows don't exist yet.
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
            if (targetChatId) {
                await supabase.from('chats').update({ title }).eq('id', targetChatId);
            }

            const sessionTitle = (session?.title || '').trim();
            const sessionTitleUnset = !sessionTitle || sessionTitle === 'New Workflow' || sessionTitle === 'New Session';
            if (!session || sessionTitleUnset) {
                await supabase
                    .from('sessions')
                    .update({ title })
                    .eq('id', sessionId)
                    .eq('user_id', user.id);
            }
        } catch (dbError) {
            console.error('[TitleGen] DB update failed:', dbError);
        }

        return NextResponse.json({ success: true, title });

    } catch (error) {
        console.error('[TitleGen] Critical error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

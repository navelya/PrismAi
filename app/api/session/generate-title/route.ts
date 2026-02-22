import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sessionId, message, assistantResponse, workflowName } = body;

        // Only sessionId is strictly required — message and workflowName are optional inputs
        if (!sessionId) {
            return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
        }

        const supabase = createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let title = '';

        // PRIORITIZE provided workflow name if it's specific
        if (workflowName &&
            workflowName !== 'New Workflow' &&
            workflowName !== 'Workflow' &&
            workflowName.length > 2 &&
            !workflowName.startsWith('Workflow: ')) {
            title = workflowName;
        } else if (workflowName && workflowName.startsWith('Workflow: ')) {
            title = workflowName.replace('Workflow: ', '');
        } else if (message || assistantResponse) {
            // Generate title using Gemini only if we have some text to work with
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
                const prompt = `Generate a short title (max 5 words) for a workflow chat session. User said: "${message || ''}". Assistant said: "${assistantResponse || ''}". No quotes, focus on intent. If gibberish, say "New Session".`;
                const result = await model.generateContent(prompt);
                title = result.response.text().trim();
            } catch (geminiError) {
                console.error('[TitleGen] Gemini failed:', geminiError);
                title = 'New Session';
            }
        } else {
            // No useful text provided — skip title generation
            return NextResponse.json({ success: true, title: 'New Workflow' });
        }

        // Cleanup
        title = title.replace(/^["']|["']$/g, '');
        if (title.length > 50) title = title.substring(0, 47) + '...';

        // Update session in DB (safe — won't crash even if session doesn't exist yet)
        try {
            await supabase
                .from('sessions')
                .update({ title })
                .eq('id', sessionId)
                .eq('user_id', user.id);
        } catch (dbError) {
            console.error('[TitleGen] DB update failed:', dbError);
        }

        return NextResponse.json({ success: true, title });

    } catch (error) {
        console.error('[TitleGen] Critical error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

import { createClient } from '@/lib/supabase/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

export async function POST(req: NextRequest) {
    try {
        const { sessionId, message, workflowName, assistantResponse } = await req.json();

        if (!sessionId || !message) {
            return NextResponse.json({ error: 'Missing defined parameters' }, { status: 400 });
        }

        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify session ownership
        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', user.id)
            .single();

        if (sessionError || !session) {
            return NextResponse.json({ error: 'Session not found or unauthorized' }, { status: 404 });
        }

        let title = '';

        // Priority 1: Use Workflow Name if available
        if (workflowName) {
            title = workflowName;
        } else {
            // Priority 2: Generate from conversation context
            const prompt = assistantResponse
                ? `Generate a 3-5 word title for this chat.\nUser: "${message}"\nAssistant: "${assistantResponse}"\nTitle (NO quotes):`
                : `Generate a 3-5 word title for a chat starting with: "${message}". Title (NO quotes):`;

            // Fallback
            title = message.slice(0, 30) + (message.length > 30 ? '...' : '');

            try {
                // Try Flash first
                const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                const generatedTitle = response.text().trim().replace(/^["']|["']$/g, '');
                if (generatedTitle) title = generatedTitle;
            } catch (geminiError) {
                console.warn('Gemini Flash failed, trying Pro:', geminiError);
                try {
                    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const generatedTitle = response.text().trim().replace(/^["']|["']$/g, '');
                    if (generatedTitle) title = generatedTitle;
                } catch (fallbackError) {
                    console.warn('Gemini Pro also failed, using fallback title');
                }
            }
        }

        // Update Session
        const { error: updateError } = await supabase
            .from('sessions')
            .update({ title })
            .eq('id', sessionId);

        if (updateError) {
            throw updateError;
        }

        return NextResponse.json({ success: true, title });

    } catch (error: any) {
        console.error('Title generation error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

const logFile = path.join(process.cwd(), 'debug_routes.txt');

function log(message: string) {
    const timestamp = new Date().toISOString();
    try {
        fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch (e) {
        // Fallback to console if file write fails (e.g. permissions)
        console.log(`[DEBUG_ROUTE] ${message}`);
    }
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        log(`Title Generation Request: ${JSON.stringify(body)}`);
        const { sessionId, message, assistantResponse, workflowName } = body;

        if (!sessionId || !message) {
            log('Title Generation Missing Params');
            return NextResponse.json({ error: 'Session ID and message required' }, { status: 400 });
        }

        const supabase = createClient();

        // Check if session exists and is owned by user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            log(`Title Generation Unauthorized: ${authError?.message}`);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        log(`Generating title for session ${sessionId}...`);
        let title = '';

        // PRIORITIZE provided workflow name if it's specific
        // We check for "New Workflow" and "Workflow" to avoid generic names
        // We also check for "Workflow: " prefix which might come from the parser
        if (workflowName &&
            workflowName !== 'New Workflow' &&
            workflowName !== 'Workflow' &&
            workflowName.length > 2 &&
            !workflowName.startsWith('Workflow: ')) {

            title = workflowName;
            log(`Using provided workflow name directly: ${title}`);
        } else if (workflowName && workflowName.startsWith('Workflow: ')) {
            // Cleanup "Workflow: " prefix if present from generic parser
            title = workflowName.replace('Workflow: ', '');
            log(`Using cleaned workflow name: ${title}`);
        } else {
            // Generate title using Gemini
            log('Using Gemini to generate title...');
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

            const prompt = `
                Task: Generate a short, concise title (max 5 words) for a workflow automation chat session.
                
                Context:
                User Request: "${message}"
                Assistant Response: "${assistantResponse || ''}"
                
                Rules:
                - Do not use quotes.
                - Do not include "Workflow" or "Chat" unless necessary.
                - Focus on the *intent* (e.g., "Cat Image Generator", "Background Remover", "Upscale Photos").
                - If the user request is gibberish, use "New Session".
            `;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            title = response.text().trim();
            log(`Generated Title: ${title}`);
        }

        // Cleanup title final pass
        title = title.replace(/^["']|["']$/g, '');
        if (title.length > 50) title = title.substring(0, 47) + '...';

        log(`Final Title to Save: ${title}`);

        // Update session in DB
        const { error } = await supabase
            .from('sessions')
            .update({ title })
            .eq('id', sessionId)
            .eq('user_id', user.id);

        if (error) {
            log(`Failed to update session title in DB: ${error.message}`);
            return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
        }

        log(`Successfully updated session ${sessionId} with title: ${title}`);
        return NextResponse.json({ success: true, title });

    } catch (error) {
        log(`Title generation CRITICAL error: ${error}`);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

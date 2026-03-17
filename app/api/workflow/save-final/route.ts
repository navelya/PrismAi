import { NextResponse } from 'next/server';
import { saveWorkflow } from '@/lib/db/workflows';

export async function POST(req: Request) {
    try {
        const { workflow, sessionId } = await req.json();

        if (!workflow || !sessionId) {
            return NextResponse.json({ error: 'Missing workflow or sessionId' }, { status: 400 });
        }

        // We use the existing saveWorkflow utility which now handles session-based logic
        const result = await saveWorkflow(workflow, sessionId);

        if (!result.success) {
            console.error('[SaveFinal] DB Error:', result.error);
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json({ success: true, sessionId: result.sessionId });
    } catch (error) {
        console.error('[SaveFinal] Server Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { saveWorkflow } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';
import { getAuthenticatedUser } from '@/lib/api/auth';

export async function POST(request: NextRequest) {
    try {
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;

        const body = await request.json();
        const { workflow, sessionId } = body;

        if (!workflow || !sessionId) {
            return NextResponse.json(
                { error: 'Invalid payload: missing workflow or sessionId' },
                { status: 400 }
            );
        }

        // Save directly to the session's canvas_state
        const result = await saveWorkflow(workflow as Workflow, sessionId);

        if (result.success) {
            return NextResponse.json({
                success: true,
                sessionId: result.sessionId,
            });
        } else {
            return NextResponse.json(
                {
                    success: false,
                    error: result.error,
                },
                { status: 500 }
            );
        }
    } catch (error) {
        console.error('Error in /api/workflow/save:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { saveWorkflow } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';
import { getAuthenticatedUser } from '@/lib/api/auth';

export async function POST(request: NextRequest) {
    try {
        // Authenticate the request
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;
        const { user } = auth;

        const body = await request.json();
        const { workflow } = body;

        if (!workflow || !workflow.nodes) {
            return NextResponse.json(
                { error: 'Invalid workflow' },
                { status: 400 }
            );
        }

        // Use authenticated user ID — never trust client-supplied userId
        const result = await saveWorkflow(workflow as Workflow, user.id);

        if (result.success) {
            return NextResponse.json({
                success: true,
                workflowId: result.workflowId,
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
        console.error('Error saving workflow:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}

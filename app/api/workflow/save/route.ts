import { NextRequest, NextResponse } from 'next/server';
import { saveWorkflow } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { workflow, userId = 'anonymous' } = body;

        if (!workflow || !workflow.nodes) {
            return NextResponse.json(
                { error: 'Invalid workflow' },
                { status: 400 }
            );
        }

        // Save workflow to database
        const result = await saveWorkflow(workflow as Workflow, userId);

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

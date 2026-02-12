import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow, validateWorkflow } from '@/lib/workflow-engine';
import { saveExecution } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';
import { generateNodeId } from '@/lib/utils';
import { getAuthenticatedUser } from '@/lib/api/auth';

export async function POST(request: NextRequest) {
    try {
        // Authenticate the request
        const auth = await getAuthenticatedUser();
        if (auth.error) return auth.error;

        const body = await request.json();
        const { workflow } = body;

        if (!workflow || !workflow.nodes) {
            return NextResponse.json(
                { error: 'Invalid workflow' },
                { status: 400 }
            );
        }

        // Validate workflow
        const validation = validateWorkflow(workflow as Workflow);
        if (!validation.valid) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Workflow validation failed',
                    errors: validation.errors,
                },
                { status: 400 }
            );
        }

        // Generate execution ID
        const executionId = generateNodeId();

        // Execute workflow
        const result = await executeWorkflow(workflow as Workflow, executionId);

        // Save execution to database (if workflow has an ID)
        if (workflow.id) {
            await saveExecution(
                workflow.id,
                result.success ? 'completed' : 'failed',
                result.result,
                result.error
            );
        }

        if (result.success) {
            return NextResponse.json({
                success: true,
                result: result.result,
                executionId,
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
        console.error('Error executing workflow:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}

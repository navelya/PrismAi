import { NextResponse } from 'next/server';
import { parseRequestToWorkflow } from '@/lib/ai/parse-workflow';

export async function POST(request: Request) {
    try {
        const { prompt, previousWorkflow, attachedImages } = await request.json();

        if (!prompt || typeof prompt !== 'string') {
            return NextResponse.json(
                { success: false, error: 'Prompt is required' },
                { status: 400 }
            );
        }



        // Use the original parseRequestToWorkflow function with context
        const result = await parseRequestToWorkflow(prompt, previousWorkflow, attachedImages);

        if (!result.success) {
            throw new Error(result.error || 'Failed to generate workflow');
        }



        return NextResponse.json({
            success: true,
            type: result.type,
            message: result.message,
            workflow: result.workflow,
        });

    } catch (error) {
        console.error('❌ API Error:', error);

        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to generate workflow',
            },
            { status: 500 }
        );
    }
}

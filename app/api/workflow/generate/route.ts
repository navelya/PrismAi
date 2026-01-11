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

        console.log('📥 API Request:', prompt);
        console.log('🔄 Has previous workflow:', !!previousWorkflow);
        console.log('📷 Attached images:', attachedImages?.length || 0);

        // Use the original parseRequestToWorkflow function with context
        const result = await parseRequestToWorkflow(prompt, previousWorkflow, attachedImages);

        if (!result.success) {
            throw new Error(result.error || 'Failed to generate workflow');
        }

        console.log('✅ Workflow generated successfully');

        return NextResponse.json({
            success: true,
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

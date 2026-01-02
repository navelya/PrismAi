import { NextResponse } from 'next/server';
import { ModelManager } from '@/lib/ai/model-manager';

/**
 * Get current model status and rate limit info
 * GET /api/models/status
 */
export async function GET() {
    try {
        const modelManager = ModelManager.getInstance();
        const status = modelManager.getStatus();
        const nextModel = modelManager.getNextAvailableModel();

        return NextResponse.json({
            success: true,
            currentModel: nextModel,
            modelStatus: status,
            availableModels: status.filter(s => !s.isBlocked).length,
            blockedModels: status.filter(s => s.isBlocked).length,
        });
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get model status',
            },
            { status: 500 }
        );
    }
}

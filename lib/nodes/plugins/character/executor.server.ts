import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { CharacterConfig } from './definition';

export const characterExecutor = async (
    config: CharacterConfig,
    _input: any,
    _context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const urls = Array.isArray(config?.referenceImages) ? config.referenceImages : [];
        if (urls.length === 0) {
            return {
                success: false,
                data: null,
                error: `Character "${config?.name || 'unknown'}" has no reference images.`,
            };
        }

        const imageObjects: ImageObject[] = urls.map((url, index) => ({
            url,
            resolution: { width: 800, height: 600 },
            metadata: {
                title: `${config.name || 'Character'} reference ${index + 1}`,
                source: 'Character',
                format: typeof url === 'string' && url.includes('image/png') ? 'png' : 'jpg',
            },
        }));

        return { success: true, data: imageObjects };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to resolve character reference images',
        };
    }
};

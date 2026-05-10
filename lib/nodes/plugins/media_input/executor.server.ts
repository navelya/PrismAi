import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { MediaInputConfig } from './definition';

export const mediaInputExecutor = async (
    config: MediaInputConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { images } = config;

        if (!images || images.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No images uploaded. Please add images to the Media Input node.',
            };
        }

        // Convert base64 data URLs or storage objects to ImageObject format
        const imageObjects: ImageObject[] = images.map((img: any, index: number) => {
            const url = typeof img === 'string' ? img : img?.url;
            const isPng = typeof url === 'string' && url.includes('image/png');

            return {
                url,
                resolution: {
                    width: 800, // Placeholder - actual dimensions determined at runtime
                    height: 600,
                },
                metadata: {
                    title: `Uploaded Image ${index + 1}`,
                    source: 'User Upload',
                    format: isPng ? 'png' : 'jpg',
                },
            };
        });

        return {
            success: true,
            data: imageObjects,
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to process uploaded images',
        };
    }
};

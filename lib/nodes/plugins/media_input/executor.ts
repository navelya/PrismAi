import { ExecutionContext, NodeExecutionResult, MediaInputConfig, ImageObject } from '../../types';

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

        // Convert base64 data URLs to ImageObject format
        const imageObjects: ImageObject[] = images.map((dataUrl: string, index: number) => ({
            url: dataUrl,
            resolution: {
                width: 800,  // Placeholder - actual dimensions determined at runtime
                height: 600,
            },
            metadata: {
                title: `Uploaded Image ${index + 1}`,
                source: 'User Upload',
                format: dataUrl.includes('image/png') ? 'png' : 'jpg',
            },
        }));

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

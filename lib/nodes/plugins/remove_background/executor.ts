import { ExecutionContext, NodeExecutionResult, RemoveBackgroundConfig, ImageObject } from '../../types';

// Backend URL - uses environment variable in production, localhost in development
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
// Internal API key for authenticating with the Python backend (server-side only)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export const removeBackgroundExecutor = async (
    config: RemoveBackgroundConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        // Normalize input to always be an array of images (handling generic handle maps or legacy structures)
        let images: ImageObject[] = [];
        const sourceData = input?.images_in || input?.images || input;

        if (Array.isArray(sourceData)) {
            images = sourceData;
        } else if (sourceData?.images && Array.isArray(sourceData.images)) {
            images = sourceData.images;
        } else if (sourceData?.url) {
            // Single image object
            images = [sourceData];
        } else {
            throw new Error('Invalid input: expected images array or single image');
        }

        if (images.length === 0) {
            return {
                success: true,
                data: [],
            };
        }

        // Process images in parallel
        const processedImages = await Promise.all(
            images.map(async (img, index) => {
                try {
                    // Fetch the original image
                    const response = await fetch(img.url);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch image: ${response.statusText}`);
                    }
                    const blob = await response.blob();

                    // Send to Python backend for background removal
                    const formData = new FormData();
                    formData.append('file', blob, `image-${index}.jpg`);

                    const bgRemovalResponse = await fetch(`${BACKEND_URL}/remove-background`, {
                        method: 'POST',
                        body: formData,
                        headers: INTERNAL_API_KEY ? { 'Authorization': `Bearer ${INTERNAL_API_KEY}` } : {},
                    });

                    if (!bgRemovalResponse.ok) {
                        throw new Error(`Background removal failed: ${bgRemovalResponse.statusText}`);
                    }

                    // Get processed image
                    const processedBlob = await bgRemovalResponse.blob();

                    // Convert to base64 for display (server-side)
                    const arrayBuffer = await processedBlob.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

                    return {
                        ...img,
                        url: base64, // Base64 data URL for display
                        metadata: {
                            ...img.metadata,
                            format: config.format || 'png',
                            hasTransparency: true,
                            processedBy: 'rembg',
                        },
                    };
                } catch (error) {
                    // Return original image if processing fails (don't break the whole workflow)
                    return img;
                }
            })
        );

        return {
            success: true,
            data: processedImages,
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to remove backgrounds',
        };
    }
};

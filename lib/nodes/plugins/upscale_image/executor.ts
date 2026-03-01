import { ExecutionContext, NodeExecutionResult, UpscaleImageConfig, ImageObject } from '../../types';

// Backend URL - uses environment variable in production, localhost in development
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
// Internal API key for authenticating with the Python backend (server-side only)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export const upscaleImageExecutor = async (
    config: UpscaleImageConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { scale = 4 } = config;

        // Normalize input to always be an array of images
        let images: ImageObject[] = [];
        const sourceData = input?.images_in || input?.images || input;

        if (Array.isArray(sourceData)) {
            images = sourceData;
        } else if (sourceData?.images && Array.isArray(sourceData.images)) {
            // Handle { images: [...] } format from merge node
            images = sourceData.images;
        } else if (sourceData?.url) {
            // Single image object
            images = [sourceData];
        } else {
            const errorMsg = 'Invalid input: expected images array or single image';
            console.error('❌', errorMsg, 'Received:', typeof input, input);
            throw new Error(errorMsg);
        }

        if (images.length === 0) {
            console.warn('⚠️ No images to upscale');
            return {
                success: true,
                data: [],
            };
        }

        // Process images in parallel
        const upscaledImages = await Promise.all(
            images.map(async (img, index) => {
                try {
                    // Fetch the original image
                    const response = await fetch(img.url);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch image: ${response.statusText}`);
                    }
                    const blob = await response.blob();

                    // Send to Python backend for upscaling
                    const formData = new FormData();
                    formData.append('file', blob, `image-${index}.jpg`);
                    formData.append('scale', scale.toString());

                    const upscaleResponse = await fetch(`${BACKEND_URL}/upscale`, {
                        method: 'POST',
                        body: formData,
                        headers: INTERNAL_API_KEY ? { 'Authorization': `Bearer ${INTERNAL_API_KEY}` } : {},
                    });

                    if (!upscaleResponse.ok) {
                        throw new Error(`Upscaling failed: ${upscaleResponse.statusText}`);
                    }

                    // Get upscaled image
                    const processedBlob = await upscaleResponse.blob();

                    // Convert to base64 for display (server-side)
                    const arrayBuffer = await processedBlob.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

                    return {
                        ...img,
                        url: base64, // Base64 data URL for display
                        resolution: {
                            width: img.resolution.width * scale,
                            height: img.resolution.height * scale,
                        },
                        metadata: {
                            ...img.metadata,
                            processedBy: `Real-ESRGAN (${scale}x upscale)`,
                        },
                    };
                } catch (error) {
                    // Log detailed error
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error(`❌ Failed to upscale image ${index}:`, errorMessage);
                    console.error('Full error:', error);

                    // Throw error to fail the node properly
                    throw new Error(`Image ${index} upscaling failed: ${errorMessage}`);
                }
            })
        );

        return {
            success: true,
            data: upscaledImages,
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to upscale images',
        };
    }
};

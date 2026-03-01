import { ExecutionContext, NodeExecutionResult, MergeImageConfig, ImageObject } from '../../types';

// Backend URL - uses environment variable in production, localhost in development
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
// Internal API key for authenticating with the Python backend (server-side only)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export const mergeImageExecutor = async (
    config: MergeImageConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const mergeConfig = config;

        let baseImages: ImageObject[] = [];
        let overlayImages: ImageObject[] = [];

        // Helper to extract images from various input formats
        const extractImages = (source: any): ImageObject[] => {
            if (!source) return [];
            if (Array.isArray(source)) return source;
            if (source.images && Array.isArray(source.images)) return source.images;
            if (source.url) return [source]; // Single image object
            return [];
        };

        if (input && typeof input === 'object') {
            if (input.base !== undefined || input.overlay !== undefined) {
                // Structured input from workflow engine
                baseImages = extractImages(input.base);
                overlayImages = extractImages(input.overlay);
            } else if (Array.isArray(input)) {
                // Single array input - use as base, no overlay
                baseImages = input;
            } else if (input.images) {
                baseImages = Array.isArray(input.images) ? input.images : [input.images];
            }
        }

        if (baseImages.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No base images provided. Connect image source to Input A (Base).',
            };
        }

        if (overlayImages.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No overlay images provided. Connect image source to Input B (Overlay).',
            };
        }

        // Determine iteration mode
        const isBroadcastOverlay = overlayImages.length === 1 && baseImages.length > 1;
        const isBroadcastBase = baseImages.length === 1 && overlayImages.length > 1;
        const iterationCount = isBroadcastOverlay
            ? baseImages.length
            : isBroadcastBase
                ? overlayImages.length
                : Math.min(baseImages.length, overlayImages.length);

        const mergedImages: ImageObject[] = [];

        for (let i = 0; i < iterationCount; i++) {
            const baseImg = isBroadcastBase ? baseImages[0] : baseImages[i];
            const overlayImg = isBroadcastOverlay ? overlayImages[0] : overlayImages[i];

            try {
                // Fetch both images as blobs
                const [baseResponse, overlayResponse] = await Promise.all([
                    fetch(baseImg.url),
                    fetch(overlayImg.url),
                ]);

                const baseBlob = await baseResponse.blob();
                const overlayBlob = await overlayResponse.blob();

                // Create form data for backend
                const formData = new FormData();
                formData.append('base_file', baseBlob, 'base.png');
                formData.append('overlay_file', overlayBlob, 'overlay.png');
                formData.append('position', mergeConfig.position || 'bottom-right');
                formData.append('overlay_scale', String(mergeConfig.overlayScale || 0.2));
                formData.append('opacity', String(mergeConfig.opacity || 1.0));
                formData.append('padding', String(mergeConfig.padding || 10));

                // Call backend merge endpoint
                const mergeResponse = await fetch(`${BACKEND_URL}/merge-images`, {
                    method: 'POST',
                    body: formData,
                    headers: INTERNAL_API_KEY ? { 'Authorization': `Bearer ${INTERNAL_API_KEY}` } : {},
                });

                if (!mergeResponse.ok) {
                    const errorText = await mergeResponse.text();
                    throw new Error(`Backend error: ${errorText}`);
                }

                // Get merged image as blob
                const mergedBlob = await mergeResponse.blob();

                // Server-side fallback for canvas operations? Since this runs on the server Node.js we can't use window.Image
                // Actually, earlier code in mergeImageExecutor attempted to use document.createElement('canvas'). This is a bug if it ran on server!
                // So I will convert blob directly to base64. 
                const arrayBuffer = await mergedBlob.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const mergedUrl = `data:image/png;base64,${buffer.toString('base64')}`;

                mergedImages.push({
                    url: mergedUrl,
                    resolution: {
                        width: baseImg.resolution.width,
                        height: baseImg.resolution.height,
                    },
                    metadata: {
                        processedBy: 'merge_image',
                        source: `Merged: ${baseImg.metadata?.source || 'base'} + ${overlayImg.metadata?.source || 'overlay'}`,
                    },
                });

            } catch (imgError) {
                console.error(`❌ Failed to merge image ${i + 1}:`, imgError);
            }
        }

        if (mergedImages.length === 0) {
            return {
                success: false,
                data: null,
                error: 'Failed to merge any images',
            };
        }

        return {
            success: true,
            data: mergedImages,
        };

    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to merge images',
        };
    }
};

import { ExecutionContext, NodeExecutionResult, CompositorConfig, ImageObject } from '../../types';

// Browser specific canvas rendering for Compositor
export const compositorExecutor = async (
    config: CompositorConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const compositorConfig = config;
        const {
            canvasWidth = 1920,
            canvasHeight = 1080,
            backgroundColor = '#00000000',
            layers = [],
            outputFormat = 'png',
            outputQuality = 1.0,
        } = compositorConfig;

        if (layers.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No layers configured. Add at least one layer to the Compositor.',
            };
        }

        const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

        if (isBrowser) {
            const canvas = document.createElement('canvas');
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                return { success: false, data: null, error: 'Failed to create canvas context.' };
            }

            ctx.clearRect(0, 0, canvasWidth, canvasHeight);

            // Need to write our own loadImage internally
            const loadImage = (src: string): Promise<HTMLImageElement> => {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous'; // Important for external URLs
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = src;
                });
            };

            for (const layer of layers) {
                if (!layer.visible) continue;

                const handleInputs = input as Record<string, ImageObject[] | ImageObject>;
                const sourceData = handleInputs[layer.sourceHandleId];
                if (!sourceData) continue;

                const sourceArray = Array.isArray(sourceData) ? sourceData : [sourceData];
                const imageData = sourceArray[layer.selectedIndex] || sourceArray[0];
                if (!imageData?.url) continue;

                try {
                    const img = await loadImage(imageData.url);

                    ctx.save();
                    const { x, y, width, height, rotation, opacity, flipX, flipY } = layer.transform;

                    ctx.globalAlpha = opacity;
                    ctx.translate(x + width / 2, y + height / 2);
                    ctx.rotate((rotation * Math.PI) / 180);

                    // Apply flips by scaling negatively
                    if (flipX || flipY) {
                        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
                    }

                    // For flip correctness, draw relative to the flipped coordinate space
                    ctx.drawImage(
                        img,
                        layer.transform.crop?.x || 0,
                        layer.transform.crop?.y || 0,
                        layer.transform.crop?.width || img.width,
                        layer.transform.crop?.height || img.height,
                        -width / 2,
                        -height / 2,
                        width,
                        height
                    );

                    ctx.restore();
                } catch (imgError) {
                    console.error(`❌ Failed to load image for layer ${layer.name}:`, imgError);
                }
            }

            // Output the final canvas
            const mimeType = `image/${outputFormat}` as any;
            const dataUrl = canvas.toDataURL(mimeType, outputQuality);

            return {
                success: true,
                data: [{
                    url: dataUrl,
                    resolution: { width: canvasWidth, height: canvasHeight },
                    metadata: {
                        format: outputFormat,
                        source: 'Compositor',
                        processedBy: 'CompositorNode',
                    },
                }],
            };
        } else {
            // Server-side compositor not supported yet. Need a Python service or node-canvas.
            return {
                success: false,
                data: null,
                error: 'Compositor rendering is only supported in the browser.',
            };
        }
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to composite images',
        };
    }
};

import { ExecutionContext, NodeExecutionResult, CompositorConfig, ImageObject } from '../../types';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Compositor Executor
 * Handles image composition both in-browser (Canvas API) and on-server (Sharp library).
 * This ensures the workflow is background-robust.
 */
export const compositorExecutor = async (
    config: CompositorConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const {
            canvasWidth = 1080,
            canvasHeight = 1080,
            backgroundColor = '#00000000',
            layers = [],
            outputFormat = 'png',
            outputQuality = 1.0,
        } = config;

        if (layers.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No layers configured. Add at least one layer to the Compositor.',
            };
        }

        const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

        if (isBrowser) {
            // --- BROWSER EXECUTION (Live Preview / Fast Local Run) ---
            const canvas = document.createElement('canvas');
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                return { success: false, data: null, error: 'Failed to create canvas context.' };
            }

            ctx.clearRect(0, 0, canvasWidth, canvasHeight);

            const loadImage = (src: string): Promise<HTMLImageElement> => {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
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

                    if (flipX || flipY) {
                        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
                    }

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
                        processedBy: 'BrowserCanvas',
                    },
                }],
            };
        } else {
            // --- SERVER EXECUTION (Background Run via Sharp) ---
            const sharp = (await import('sharp')).default;
            
            // Create base transparent canvas
            let canvas = sharp({
                create: {
                    width: canvasWidth,
                    height: canvasHeight,
                    channels: 4,
                    background: backgroundColor || { r: 0, g: 0, b: 0, alpha: 0 }
                }
            });

            const compositeLayers: any[] = [];

            for (const layer of layers) {
                if (!layer.visible) continue;

                const handleInputs = input as Record<string, ImageObject[] | ImageObject>;
                const sourceData = handleInputs[layer.sourceHandleId];
                if (!sourceData) continue;

                const sourceArray = Array.isArray(sourceData) ? sourceData : [sourceData];
                const imageData = sourceArray[layer.selectedIndex] || sourceArray[0];
                if (!imageData?.url) continue;

                try {
                    // Fetch image from S3/External
                    const response = await fetch(imageData.url);
                    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
                    const buffer = Buffer.from(await response.arrayBuffer());

                    let layerSharp = sharp(buffer);

                    // Apply Transforms
                    const { width, height, rotation, flipX, flipY } = layer.transform;

                    // 1. Resize
                    layerSharp = layerSharp.resize(Math.round(width), Math.round(height), { fit: 'fill' });

                    // 2. Rotate
                    if (rotation !== 0) {
                        layerSharp = layerSharp.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
                    }

                    // 3. Flip
                    if (flipX) layerSharp = layerSharp.flop();
                    if (flipY) layerSharp = layerSharp.flip();

                    // Prepare for composite
                    const layerBuffer = await layerSharp.toBuffer();
                    
                    compositeLayers.push({
                        input: layerBuffer,
                        left: Math.round(layer.transform.x),
                        top: Math.round(layer.transform.y),
                        blend: 'over'
                    });

                } catch (err) {
                    console.error(`[Compositor:Server] Layer ${layer.name} failed:`, err);
                }
            }

            const finalBuffer = await canvas.composite(compositeLayers).toFormat(outputFormat as any).toBuffer();

            // Persist to S3 (Since we are on the server, we MUST provide a URL)
            const supabase = createServiceClient();
            const fileName = `${context.userId}/${context.sessionId}/compositor_${context.nodeId}_${Date.now()}.${outputFormat}`;
            
            const { error: uploadError } = await supabase.storage
                .from('chat-assets')
                .upload(fileName, finalBuffer, {
                    contentType: `image/${outputFormat}`,
                    upsert: true
                });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('chat-assets')
                .getPublicUrl(fileName);

            return {
                success: true,
                data: [{
                    url: publicUrl,
                    resolution: { width: canvasWidth, height: canvasHeight },
                    metadata: {
                        format: outputFormat,
                        source: 'Compositor',
                        processedBy: 'ServerSharp',
                    },
                }],
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

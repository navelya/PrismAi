import sharp from 'sharp';
import { ExecutionContext, NodeExecutionResult, CompositorConfig, ImageObject } from '../../types';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Compositor server executor.
 *
 * Behavior preserved from the previous lib/workflow/handlers.ts handleCompositor:
 *   - Reads each layer's source URL from inputs[layer.sourceHandleId] (NOT an array index)
 *   - Layers processed in parallel via Promise.all
 *   - Skips invisible layers and layers with no input mapped
 *   - Per-layer fetch + resize/rotate/flip pipeline
 *   - Output format from config.outputFormat (png/jpg/jpeg/webp), default png
 *   - Uploads result to workflow-ephemeral-tmp (NOT chat-assets — that was the dead plugin executor path)
 */
export const compositorExecutor = async (
    config: CompositorConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const width = Math.round(config?.canvasWidth || 1080);
        const height = Math.round(config?.canvasHeight || 1080);
        const layers = (config?.layers || []) as any[];
        const outputFormat = (config?.outputFormat || 'png') as string;
        const outputQuality = config?.outputQuality ?? 1.0;

        console.log(`[CompositorExecutor] Canvas ${width}x${height}, ${layers.length} layers`);

        let baseCanvas = sharp({
            create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        });

        const layerResults = await Promise.all(
            layers.map(async (layer: any) => {
                if (!layer.visible) return null;
                const imageUrl = inputs[layer.sourceHandleId];
                if (!imageUrl || typeof imageUrl !== 'string') return null;
                try {
                    const response = await fetch(imageUrl);
                    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
                    const inputBuffer = Buffer.from(await response.arrayBuffer());
                    const tf = layer.transform || {};
                    const targetW = Math.max(1, Math.round(tf.width || width));
                    const targetH = Math.max(1, Math.round(tf.height || height));
                    const rotation = tf.rotation || 0;

                    let imgSharp = sharp(inputBuffer).resize(targetW, targetH, { fit: 'fill' });
                    if (tf.flipX) imgSharp = imgSharp.flop();
                    if (tf.flipY) imgSharp = imgSharp.flip();
                    if (rotation !== 0) {
                        imgSharp = imgSharp.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
                    }

                    const processedBuffer = await imgSharp.toBuffer();
                    return {
                        input: processedBuffer,
                        left: Math.round(tf.x || 0),
                        top: Math.round(tf.y || 0),
                    };
                } catch (err) {
                    console.error(`[CompositorExecutor] Layer ${layer.name} failed:`, err);
                    return null;
                }
            }),
        );

        const overlays = layerResults.filter(
            (o): o is { input: Buffer; left: number; top: number } => o !== null,
        );
        if (overlays.length > 0) baseCanvas = baseCanvas.composite(overlays);

        let finalBuffer: Buffer;
        let contentType: string;
        if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
            finalBuffer = await baseCanvas.jpeg({ quality: Math.round(outputQuality * 100) }).toBuffer();
            contentType = 'image/jpeg';
        } else if (outputFormat === 'webp') {
            finalBuffer = await baseCanvas.webp({ quality: Math.round(outputQuality * 100) }).toBuffer();
            contentType = 'image/webp';
        } else {
            finalBuffer = await baseCanvas.png().toBuffer();
            contentType = 'image/png';
        }

        const supabase = createServiceClient();
        const ext = outputFormat === 'jpg' ? 'jpg' : outputFormat === 'jpeg' ? 'jpeg' : outputFormat === 'webp' ? 'webp' : 'png';
        const filename = `${context.executionId}/${context.nodeId}/compositor_${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
            .from('workflow-ephemeral-tmp')
            .upload(filename, finalBuffer, { contentType, cacheControl: '3600' });
        if (uploadError) {
            return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
        }

        const { data: urlData } = supabase.storage.from('workflow-ephemeral-tmp').getPublicUrl(filename);

        const result: ImageObject = {
            url: urlData.publicUrl,
            resolution: { width, height },
            metadata: { format: outputFormat, source: 'Compositor', processedBy: 'ServerSharp' },
        };

        return { success: true, data: [result] };
    } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : 'Compositor failed' };
    }
};

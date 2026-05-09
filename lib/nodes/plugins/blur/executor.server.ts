import sharp from 'sharp';
import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { BlurConfig } from './definition';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Blur server executor.
 *
 * Behavior preserved from the previous lib/workflow/handlers.ts handleBlur:
 *   - Reads imageUrl from inputs.image
 *   - Uses config.radius directly (no UI rescale, no type switch)
 *   - Uploads the result PNG to the workflow-ephemeral-tmp bucket
 *   - Returns NodeExecutionResult with data: [ImageObject]
 */
export const blurExecutor = async (
    config: BlurConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const imageUrl = inputs?.image;
        if (!imageUrl || typeof imageUrl !== 'string') {
            return { success: false, data: null, error: 'Blur node requires "image" input' };
        }

        const radius = (config?.radius ?? 5) as number;

        console.log(`[BlurExecutor] Applying blur with radius ${radius} to ${imageUrl}`);

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            return { success: false, data: null, error: `Failed to fetch image: ${imageResponse.statusText}` };
        }
        const inputBuffer = Buffer.from(await imageResponse.arrayBuffer());

        const outputBuffer = await sharp(inputBuffer).blur(radius).toBuffer({ resolveWithObject: true });
        const meta = await sharp(outputBuffer.data).metadata();

        const supabase = createServiceClient();
        const filename = `${context.executionId}/${context.nodeId}/blur_${Date.now()}.png`;

        const { error: uploadError } = await supabase.storage
            .from('workflow-ephemeral-tmp')
            .upload(filename, outputBuffer.data, { contentType: 'image/png', cacheControl: '3600' });
        if (uploadError) {
            return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
        }

        const { data: urlData } = supabase.storage.from('workflow-ephemeral-tmp').getPublicUrl(filename);

        const result: ImageObject = {
            url: urlData.publicUrl,
            resolution: { width: meta.width || 0, height: meta.height || 0 },
            metadata: {
                format: meta.format || 'png',
                size: outputBuffer.info.size,
                hasTransparency: meta.hasAlpha || false,
            },
        };

        return { success: true, data: [result] };
    } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : 'Unknown blur error' };
    }
};

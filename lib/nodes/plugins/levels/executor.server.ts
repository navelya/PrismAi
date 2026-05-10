import sharp from 'sharp';
import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { LevelsConfig } from './definition';
import { applyLutInPlace, buildLevelsLut } from './shared';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Levels server executor.
 *
 * Decodes input to raw RGBA, applies a precomputed 256-entry LUT to the
 * RGB channels (alpha untouched), re-encodes PNG, uploads to
 * workflow-ephemeral-tmp.
 */
export const levelsExecutor = async (
    config: LevelsConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const imageUrl = inputs?.image;
        if (!imageUrl || typeof imageUrl !== 'string') {
            return { success: false, data: null, error: 'Levels node requires "image" input' };
        }

        const black = config?.black_point ?? 0;
        const white = config?.white_point ?? 255;
        const gamma = config?.gamma ?? 1.0;

        console.log(
            `[LevelsExecutor] black=${black} white=${white} gamma=${gamma} url=${imageUrl}`,
        );

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            return {
                success: false,
                data: null,
                error: `Failed to fetch image: ${imageResponse.statusText}`,
            };
        }
        const inputBuffer = Buffer.from(await imageResponse.arrayBuffer());

        const raw = await sharp(inputBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const { width, height } = raw.info;
        const pixels = new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
        const lut = buildLevelsLut(black, white, gamma);
        applyLutInPlace(pixels, lut);

        const outputBuffer = await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
            raw: { width, height, channels: 4 },
        })
            .png()
            .toBuffer({ resolveWithObject: true });

        const meta = await sharp(outputBuffer.data).metadata();

        const supabase = createServiceClient();
        const filename = `${context.executionId}/${context.nodeId}/levels_${Date.now()}.png`;

        const { error: uploadError } = await supabase.storage
            .from('workflow-ephemeral-tmp')
            .upload(filename, outputBuffer.data, { contentType: 'image/png', cacheControl: '3600' });
        if (uploadError) {
            return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
        }

        const { data: urlData } = supabase.storage
            .from('workflow-ephemeral-tmp')
            .getPublicUrl(filename);

        const result: ImageObject = {
            url: urlData.publicUrl,
            resolution: { width: meta.width || 0, height: meta.height || 0 },
            metadata: {
                format: meta.format || 'png',
                size: outputBuffer.info.size,
                hasTransparency: meta.hasAlpha || false,
            },
        };

        console.log(`[LevelsExecutor] uploaded ${result.url} (${meta.width}x${meta.height})`);

        return { success: true, data: [result] };
    } catch (err) {
        return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : 'Unknown levels error',
        };
    }
};

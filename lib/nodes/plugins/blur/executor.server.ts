import sharp from 'sharp';
import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { BlurConfig, BlurType } from './definition';
import { createServiceClient } from '@/lib/supabase/service';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';

/**
 * Blur server executor.
 *
 * Branches on detected media type:
 *   - image → Sharp .blur(radius), upload PNG, return ImageObject envelope.
 *   - video → ffmpeg-wasm with `gblur=sigma=radius` filter, upload MP4,
 *     return a video envelope. ffmpeg is lazy-imported so image-only runs
 *     don't pay the cold-start cost of loading the wasm bundle.
 */
export const blurExecutor = async (
    config: BlurConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const mediaUrl = inputs?.image;
        if (!mediaUrl || typeof mediaUrl !== 'string') {
            return { success: false, data: null, error: 'Blur node requires "image" input (image or video URL)' };
        }

        // Match the client's slider→sigma mapping (see plugins/blur/shared.ts).
        // The slider stores 0–100; effective sigma is half that on both client
        // (CSS `blur(Npx)`) and server (sharp/ffmpeg sigma). Keeps the live
        // preview visually consistent with the committed render.
        const rawRadius = (config?.radius ?? 5) as number;
        const sigma = Math.max(0, rawRadius) / 2;
        const type: BlurType = (config?.type ?? 'gaussian') as BlurType;
        const kind = detectMediaTypeFromUrl(mediaUrl) ?? 'image';

        if (kind === 'video') {
            return blurVideo(mediaUrl, sigma, type, context);
        }

        return blurImage(mediaUrl, sigma, type, context);
    } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : 'Unknown blur error' };
    }
};

async function blurImage(
    imageUrl: string,
    sigma: number,
    type: BlurType,
    context: ExecutionContext,
): Promise<NodeExecutionResult> {
    console.log(`[BlurExecutor:image] Applying ${type} blur with sigma ${sigma} to ${imageUrl}`);

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
        return { success: false, data: null, error: `Failed to fetch image: ${imageResponse.statusText}` };
    }
    const inputBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // sharp.blur(sigma) — Gaussian standard deviation. Matches the CSS
    // `blur(Npx)` units used on the client (with the /2 mapping above).
    // Type-specific colour adjustments mirror the client's CSS filter
    // additions (see blurStyle in component.tsx), so the committed render
    // matches the live preview's "box" / "stack" flavours.
    let pipeline = sharp(inputBuffer).blur(sigma);
    if (type === 'box') {
        // Client: contrast(1.15) brightness(1.05) saturate(1.1)
        // sharp.linear(a, b) does output = a*input + b (per-channel). To get
        // contrast(1.15) centered on mid-grey: a=1.15, b=-0.15*128 ≈ -19.2.
        pipeline = pipeline
            .linear(1.15, -19.2)
            .modulate({ brightness: 1.05, saturation: 1.1 });
    } else if (type === 'stack') {
        // Client: saturate(0.8) opacity(0.9). Opacity is dropped server-side
        // — it's a CSS compositing concept, not meaningful for a baked
        // image output without a known background to blend against.
        pipeline = pipeline.modulate({ saturation: 0.8 });
    }
    const outputBuffer = await pipeline.toBuffer({ resolveWithObject: true });
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
}

async function blurVideo(
    videoUrl: string,
    sigma: number,
    type: BlurType,
    context: ExecutionContext,
): Promise<NodeExecutionResult> {
    console.log(`[BlurExecutor:video] Applying ${type} blur with sigma ${sigma} to ${videoUrl}`);

    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { fetchFile } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();
    try {
        await ffmpeg.load();
    } catch (err) {
        return {
            success: false,
            data: null,
            error: `ffmpeg-wasm failed to load on this deployment. Video blur unavailable. (${err instanceof Error ? err.message : 'unknown'})`,
        };
    }

    const inputName = 'input.mp4';
    const outputName = 'out.mp4';

    try {
        const data = await fetchFile(videoUrl);
        await ffmpeg.writeFile(inputName, data);
    } catch (err) {
        return {
            success: false,
            data: null,
            error: `Failed to fetch video for blur: ${err instanceof Error ? err.message : 'unknown'}`,
        };
    }

    // Compose video filters: blur first, then optional type-specific eq
    // adjustments that mirror the client's CSS approximations.
    //   box   = blur + contrast(1.15) brightness(1.05) saturate(1.1)
    //   stack = blur + saturate(0.8) (opacity dropped — see note in blurImage)
    // ffmpeg's eq filter: brightness is additive (-1..1, 0 = unchanged),
    // contrast and saturation are multiplicative (1 = unchanged). CSS
    // brightness is multiplicative — approximating 1.05 with an additive
    // +0.05 is close enough for these stylistic flavours.
    const filters: string[] = [`gblur=sigma=${sigma}`];
    if (type === 'box') {
        filters.push('eq=contrast=1.15:brightness=0.05:saturation=1.1');
    } else if (type === 'stack') {
        filters.push('eq=saturation=0.8');
    }

    const args = [
        '-i', inputName,
        '-vf', filters.join(','),
        '-c:a', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputName,
    ];

    console.log(`[BlurExecutor:video] running ffmpeg: ${args.join(' ')}`);

    try {
        await ffmpeg.exec(args);
    } catch (err) {
        return {
            success: false,
            data: null,
            error: `ffmpeg blur failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        };
    }

    let outputBuffer: Uint8Array;
    try {
        outputBuffer = (await ffmpeg.readFile(outputName)) as Uint8Array;
    } catch (err) {
        return {
            success: false,
            data: null,
            error: `ffmpeg produced no output: ${err instanceof Error ? err.message : 'unknown error'}`,
        };
    }

    const supabase = createServiceClient();
    const filename = `${context.executionId}/${context.nodeId}/blur_${Date.now()}.mp4`;

    const { error: uploadError } = await supabase.storage
        .from('workflow-ephemeral-tmp')
        .upload(filename, Buffer.from(outputBuffer), { contentType: 'video/mp4', cacheControl: '3600' });
    if (uploadError) {
        return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
    }

    const { data: urlData } = supabase.storage.from('workflow-ephemeral-tmp').getPublicUrl(filename);

    return {
        success: true,
        data: [
            {
                url: urlData.publicUrl,
                metadata: {
                    format: 'mp4',
                    size: outputBuffer.byteLength,
                    processedBy: 'ServerFFmpegWasm',
                },
            },
        ],
    };
}

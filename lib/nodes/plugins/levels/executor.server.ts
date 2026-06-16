import sharp from 'sharp';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { LevelsConfig } from './definition';
import { applyLutInPlace, buildLevelsLut, levelsLutrgbExpr } from './shared';
import { createServiceClient } from '@/lib/supabase/service';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { uploadEphemeralResult } from '../utils/ephemeral';

/**
 * Levels server executor.
 *
 * Branches on detected media type:
 *   - image → decode to raw RGBA, apply a precomputed 256-entry LUT to the RGB
 *     channels (alpha untouched), re-encode PNG, upload.
 *   - video → fluent-ffmpeg + @ffmpeg-installer/ffmpeg with an exact `lutrgb`
 *     per-component expression mirroring the same LUT math, upload MP4. ffmpeg
 *     modules are lazy-imported so image-only runs don't pay the cold-start
 *     cost of resolving the static binary path. Mirrors plugins/blur.
 */
export const levelsExecutor = async (
    config: LevelsConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const mediaUrl = inputs?.image;
        if (!mediaUrl || typeof mediaUrl !== 'string') {
            return { success: false, data: null, error: 'Levels node requires "image" input (image or video URL)' };
        }

        const black = config?.black_point ?? 0;
        const white = config?.white_point ?? 255;
        const gamma = config?.gamma ?? 1.0;

        console.log(
            `[LevelsExecutor] black=${black} white=${white} gamma=${gamma} url=${mediaUrl}`,
        );

        const kind = detectMediaTypeFromUrl(mediaUrl) ?? 'image';
        if (kind === 'video') {
            return levelsVideo(mediaUrl, black, white, gamma, context);
        }
        return levelsImage(mediaUrl, black, white, gamma, context);
    } catch (err) {
        return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : 'Unknown levels error',
        };
    }
};

async function levelsImage(
    imageUrl: string,
    black: number,
    white: number,
    gamma: number,
    context: ExecutionContext,
): Promise<NodeExecutionResult> {
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

    const result = await uploadEphemeralResult(context, outputBuffer.data, {
        prefix: 'levels',
        extension: 'png',
        contentType: 'image/png',
        resolution: { width: meta.width || 0, height: meta.height || 0 },
        metadata: {
            format: meta.format || 'png',
            size: outputBuffer.info.size,
            hasTransparency: meta.hasAlpha || false,
        }
    });

    console.log(`[LevelsExecutor:image] uploaded ${result.data?.[0]?.url || 'unknown'} (${meta.width}x${meta.height})`);

    return result;
}

async function levelsVideo(
    videoUrl: string,
    black: number,
    white: number,
    gamma: number,
    context: ExecutionContext,
): Promise<NodeExecutionResult> {
    console.log(`[LevelsExecutor:video] black=${black} white=${white} gamma=${gamma} url=${videoUrl}`);

    // Lazy import — keep the still path from pulling fluent-ffmpeg + the ffmpeg
    // binary into cold-start memory for image-only workflows.
    const ffmpegLib = await import('fluent-ffmpeg');
    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
    const ffmpeg = ffmpegLib.default;
    ffmpeg.setFfmpegPath(ffmpegInstaller.default.path);

    // Stage input + output in /tmp (the only writable area in the Vercel/AWS
    // Lambda function sandbox).
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'levels-'));
    const inputPath = path.join(tmpDir, 'in.mp4');
    const outputPath = path.join(tmpDir, 'out.mp4');

    try {
        const resp = await fetch(videoUrl);
        if (!resp.ok) {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
            return { success: false, data: null, error: `Failed to fetch video: HTTP ${resp.status}` };
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        await fs.writeFile(inputPath, buf);
    } catch (err) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return {
            success: false,
            data: null,
            error: `Failed to fetch video for levels: ${err instanceof Error ? err.message : 'unknown'}`,
        };
    }

    // Exact levels via lutrgb — the same per-component expression mirrors
    // buildLevelsLut, so the rendered video matches stills and the live preview.
    const expr = levelsLutrgbExpr(black, white, gamma);
    const lutrgb = `lutrgb=r='${expr}':g='${expr}':b='${expr}'`;

    try {
        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
                .videoFilters(lutrgb)
                .audioCodec('copy')
                .outputOptions(['-movflags', '+faststart'])
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .save(outputPath);
        });
    } catch (err) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return {
            success: false,
            data: null,
            error: `ffmpeg levels failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        };
    }

    let outputBuffer: Buffer;
    try {
        outputBuffer = await fs.readFile(outputPath);
    } catch (err) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return {
            success: false,
            data: null,
            error: `ffmpeg produced no output: ${err instanceof Error ? err.message : 'unknown error'}`,
        };
    }

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    return uploadEphemeralResult(context, outputBuffer, {
        prefix: 'levels',
        extension: 'mp4',
        contentType: 'video/mp4',
        metadata: {
            format: 'mp4',
            size: outputBuffer.byteLength,
            processedBy: 'ServerFluentFfmpeg',
        }
    });
}

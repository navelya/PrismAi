import sharp from 'sharp';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ExecutionContext, NodeExecutionResult } from '../../types';
import { ExtractFrameConfig } from './definition';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { uploadEphemeralResult } from '../utils/ephemeral';

/**
 * Extract Frame server executor.
 *
 * Branches on detected media type:
 *   - video → fluent-ffmpeg + @ffmpeg-installer/ffmpeg: input-seek (`-ss`) to
 *     the requested timestamp, grab one frame (`-frames:v 1`), upload PNG,
 *     return an image envelope. ffprobe (@ffprobe-installer) is used to clamp
 *     the timestamp to the clip length so a frameTime past EOF doesn't yield an
 *     empty output. ffmpeg modules are lazy-imported so the image branch
 *     doesn't pay the cold-start cost of resolving the static binaries.
 *   - image → frame extraction is the identity; re-encode to PNG via Sharp and
 *     upload so downstream gets a stable ephemeral asset.
 *
 * Output is always a single still image (mirrors the static `image` output
 * handle in definition.ts). Mirrors blur's video branch (same ffmpeg stack).
 */
export const extractFrameExecutor = async (
    config: ExtractFrameConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const mediaUrl = inputs?.image;
        if (!mediaUrl || typeof mediaUrl !== 'string') {
            return { success: false, data: null, error: 'Extract Frame node requires "image" input (a video or image URL)' };
        }

        const frameTime = Math.max(0, (config?.frameTime ?? 0) as number);
        const kind = detectMediaTypeFromUrl(mediaUrl) ?? 'video';

        if (kind === 'image') {
            return passthroughImage(mediaUrl, context);
        }
        return extractVideoFrame(mediaUrl, frameTime, context);
    } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : 'Unknown extract-frame error' };
    }
};

async function passthroughImage(
    imageUrl: string,
    context: ExecutionContext,
): Promise<NodeExecutionResult> {
    console.log(`[ExtractFrameExecutor:image] Passing through image (frame extraction is identity): ${imageUrl}`);

    const resp = await fetch(imageUrl);
    if (!resp.ok) {
        return { success: false, data: null, error: `Failed to fetch image: ${resp.statusText}` };
    }
    const inputBuffer = Buffer.from(await resp.arrayBuffer());
    const outputBuffer = await sharp(inputBuffer).png().toBuffer({ resolveWithObject: true });
    const meta = await sharp(outputBuffer.data).metadata();

    return uploadEphemeralResult(context, outputBuffer.data, {
        prefix: 'extract_frame',
        extension: 'png',
        contentType: 'image/png',
        resolution: { width: meta.width || 0, height: meta.height || 0 },
        metadata: {
            format: meta.format || 'png',
            size: outputBuffer.info.size,
            source: 'ExtractFrame',
            processedBy: 'ServerSharpPassthrough',
        },
    });
}

async function extractVideoFrame(
    videoUrl: string,
    frameTime: number,
    context: ExecutionContext,
): Promise<NodeExecutionResult> {
    console.log(`[ExtractFrameExecutor:video] Extracting frame at ${frameTime}s from ${videoUrl}`);

    // Lazy import — keep the image branch from pulling fluent-ffmpeg + the
    // ffmpeg/ffprobe binaries into cold-start memory.
    const ffmpegLib = await import('fluent-ffmpeg');
    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
    const ffprobeInstaller = await import('@ffprobe-installer/ffprobe');
    const ffmpeg = ffmpegLib.default;
    ffmpeg.setFfmpegPath(ffmpegInstaller.default.path);
    ffmpeg.setFfprobePath(ffprobeInstaller.default.path);

    // Stage input + output in /tmp (the only writable filesystem area in the
    // Vercel/Lambda function sandbox).
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extract-frame-'));
    const inputPath = path.join(tmpDir, 'in.mp4');
    const outputPath = path.join(tmpDir, 'frame.png');

    try {
        try {
            const resp = await fetch(videoUrl);
            if (!resp.ok) {
                return { success: false, data: null, error: `Failed to fetch video: HTTP ${resp.status}` };
            }
            const buf = Buffer.from(await resp.arrayBuffer());
            await fs.writeFile(inputPath, buf);
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `Failed to fetch video for frame extraction: ${err instanceof Error ? err.message : 'unknown'}`,
            };
        }

        // Probe duration so a frameTime past the end clamps to the last frame
        // instead of producing an empty output.
        const duration = await probeDuration(ffmpeg, inputPath).catch(() => 0);
        const seekTime = duration > 0 ? Math.min(frameTime, Math.max(0, duration - 0.05)) : frameTime;

        try {
            await new Promise<void>((resolve, reject) => {
                ffmpeg(inputPath)
                    // Input seek (`-ss` before `-i`) is fast — it jumps to the
                    // nearest keyframe before decoding the single output frame.
                    .seekInput(seekTime)
                    .outputOptions(['-frames:v', '1'])
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err))
                    .save(outputPath);
            });
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `ffmpeg frame extraction failed: ${err instanceof Error ? err.message : 'unknown error'}`,
            };
        }

        let outputBuffer: Buffer;
        try {
            outputBuffer = await fs.readFile(outputPath);
        } catch (err) {
            return {
                success: false,
                data: null,
                error: `ffmpeg produced no frame: ${err instanceof Error ? err.message : 'unknown error'}`,
            };
        }

        const meta = await sharp(outputBuffer).metadata();

        return uploadEphemeralResult(context, outputBuffer, {
            prefix: 'extract_frame',
            extension: 'png',
            contentType: 'image/png',
            resolution: { width: meta.width || 0, height: meta.height || 0 },
            metadata: {
                format: 'png',
                size: outputBuffer.byteLength,
                source: 'ExtractFrame',
                processedBy: 'ServerFluentFfmpeg',
                frameTime: seekTime,
            },
        });
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Probe a video's duration (seconds) via ffprobe (bundled by
 * @ffprobe-installer). Returns 0 when unknown. Mirrors the compositor's
 * probeVideoStreams helper.
 */
function probeDuration(ffmpeg: any, filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err: Error | null, data: any) => {
            if (err) {
                reject(err);
                return;
            }
            const duration = data?.format?.duration;
            resolve(typeof duration === 'number' ? duration : 0);
        });
    });
}

import { ImageObject } from '../../types';
import { ClientExecutor } from '../../core/types';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { LevelsConfig } from './definition';
import { applyLutInPlace, buildLevelsLut } from './shared';

/**
 * Browser-only Levels Executor.
 *
 * Loads the upstream image, applies the same 256-entry LUT used server-side
 * to the canvas's ImageData (RGB only, alpha untouched), returns a data URL.
 */
const computeLevelsDataUrl = async (
    config: LevelsConfig,
    imageUrl: string,
): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            resolve(null);
            return;
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            try {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const lut = buildLevelsLut(
                    config.black_point ?? 0,
                    config.white_point ?? 255,
                    config.gamma ?? 1.0,
                );
                applyLutInPlace(imageData.data, lut);
                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (e) {
                console.error('[clientLevelsExecutor] Failed to process image (likely CORS taint):', e);
                resolve(null);
            }
        };

        img.onerror = () => {
            console.error('[clientLevelsExecutor] Failed to load image');
            resolve(null);
        };

        const safeUrl = imageUrl.startsWith('data:')
            ? imageUrl
            : imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'notaint=1';

        img.src = safeUrl;
    });
};

/**
 * Generic-shape adapter for the auto-compute pipeline.
 * Mirrors the blur plugin's pattern.
 */
export const levelsClientExecutor: ClientExecutor<LevelsConfig> = async (config, inputs) => {
    const upstream = inputs.image;
    if (upstream === undefined || upstream === null) return null;

    const normalized = toLegacyRenderableOutput(upstream);
    const first = Array.isArray(normalized) ? normalized[0] : normalized;
    let imageUrl: string | null = null;
    if (typeof first === 'string') imageUrl = first;
    else if (first && typeof first === 'object' && typeof (first as any).url === 'string') {
        imageUrl = (first as any).url;
    }
    if (!imageUrl) return null;

    const dataUrl = await computeLevelsDataUrl(config, imageUrl);
    if (!dataUrl) return null;

    return { type: 'image', data: [{ url: dataUrl }] as ImageObject[] };
};

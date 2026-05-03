import { ImageObject } from '../../types';
import { ClientExecutor } from '../../core/types';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { BlurConfig } from './types';

/**
 * Browser-only Blur Executor
 * Uses Canvas API + CSS filters for instant live previews.
 */
export const clientBlurExecutor = async (
    config: BlurConfig,
    imageUrl: string
): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    const { radius = 5 } = config;

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

            // Apply CSS blur filter to canvas
            ctx.filter = `blur(${radius}px)`;
            ctx.drawImage(img, 0, 0);

            // Convert to data URL
            try {
                const dataUrl = canvas.toDataURL('image/png');
                resolve(dataUrl);
            } catch (e) {
                console.error('[clientBlurExecutor] Failed to get data URL (likely CORS taint):', e);
                resolve(null);
            }
        };

        img.onerror = () => {
            console.error('[clientBlurExecutor] Failed to load image');
            resolve(null);
        };

        // Add cache-busting for CORS
        const safeUrl = imageUrl.startsWith('data:') 
            ? imageUrl 
            : imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'notaint=1';
        
        img.src = safeUrl;
    });
};

/**
 * Generic-shape adapter for the auto-compute pipeline.
 *
 * Pulls the first image URL from whatever the upstream produced (envelope,
 * legacy ImageObject, raw string), runs the blur, and wraps the result back
 * into an envelope so downstream consumers can read it via the same
 * `nodeOutputs[id]` interface they use for source/server-executed nodes.
 */
export const blurClientExecutor: ClientExecutor<BlurConfig> = async (config, inputs) => {
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

    const dataUrl = await clientBlurExecutor(config, imageUrl);
    if (!dataUrl) return null;

    return { type: 'image', data: [{ url: dataUrl }] as ImageObject[] };
};

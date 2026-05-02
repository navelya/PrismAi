import { ImageObject } from '../../types';
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

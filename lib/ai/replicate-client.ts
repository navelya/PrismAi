import Replicate from 'replicate';

/**
 * Replicate Client Configuration
 * Centralized instance for Replicate API access.
 */
if (!process.env.REPLICATE_API_TOKEN) {
    console.warn('[Replicate] Warning: REPLICATE_API_TOKEN is not set in environment.');
}

export const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN || '',
});

/**
 * Replicate Webhook Signing Secret
 * Used to verify signatures in webhook routes.
 */
export const REPLICATE_WEBHOOK_SIGNING_SECRET = process.env.REPLICATE_WEBHOOK_SIGNING_SECRET || '';

/**
 * Helper to normalize Replicate outputs into a consistent image/text format.
 * Handles both single values and arrays of images/strings.
 */
export const normalizeReplicateOutput = (rawOutput: any) => {
    if (!rawOutput) return null;

    const normalizeItem = (item: any) => {
        if (!item) return null;

        // 1. If it's a string (common for Replicate images/text)
        if (typeof item === 'string') {
            // Check if it looks like a URL
            if (item.startsWith('http')) {
                return { url: item };
            }
            return { text: item };
        }

        // 2. If it's an object with a .url() method (Replicate File objects)
        if (typeof item === 'object' && typeof item.url === 'function') {
            return { url: item.url().toString() };
        }

        // 3. If it's already in our internal format
        if (item.url || item.text) {
            return item;
        }

        // 4. Default JSON fallback
        return { data: item };
    };

    if (Array.isArray(rawOutput)) {
        return rawOutput.map(normalizeItem).filter(Boolean);
    }
    
    return normalizeItem(rawOutput);
};

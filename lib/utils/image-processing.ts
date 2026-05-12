/**
 * Converts a file to WebP format using client-side canvas, targeting a 5MB ceiling.
 *
 * Strategy:
 *   1. Encode at quality 0.8 → if ≤ 5MB, return.
 *   2. Retry at 0.6, then 0.4.
 *   3. If still oversized, scale longest edge to 4096px and retry 0.8 → 0.6 → 0.4.
 *   4. If even that fails, throw `ImageTooLargeError`.
 *
 * @param file The input file (image)
 * @returns Promise<Blob> The WebP blob, guaranteed ≤ 5MB on success.
 */
const TARGET_IMAGE_BYTES = 5 * 1024 * 1024;
const QUALITY_LADDER = [0.8, 0.6, 0.4] as const;
const MAX_LONGEST_EDGE = 4096;

export class ImageTooLargeError extends Error {
    constructor() {
        super('Image too large, even after compression');
        this.name = 'ImageTooLargeError';
    }
}

function decodeFileToImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });
}

function encodeCanvasToWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('WebP conversion failed'));
            },
            'image/webp',
            quality
        );
    });
}

function drawToCanvas(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not supported');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
}

async function encodeAtNaturalSize(img: HTMLImageElement): Promise<Blob | null> {
    const canvas = drawToCanvas(img, img.width, img.height);
    for (const quality of QUALITY_LADDER) {
        const blob = await encodeCanvasToWebP(canvas, quality);
        if (blob.size <= TARGET_IMAGE_BYTES) return blob;
    }
    return null;
}

async function encodeAtScaledSize(img: HTMLImageElement): Promise<Blob | null> {
    const longest = Math.max(img.width, img.height);
    // Cap to MAX_LONGEST_EDGE if larger; otherwise halve so small-but-dense images
    // (line art, dense screenshots) still get a meaningful compression pass.
    const scale = longest > MAX_LONGEST_EDGE ? MAX_LONGEST_EDGE / longest : 0.5;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = drawToCanvas(img, w, h);
    for (const quality of QUALITY_LADDER) {
        const blob = await encodeCanvasToWebP(canvas, quality);
        if (blob.size <= TARGET_IMAGE_BYTES) return blob;
    }
    return null;
}

export async function convertImageToWebP(file: File): Promise<Blob> {
    const img = await decodeFileToImage(file);

    const naturalResult = await encodeAtNaturalSize(img);
    if (naturalResult) return naturalResult;

    const scaledResult = await encodeAtScaledSize(img);
    if (scaledResult) return scaledResult;

    throw new ImageTooLargeError();
}

// Counter for unique filenames within the same millisecond
let fileCounter = 0;

export interface UploadOptions {
    extension?: string;     // e.g. 'webp' | 'mp4' | 'mov'. Defaults to 'webp'.
    contentType?: string;   // e.g. 'image/webp' | 'video/mp4'. Defaults to 'image/webp'.
}

/**
 * Uploads a blob to Supabase Storage and returns path and public URL.
 * Defaults to webp/image-webp for backwards compatibility with existing image callers.
 *
 * @param file The blob to upload
 * @param userId User ID for folder organization
 * @param supabase Supabase client instance
 * @param options Optional extension + MIME type overrides
 * @returns Object with { path, publicUrl }
 */
export async function uploadImageToStorage(
    file: Blob,
    userId: string,
    supabase: any,
    options: UploadOptions = {}
): Promise<{ path: string, publicUrl: string }> {
    const extension = options.extension ?? 'webp';
    const contentType = options.contentType ?? 'image/webp';

    const timestamp = Date.now();
    fileCounter = (fileCounter + 1) % 1000;
    const random = Math.random().toString(36).substring(7);
    const filename = `${userId}/${timestamp}-${fileCounter}-${random}.${extension}`;

    const { data, error } = await supabase.storage
        .from('chat-assets')
        .upload(filename, file, {
            contentType,
            upsert: false
        });

    if (error) {
        console.error("Upload failed", error);
        throw error;
    }

    const publicUrl = supabase.storage.from('chat-assets').getPublicUrl(data.path).data.publicUrl;
    return { path: data.path, publicUrl };
}

/**
 * Uploads a base64 data URL to Supabase Storage.
 * @param base64DataUrl The base64 image string (data:image/...)
 * @param userId User ID for folder organization
 * @param supabase Supabase client instance
 * @returns Object with { path, publicUrl }
 */
export async function uploadBase64ToStorage(base64DataUrl: string, userId: string, supabase: any): Promise<{ path: string, publicUrl: string }> {
    // Convert base64 to Blob
    const res = await fetch(base64DataUrl);
    const blob = await res.blob();
    return uploadImageToStorage(blob, userId, supabase);
}

/**
 * Extracts all images from a workflow result, downloads them, and saves to storage.
 * - Base64 images: Upload to storage
 * - HTTP URLs: Download and upload to storage
 * - blob: URLs: Skip (temporary, won't persist)
 * 
 * @param result The workflow execution result (typically ImageObject[])
 * @param userId User ID for storage organization
 * @param supabase Supabase client instance
 * @returns Object with { uploadedPaths: string[], processedResult: any }
 */
export async function extractAndUploadResultImages(
    result: any,
    userId: string,
    supabase: any
): Promise<{ uploadedPaths: string[], processedResult: any }> {
    const imagePaths: string[] = [];

    async function processValue(value: any): Promise<any> {
        if (!value) return value;

        // Handle ImageObject format: { url: "...", resolution: {...}, metadata: {...} }
        if (typeof value === 'object' && !Array.isArray(value) && typeof value.url === 'string') {
            const url = value.url;

            // Base64 image - upload to storage
            if (url.startsWith('data:image/')) {
                try {
                    const { path, publicUrl } = await uploadBase64ToStorage(url, userId, supabase);
                    imagePaths.push(path);

                    return { ...value, url: publicUrl }; // Use public URL for display
                } catch (e) {
                    console.error('Failed to upload base64 image:', e);
                    return value;
                }
            }

            // HTTP URL - download and save to storage
            if (url.startsWith('http://') || url.startsWith('https://')) {
                try {

                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
                    const blob = await response.blob();
                    const { path, publicUrl } = await uploadImageToStorage(blob, userId, supabase);
                    imagePaths.push(path);

                    return { ...value, url: publicUrl }; // Use public URL for display
                } catch (e) {
                    console.error('Failed to download/upload HTTP image:', e);
                    // Fall back to keeping the URL if download fails
                    imagePaths.push(url);
                    return value;
                }
            }

            // Blob URL - skip (temporary, can't persist)
            if (url.startsWith('blob:')) {

                return value;
            }

            // Storage path already - add to paths
            if (!url.startsWith('data:') && !url.startsWith('http') && !url.startsWith('blob:')) {
                if (!imagePaths.includes(url)) {
                    imagePaths.push(url);
                }
                return value;
            }

            return value;
        }

        // Handle arrays (including ImageObject[]) - SEQUENTIAL processing to prevent race conditions
        if (Array.isArray(value)) {
            const newArray = [];
            for (const item of value) {
                newArray.push(await processValue(item));
            }
            return newArray;
        }

        // Handle other objects recursively
        if (typeof value === 'object') {
            const processed: any = {};
            for (const [key, val] of Object.entries(value)) {
                processed[key] = await processValue(val);
            }
            return processed;
        }

        // Primitives - return as-is
        return value;
    }

    const processedResult = await processValue(JSON.parse(JSON.stringify(result))); // Deep copy to avoid mutation

    return { uploadedPaths: imagePaths, processedResult };
}

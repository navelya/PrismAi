/**
 * Converts a file to WebP format using client-side canvas.
 * @param file The input file (image)
 * @param quality Quality from 0 to 1 (default 0.8)
 * @returns Promise<Blob> The WebP blob
 */
export async function convertImageToWebP(file: File, quality = 0.8): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Canvas context not supported'));
                return;
            }
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('WebP conversion failed'));
                },
                'image/webp',
                quality
            );
        };
        img.onerror = (err) => reject(err);
        img.src = URL.createObjectURL(file);
    });
}

/**
 * Downscale an image File client-side and return it as base64 (data: prefix
 * stripped), ready to embed in a JSON request body.
 *
 * The longest edge is capped at `maxEdge` (images already smaller are never
 * upscaled) and the result is re-encoded as JPEG. This keeps the payload small
 * and predictable regardless of the source file size — a 9 MB+ photo collapses
 * to well under 1.5 MB of base64, comfortably under the API route body limit
 * that would otherwise reject the request (and fail silently).
 *
 * @param file    The input image file.
 * @param maxEdge Max length (px) of the longest edge (default 1536).
 * @param quality JPEG quality from 0 to 1 (default 0.85).
 */
export async function downscaleImageToBase64(
    file: File,
    maxEdge = 1536,
    quality = 0.85,
): Promise<{ mimeType: string; data: string }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const longest = Math.max(img.width, img.height);
            const scale = longest > maxEdge ? maxEdge / longest : 1;
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Canvas context not supported'));
                return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            const comma = dataUrl.indexOf(',');
            resolve({ mimeType: 'image/jpeg', data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl });
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not read the image file'));
        };
        img.src = objectUrl;
    });
}

/**
 * Downscale an image File client-side and return it as a re-encoded File,
 * ready to append to a FormData upload.
 *
 * Same sizing rules as {@link downscaleImageToBase64} — the longest edge is
 * capped at `maxEdge` (never upscaled) and the result is re-encoded as WebP —
 * but it yields a binary File (not base64) so a multipart upload stays small.
 * A full-res photo that would otherwise blow past the API route body limit
 * (a silent 413 "Content Too Large") collapses to a thumbnail-sized payload.
 *
 * @param file    The input image file.
 * @param maxEdge Max length (px) of the longest edge (default 1024).
 * @param quality WebP quality from 0 to 1 (default 0.85).
 */
export async function downscaleImageToFile(
    file: File,
    maxEdge = 1024,
    quality = 0.85,
): Promise<File> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const longest = Math.max(img.width, img.height);
            const scale = longest > maxEdge ? maxEdge / longest : 1;
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Canvas context not supported'));
                return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error('Image downscale failed'));
                        return;
                    }
                    const base = file.name.replace(/\.[^.]+$/, '') || 'thumbnail';
                    resolve(new File([blob], `${base}.webp`, { type: 'image/webp' }));
                },
                'image/webp',
                quality,
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not read the image file'));
        };
        img.src = objectUrl;
    });
}

// Counter for unique filenames within the same millisecond
let fileCounter = 0;

/**
 * Uploads a file to Supabase Storage and returns path and public URL.
 * @param file The file or blob to upload
 * @param userId User ID for folder organization
 * @param supabase Supabase client instance
 * @returns Object with { path, publicUrl }
 */
export async function uploadImageToStorage(file: Blob, userId: string, supabase: any): Promise<{ path: string, publicUrl: string }> {
    // Generate unique filename
    const timestamp = Date.now();
    fileCounter = (fileCounter + 1) % 1000;
    const random = Math.random().toString(36).substring(7);
    const filename = `${userId}/${timestamp}-${fileCounter}-${random}.webp`;

    const { data, error } = await supabase.storage
        .from('chat-assets')
        .upload(filename, file, {
            contentType: 'image/webp',
            upsert: false
        });

    if (error) {
        console.error("Upload failed", error);
        throw error;
    }

    // Get public URL
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

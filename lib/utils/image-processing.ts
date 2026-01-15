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
 * Uploads a file to Supabase Storage and returns path and public URL.
 * @param file The file or blob to upload
 * @param userId User ID for folder organization
 * @param supabase Supabase client instance
 * @returns Object with { path, publicUrl }
 */
export async function uploadImageToStorage(file: Blob, userId: string, supabase: any): Promise<{ path: string, publicUrl: string }> {
    // Generate unique filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const filename = `${userId}/${timestamp}-${random}.webp`;

    const { data, error } = await supabase.storage
        .from('chat-assets')
        .upload(filename, file, {
            contentType: 'image/webp',
            upsert: false
        });

    if (error) {
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
                    console.log('[DEBUG] Uploaded base64 image, path:', path);
                    return { ...value, url: publicUrl }; // Use public URL for display
                } catch (e) {
                    console.error('Failed to upload base64 image:', e);
                    return value;
                }
            }

            // HTTP URL - download and save to storage
            if (url.startsWith('http://') || url.startsWith('https://')) {
                try {
                    console.log('[DEBUG] Downloading HTTP image:', url.substring(0, 80));
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
                    const blob = await response.blob();
                    const { path, publicUrl } = await uploadImageToStorage(blob, userId, supabase);
                    imagePaths.push(path);
                    console.log('[DEBUG] Uploaded HTTP image, publicUrl:', publicUrl);
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
                console.log('[DEBUG] Skipping blob URL (temporary)');
                return value;
            }

            // Storage path already - add to paths
            if (!url.startsWith('data:') && !url.startsWith('http') && !url.startsWith('blob:')) {
                imagePaths.push(url);
                return value;
            }

            return value;
        }

        // Handle arrays (including ImageObject[])
        if (Array.isArray(value)) {
            return Promise.all(value.map(item => processValue(item)));
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

    const processedResult = await processValue(result);
    console.log('[DEBUG] Total image paths collected:', imagePaths.length);
    return { uploadedPaths: imagePaths, processedResult };
}

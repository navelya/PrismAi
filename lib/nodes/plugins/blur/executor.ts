import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { BlurConfig } from './types';

/**
 * Blur Executor
 * Handles blur both in-browser (Canvas API + CSS filter) and on-server (Sharp library).
 */
export const blurExecutor = async (
    config: BlurConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { radius = 5 } = config;

        // Validate input
        const imageInput = input?.image;
        if (!imageInput) {
            return {
                success: false,
                data: null,
                error: 'No image input connected. Connect an image to the Blur node.',
            };
        }

        // Extract URL from input (could be ImageObject or direct URL)
        const imageUrl = typeof imageInput === 'string' 
            ? imageInput 
            : (imageInput as ImageObject)?.url;

        if (!imageUrl) {
            return {
                success: false,
                data: null,
                error: 'Invalid image input format.',
            };
        }

        const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

        if (isBrowser) {
            // --- BROWSER EXECUTION (Live Preview) ---
            return new Promise((resolve) => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    resolve({ success: false, data: null, error: 'Failed to create canvas context.' });
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
                    const dataUrl = canvas.toDataURL('image/png');

                    const result: ImageObject = {
                        url: dataUrl,
                        resolution: {
                            width: img.width,
                            height: img.height,
                        },
                        metadata: {
                            format: 'png',
                            hasTransparency: true,
                        }
                    };

                    resolve({
                        success: true,
                        data: [result],
                    });
                };

                img.onerror = () => {
                    resolve({
                        success: false,
                        data: null,
                        error: 'Failed to load image for blur.',
                    });
                };

                // Add cache-busting for CORS
                const safeUrl = imageUrl.startsWith('data:') 
                    ? imageUrl 
                    : imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'notaint=1';
                
                img.src = safeUrl;
            });
        } else {
            // --- SERVER EXECUTION (Sharp library) ---
            const sharp = (await import('sharp')).default;

            // Fetch the image
            const response = await fetch(imageUrl);
            if (!response.ok) {
                return {
                    success: false,
                    data: null,
                    error: `Failed to fetch image: ${response.statusText}`,
                };
            }

            const arrayBuffer = await response.arrayBuffer();
            const inputBuffer = Buffer.from(arrayBuffer);

            // Apply blur with Sharp
            const outputBuffer = await sharp(inputBuffer)
                .blur(radius)
                .toBuffer({ resolveWithObject: true });

            // Get image metadata
            const metadata = await sharp(outputBuffer.data).metadata();

            // Upload to tmp storage
            const { createServiceClient } = await import('@/lib/supabase/service');
            const supabase = createServiceClient();

            const timestamp = Date.now();
            const filename = `${context.executionId}/${context.nodeId}/blur_${timestamp}.png`;

            const { error: uploadError } = await supabase.storage
                .from('workflow-ephemeral-tmp')
                .upload(filename, outputBuffer.data, {
                    contentType: 'image/png',
                    cacheControl: '3600',
                });

            if (uploadError) {
                return {
                    success: false,
                    data: null,
                    error: `Failed to upload result: ${uploadError.message}`,
                };
            }

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('workflow-ephemeral-tmp')
                .getPublicUrl(filename);

            const result: ImageObject = {
                url: urlData.publicUrl,
                resolution: {
                    width: metadata.width || 0,
                    height: metadata.height || 0,
                },
                metadata: {
                    format: metadata.format || 'png',
                    size: outputBuffer.info.size,
                    hasTransparency: metadata.hasAlpha || false,
                }
            };

            return {
                success: true,
                data: [result],
            };
        }
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Unknown error occurred during blur',
        };
    }
};

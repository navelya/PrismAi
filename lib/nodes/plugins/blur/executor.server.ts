import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { BlurConfig } from './types';

/**
 * Blur Executor
 * Handles blur both in-browser (Canvas API + CSS filter) and on-server (Sharp library).
 * 
 * Logic aligns with UI: 0-100 radius maps to 0-20px absolute blur.
 */
export const blurExecutor = async (
    config: BlurConfig & { type?: 'gaussian' | 'box' | 'stack' },
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { radius = 5, type = 'gaussian' } = config;
        
        // Align with UI mapping: 100% = 20px
        const MAX_PX_BLUR = 20;
        const pxRadius = (radius / 100) * MAX_PX_BLUR;

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

                    // Apply style approximations used in the UI preview
                    let filter = `blur(${pxRadius}px)`;
                    if (type === 'box') {
                        filter += ' contrast(1.15) brightness(1.05) saturate(1.1)';
                    } else if (type === 'stack') {
                        filter += ' saturate(0.8) opacity(0.9)';
                    }

                    ctx.filter = filter;
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

            // Configure Sharp pipeline
            let pipeline = sharp(inputBuffer);

            // Handle blur types natively in Sharp where possible
            if (pxRadius > 0.3) { // Sharp blur requires radius >= 0.3
                if (type === 'box') {
                    // Box blur approximation in Sharp: kernel size based blur
                    // Sharp's blur kernel isn't exposed directly, but we can simulate the UI "look"
                    pipeline = pipeline.blur(pxRadius).modulate({ brightness: 1.05, saturation: 1.1 }).linear(1.15, -0.075);
                } else if (type === 'stack') {
                    // Stack blur approximation in Sharp
                    pipeline = pipeline.blur(pxRadius).modulate({ saturation: 0.8 }).removeAlpha(); // Simulating the flatter look
                } else {
                    // Standard Gaussian
                    pipeline = pipeline.blur(pxRadius);
                }
            }

            const outputBuffer = await pipeline.toBuffer({ resolveWithObject: true });

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

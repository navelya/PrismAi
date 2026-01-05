import {
    NodeExecutor,
    NodeConfig,
    ExecutionContext,
    NodeExecutionResult,
    ImageObject,
    ScrapeImagesConfig,
    RemoveBackgroundConfig,
    FilterSortConfig,
    AIGenerateImageConfig,
    UpscaleImageConfig,
} from './types';

// Backend URL - uses environment variable in production, localhost in development
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

/**
 * Scrape Images Node
 * Searches Google Images using Custom Search API
 */
const scrapeImagesExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const scrapeConfig = config as ScrapeImagesConfig;
        const {
            searchTerm,
            limit,
            sources,
            imageSize,
            imageType,
            colorType,
            safeSearch,
        } = scrapeConfig;

        // Dynamically import to avoid bundling issues
        const { searchGoogleImages } = await import('../api/google-images');

        // Search Google Images
        const images = await searchGoogleImages({
            searchTerm,
            limit,
            sources,
            imageSize,
            imageType,
            colorType,
            safeSearch,
        });

        // Convert to ImageObject format
        const imageObjects: ImageObject[] = images.map(img => ({
            url: img.url,
            resolution: {
                width: img.width || 800,
                height: img.height || 600,
            },
            metadata: {
                title: img.title,
                source: img.source,
                format: img.format,
                size: img.size,
            },
        }));

        return {
            success: true,
            data: imageObjects,
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to scrape images',
        };
    }
};

/**
 * Remove Background Node
 * Removes background from images using Python rembg backend
 */
const removeBackgroundExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const images = input as ImageObject[];

        if (!Array.isArray(images)) {
            throw new Error('Input must be an array of images');
        }

        // Process images in parallel
        const processedImages = await Promise.all(
            images.map(async (img, index) => {
                try {
                    // Fetch the original image
                    const response = await fetch(img.url);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch image: ${response.statusText}`);
                    }
                    const blob = await response.blob();

                    // Send to Python backend for background removal
                    const formData = new FormData();
                    formData.append('file', blob, `image-${index}.jpg`);

                    const bgRemovalResponse = await fetch(`${BACKEND_URL}/remove-background`, {
                        method: 'POST',
                        body: formData,
                    });

                    if (!bgRemovalResponse.ok) {
                        throw new Error(`Background removal failed: ${bgRemovalResponse.statusText}`);
                    }

                    // Get processed image
                    const processedBlob = await bgRemovalResponse.blob();

                    // Convert to base64 for display (server-side)
                    const arrayBuffer = await processedBlob.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

                    return {
                        ...img,
                        url: base64, // Base64 data URL for display
                        metadata: {
                            ...img.metadata,
                            format: 'png',
                            hasTransparency: true,
                            processedBy: 'rembg',
                        },
                    };
                } catch (error) {
                    // Return original image if processing fails (don't break the whole workflow)
                    return img;
                }
            })
        );

        return {
            success: true,
            data: processedImages,
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to remove backgrounds',
        };
    }
};

/**
 * Filter/Sort Node
 * Filters and sorts image arrays based on criteria
 */
const filterSortExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { criteria, order, limit } = config as FilterSortConfig;
        let images = [...(input as ImageObject[])];

        if (!Array.isArray(images)) {
            throw new Error('Input must be an array');
        }

        // Sort based on criteria
        images.sort((a, b) => {
            let compareValue = 0;

            switch (criteria) {
                case 'resolution':
                    const aRes = a.resolution.width * a.resolution.height;
                    const bRes = b.resolution.width * b.resolution.height;
                    compareValue = aRes - bRes;
                    break;
                case 'size':
                    compareValue = (a.metadata?.size || 0) - (b.metadata?.size || 0);
                    break;
                case 'format':
                    compareValue = (a.metadata?.format || '').localeCompare(b.metadata?.format || '');
                    break;
            }

            return order === 'asc' ? compareValue : -compareValue;
        });

        // Apply limit if specified
        if (limit && limit > 0) {
            images = images.slice(0, limit);
        }

        return {
            success: true,
            data: images,
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to filter/sort',
        };
    }
};

/**
 * AI Generate Image Node
 * Generates images using Pollinations.ai (free, unlimited)
 */
const aiGenerateImageExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { prompt, aspectRatio = '1:1' } = config as AIGenerateImageConfig;

        // Determine dimensions based on aspect ratio
        const [width, height] = aspectRatio === '16:9' ? [1920, 1080] :
            aspectRatio === '4:3' ? [1600, 1200] : [1024, 1024];

        // Use proxy API route to avoid 403 errors from Pollinations.ai
        // Build full URL (works both client-side and server-side)
        const baseUrl = typeof window !== 'undefined'
            ? window.location.origin
            : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

        const proxyUrl = `${baseUrl}/api/image/generate?prompt=${encodeURIComponent(prompt)}&width=${width}&height=${height}`;

        // Fetch the generated image through our proxy
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            throw new Error(`Image generation failed: ${response.status}`);
        }

        const blob = await response.blob();

        if (blob.size === 0) {
            throw new Error('Received empty image from Pollinations.ai');
        }

        // Convert to base64 for display (server-side)
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

        const generatedImage: ImageObject = {
            url: base64, // Base64 data URL for display
            resolution: { width, height },
            metadata: {
                title: `AI Generated: ${prompt}`,
                source: 'Pollinations.ai',
                format: 'png',
                generatedBy: 'Pollinations.ai (AI)',
                prompt,
            },
        };

        return {
            success: true,
            data: [generatedImage],
        };
    } catch (error) {
        console.error('❌ AI Image Generation Error:', error);
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to generate image',
        };
    }
};

/**
 * Upscale Image Node
 * Upscales images using Real-ESRGAN AI model
 */
const upscaleImageExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    console.log('🔍 Upscale executor called');
    console.log('Config:', config);
    console.log('Input:', input);
    console.log('Input type:', typeof input);
    console.log('Is array:', Array.isArray(input));

    try {
        const { scale = 4 } = config as UpscaleImageConfig;
        const images = input as ImageObject[];

        console.log('Scale:', scale);
        console.log('Images count:', images?.length);

        if (!Array.isArray(images)) {
            const errorMsg = 'Input must be an array of images';
            console.error('❌', errorMsg);
            throw new Error(errorMsg);
        }

        if (images.length === 0) {
            console.warn('⚠️ No images to upscale');
            return {
                success: true,
                data: [],
            };
        }

        console.log(`📤 Starting upscale for ${images.length} images at ${scale}x`);

        // Process images in parallel
        const upscaledImages = await Promise.all(
            images.map(async (img, index) => {
                try {
                    // Fetch the original image
                    const response = await fetch(img.url);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch image: ${response.statusText}`);
                    }
                    const blob = await response.blob();

                    // Send to Python backend for upscaling
                    const formData = new FormData();
                    formData.append('file', blob, `image-${index}.jpg`);
                    formData.append('scale', scale.toString());

                    const upscaleResponse = await fetch(`${BACKEND_URL}/upscale`, {
                        method: 'POST',
                        body: formData,
                    });

                    if (!upscaleResponse.ok) {
                        throw new Error(`Upscaling failed: ${upscaleResponse.statusText}`);
                    }

                    // Get upscaled image
                    const processedBlob = await upscaleResponse.blob();

                    // Convert to base64 for display (server-side)
                    const arrayBuffer = await processedBlob.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

                    return {
                        ...img,
                        url: base64, // Base64 data URL for display
                        resolution: {
                            width: img.resolution.width * scale,
                            height: img.resolution.height * scale,
                        },
                        metadata: {
                            ...img.metadata,
                            processedBy: `Real-ESRGAN (${scale}x upscale)`,
                        },
                    };
                } catch (error) {
                    // Log detailed error
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error(`❌ Failed to upscale image ${index}:`, errorMessage);
                    console.error('Full error:', error);

                    // Throw error to fail the node properly
                    throw new Error(`Image ${index} upscaling failed: ${errorMessage}`);
                }
            })
        );

        return {
            success: true,
            data: upscaledImages,
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to upscale images',
        };
    }
};

/**
 * Node Registry
 * Maps node types to their executor functions
 */
export const nodeRegistry: Record<string, NodeExecutor> = {
    scrape_images: scrapeImagesExecutor,
    remove_background: removeBackgroundExecutor,
    filter_sort: filterSortExecutor,
    ai_generate_image: aiGenerateImageExecutor,
    upscale_image: upscaleImageExecutor,
};

/**
 * Get executor for a node type
 */
export function getNodeExecutor(nodeType: string): NodeExecutor | null {
    return nodeRegistry[nodeType] || null;
}

/**
 * Node metadata for UI display
 */
export const nodeMetadata = {
    scrape_images: {
        label: 'Scrape Images',
        description: 'Search and fetch images from the web',
        color: '#667eea',
        icon: 'Search',
    },
    remove_background: {
        label: 'Remove Background',
        description: 'Remove backgrounds from images',
        color: '#f093fb',
        icon: 'Scissors',
    },
    filter_sort: {
        label: 'Filter & Sort',
        description: 'Filter and sort image arrays',
        color: '#4ade80',
        icon: 'ArrowUpDown',
    },
    ai_generate_image: {
        label: 'AI Generate',
        description: 'Generate images with AI',
        color: '#fbbf24',
        icon: 'Sparkles',
    },
    upscale_image: {
        label: 'Upscale Image',
        description: 'AI-powered image super-resolution (2x/4x)',
        color: '#ec4899',
        icon: 'Maximize2',
    },
};

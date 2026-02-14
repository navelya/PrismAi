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
    MergeImageConfig,
    MediaInputConfig,
    CompositorConfig,
    CompositorLayer,
} from './types';

// Backend URL - uses environment variable in production, localhost in development
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
// Internal API key for authenticating with the Python backend (server-side only)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

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
        // Normalize input to always be an array of images
        let images: ImageObject[] = [];
        if (Array.isArray(input)) {
            images = input;
        } else if (input?.images && Array.isArray(input.images)) {
            images = input.images;
        } else if (input?.url) {
            // Single image object
            images = [input];
        } else {
            throw new Error('Invalid input: expected images array or single image');
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
                        headers: INTERNAL_API_KEY ? { 'Authorization': `Bearer ${INTERNAL_API_KEY}` } : {},
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

        // Normalize input to always be an array of images
        let images: ImageObject[] = [];
        if (Array.isArray(input)) {
            images = [...input];
        } else if (input?.images && Array.isArray(input.images)) {
            // Handle { images: [...] } format from merge node
            images = [...input.images];
        } else if (input?.url) {
            // Single image object
            images = [input];
        } else {
            throw new Error('Invalid input: expected images array or single image');
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
 * Generates images using configurable model providers:
 * - gemini (default): Gemini 2.5 Flash Image via Google AI API
 * - pollinations: Pollinations.ai (free, unlimited, sometimes unreliable)
 * - huggingface: Stable Diffusion XL via Hugging Face Inference API
 */
const aiGenerateImageExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { prompt, model = 'gemini', aspectRatio = '1:1' } = config as AIGenerateImageConfig;

        // Determine dimensions based on aspect ratio (used by Pollinations)
        const [width, height] = aspectRatio === '16:9' ? [1920, 1080] :
            aspectRatio === '4:3' ? [1600, 1200] : [1024, 1024];

        // Build base URL (works both client-side and server-side)
        const baseUrl = typeof window !== 'undefined'
            ? window.location.origin
            : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

        // Route to correct proxy based on model
        let proxyUrl: string;
        let sourceName: string;

        switch (model) {
            case 'pollinations':
                proxyUrl = `${baseUrl}/api/image/generate?prompt=${encodeURIComponent(prompt)}&width=${width}&height=${height}`;
                sourceName = 'Pollinations.ai';
                break;
            case 'huggingface':
                proxyUrl = `${baseUrl}/api/image/generate-hf?prompt=${encodeURIComponent(prompt)}`;
                sourceName = 'Stable Diffusion XL (Hugging Face)';
                break;
            default:
                // Gemini models (gemini-2.5-flash-image, gemini-3-pro-image-preview, or legacy 'gemini')
                const geminiModel = model === 'gemini' ? 'gemini-2.5-flash-image' : model;
                proxyUrl = `${baseUrl}/api/image/generate-gemini?prompt=${encodeURIComponent(prompt)}&aspectRatio=${aspectRatio}&model=${geminiModel}`;

                if (model === 'gemini-3-pro-image-preview') sourceName = 'Gemini 3 Pro';
                else if (model === 'gemini-2.5-flash-image') sourceName = 'Nano Banana';
                else sourceName = 'Gemini Imagen';
                break;
        }

        // Fetch the generated image through our proxy
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            const errorBody = await response.text();
            let errorMsg = `Image generation failed (${sourceName}): ${response.status}`;
            try {
                const parsed = JSON.parse(errorBody);
                if (parsed.error) errorMsg = `${sourceName}: ${parsed.error}`;
            } catch { /* use default error */ }
            throw new Error(errorMsg);
        }

        const blob = await response.blob();

        if (blob.size === 0) {
            throw new Error(`Received empty image from ${sourceName}`);
        }

        // Convert to base64 for display
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = blob.type || 'image/png';
        const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;

        const generatedImage: ImageObject = {
            url: base64,
            resolution: { width: model === 'gemini' ? 1024 : width, height: model === 'gemini' ? 1024 : height },
            metadata: {
                title: `AI Generated: ${prompt}`,
                source: sourceName,
                format: mimeType.split('/')[1] || 'png',
                generatedBy: `${sourceName} (AI)`,
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


    try {
        const { scale = 4 } = config as UpscaleImageConfig;

        // Normalize input to always be an array of images
        let images: ImageObject[] = [];
        if (Array.isArray(input)) {
            images = input;
        } else if (input?.images && Array.isArray(input.images)) {
            // Handle { images: [...] } format from merge node
            images = input.images;
        } else if (input?.url) {
            // Single image object
            images = [input];
        } else {
            const errorMsg = 'Invalid input: expected images array or single image';
            console.error('❌', errorMsg, 'Received:', typeof input, input);
            throw new Error(errorMsg);
        }



        if (images.length === 0) {
            console.warn('⚠️ No images to upscale');
            return {
                success: true,
                data: [],
            };
        }



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
                        headers: INTERNAL_API_KEY ? { 'Authorization': `Bearer ${INTERNAL_API_KEY}` } : {},
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
 * Merge Image Node
 * Composites one image (overlay) onto another (base) with positioning and scaling
 * Uses Python backend /merge-images endpoint for server-side image processing
 * 
 * ITERATION BEHAVIOR:
 * - 1-to-1: Single base + single overlay = 1 composite
 * - 1-to-Many (Broadcast): 10 bases + 1 overlay = 10 composites (overlay repeated)
 * - Many-to-Many (Pairwise): 10 bases + 10 overlays = 10 composites (base[i] + overlay[i])
 * 
 * INPUT FORMAT:
 * This node expects input with TWO image sources connected:
 * - Input A (first connection / main input): Base images array
 * - Input B (second connection): Overlay images array
 */
const mergeImageExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const mergeConfig = config as MergeImageConfig;

        // Parse input - workflow engine passes { base: {...}, overlay: {...} }
        // where each can be { images: [...] } or array directly
        let baseImages: ImageObject[] = [];
        let overlayImages: ImageObject[] = [];

        // Helper to extract images from various input formats
        const extractImages = (source: any): ImageObject[] => {
            if (!source) return [];
            if (Array.isArray(source)) return source;
            if (source.images && Array.isArray(source.images)) return source.images;
            if (source.url) return [source]; // Single image object
            return [];
        };

        if (input && typeof input === 'object') {
            if (input.base !== undefined || input.overlay !== undefined) {
                // Structured input from workflow engine: { base: {...}, overlay: {...} }
                baseImages = extractImages(input.base);
                overlayImages = extractImages(input.overlay);
            } else if (Array.isArray(input)) {
                // Single array input - use as base, no overlay
                baseImages = input;
            } else if (input.images) {
                baseImages = Array.isArray(input.images) ? input.images : [input.images];
            }
        }

        if (baseImages.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No base images provided. Connect image source to Input A (Base).',
            };
        }

        if (overlayImages.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No overlay images provided. Connect image source to Input B (Overlay).',
            };
        }



        // Determine iteration mode:
        // - 1 base + N overlays: broadcast base to all overlays → N results
        // - N bases + 1 overlay: broadcast overlay to all bases → N results
        // - N bases + N overlays: pair each base with corresponding overlay → N results
        const isBroadcastOverlay = overlayImages.length === 1 && baseImages.length > 1;
        const isBroadcastBase = baseImages.length === 1 && overlayImages.length > 1;
        const iterationCount = isBroadcastOverlay
            ? baseImages.length
            : isBroadcastBase
                ? overlayImages.length
                : Math.min(baseImages.length, overlayImages.length);



        const mergedImages: ImageObject[] = [];

        for (let i = 0; i < iterationCount; i++) {
            const baseImg = isBroadcastBase ? baseImages[0] : baseImages[i];
            const overlayImg = isBroadcastOverlay ? overlayImages[0] : overlayImages[i];

            try {
                // Fetch both images as blobs
                const [baseResponse, overlayResponse] = await Promise.all([
                    fetch(baseImg.url),
                    fetch(overlayImg.url),
                ]);

                const baseBlob = await baseResponse.blob();
                const overlayBlob = await overlayResponse.blob();

                // Create form data for backend
                const formData = new FormData();
                formData.append('base_file', baseBlob, 'base.png');
                formData.append('overlay_file', overlayBlob, 'overlay.png');
                formData.append('position', mergeConfig.position || 'bottom-right');
                formData.append('overlay_scale', String(mergeConfig.overlayScale || 0.2));
                formData.append('opacity', String(mergeConfig.opacity || 1.0));
                formData.append('padding', String(mergeConfig.padding || 10));

                // Call backend merge endpoint
                const mergeResponse = await fetch(`${BACKEND_URL}/merge-images`, {
                    method: 'POST',
                    body: formData,
                    headers: INTERNAL_API_KEY ? { 'Authorization': `Bearer ${INTERNAL_API_KEY}` } : {},
                });

                if (!mergeResponse.ok) {
                    const errorText = await mergeResponse.text();
                    throw new Error(`Backend error: ${errorText}`);
                }

                // Get merged image as blob
                const mergedBlob = await mergeResponse.blob();

                // Convert blob to Image to get dimensions and resize
                const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const image = new window.Image();
                    image.onload = () => resolve(image);
                    image.onerror = reject;
                    image.src = URL.createObjectURL(mergedBlob);
                });

                // Resize logic (Downgrade resolution standard)
                const MAX_DIMENSION = 1280; // Standardize max dimension like other processing nodes
                let width = img.width;
                let height = img.height;

                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                // Draw to canvas for resizing and base64 conversion
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Failed to get canvas context');

                ctx.drawImage(img, 0, 0, width, height);

                // Get optimized base64 string
                const mergedUrl = canvas.toDataURL('image/png', 0.85);

                mergedImages.push({
                    url: mergedUrl,
                    resolution: {
                        width: width,
                        height: height,
                    },
                    metadata: {
                        processedBy: 'merge_image',
                        source: `Merged: ${baseImg.metadata?.source || 'base'} + ${overlayImg.metadata?.source || 'overlay'}`,
                    },
                });



            } catch (imgError) {
                console.error(`❌ Failed to merge image ${i + 1}:`, imgError);
            }
        }

        if (mergedImages.length === 0) {
            return {
                success: false,
                data: null,
                error: 'Failed to merge any images',
            };
        }

        return {
            success: true,
            data: mergedImages,
        };

    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to merge images',
        };
    }
};

/**
 * Media Input Node
 * Passes manually uploaded images to the next node
 */
const mediaInputExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { images } = config as MediaInputConfig;

        if (!images || images.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No images uploaded. Please add images to the Media Input node.',
            };
        }

        // Convert base64 data URLs to ImageObject format
        const imageObjects: ImageObject[] = images.map((dataUrl, index) => ({
            url: dataUrl,
            resolution: {
                width: 800,  // Placeholder - actual dimensions determined at runtime
                height: 600,
            },
            metadata: {
                title: `Uploaded Image ${index + 1}`,
                source: 'User Upload',
                format: dataUrl.includes('image/png') ? 'png' : 'jpg',
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
            error: error instanceof Error ? error.message : 'Failed to process uploaded images',
        };
    }
};

/**
 * Compositor Node
 * Client-side image compositing with layer control
 * Each layer has a selectedIndex to pick from array inputs
 */
const compositorExecutor: NodeExecutor = async (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const compositorConfig = config as CompositorConfig;
        const {
            canvasWidth = 1920,
            canvasHeight = 1080,
            backgroundColor = '#00000000',
            layers = [],
            outputFormat = 'png',
            outputQuality = 1.0,
        } = compositorConfig;

        if (layers.length === 0) {
            return {
                success: false,
                data: null,
                error: 'No layers configured. Add at least one layer to the Compositor.',
            };
        }

        // Check if we're in browser environment (client-side rendering)
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return {
                success: false,
                data: null,
                error: 'Compositor requires browser environment for rendering.',
            };
        }

        // Create offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            return {
                success: false,
                data: null,
                error: 'Failed to create canvas context.',
            };
        }

        // Set background color
        if (backgroundColor && backgroundColor !== '#00000000') {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }

        // Render each visible layer (bottom to top)
        // Layer transforms are in canvas-absolute coordinates — use directly
        for (const layer of layers) {
            if (!layer.visible) continue;

            // Get source images from input (keyed by handle ID)
            const handleInputs = input as Record<string, ImageObject[] | ImageObject>;
            const sourceData = handleInputs[layer.sourceHandleId];

            if (!sourceData) continue;

            // Handle array or single image
            const sourceArray = Array.isArray(sourceData) ? sourceData : [sourceData];
            const imageData = sourceArray[layer.selectedIndex] || sourceArray[0];

            if (!imageData?.url) continue;

            // Load image
            const img = await loadImage(imageData.url);

            // Apply transform directly (canvas-absolute coordinates)
            ctx.save();
            const { x, y, width, height, rotation, opacity, flipX, flipY } = layer.transform;

            ctx.globalAlpha = opacity;
            ctx.translate(x + width / 2, y + height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
            ctx.drawImage(img, -width / 2, -height / 2, width, height);
            ctx.restore();
        }

        // Generate output data URL
        const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' :
            outputFormat === 'webp' ? 'image/webp' : 'image/png';
        const dataUrl = canvas.toDataURL(mimeType, outputQuality);

        return {
            success: true,
            data: [{
                url: dataUrl,
                resolution: {
                    width: canvasWidth,
                    height: canvasHeight,
                },
                metadata: {
                    title: 'Compositor Output',
                    source: 'Compositor Cube',
                    format: outputFormat,
                },
            }],
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to composite images',
        };
    }
};

// Helper function to load an image from URL/base64
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src.substring(0, 50)}...`));
        img.src = src;
    });
}

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
    merge_image: mergeImageExecutor,
    media_input: mediaInputExecutor,
    compositor: compositorExecutor,
};

/**
 * Get executor for a node type
 */
export function getNodeExecutor(nodeType: string): NodeExecutor | null {
    return nodeRegistry[nodeType] || null;
}

/**
 * Node metadata for UI display
 * 
 * GENERIC INPUT HANDLES:
 * - `inputs` array defines all input handles for the node
 * - If not specified, defaults to single input handle
 * - Each input has: id (handle ID), label (display name), color (handle color)
 */
export const nodeMetadata: Record<string, {
    label: string;
    description: string;
    color: string;
    icon: string;
    inputs?: Array<{ id: string; label: string; color: string }>;
    dynamicInputs?: boolean;
}> = {
    scrape_images: {
        label: 'Scrape Images',
        description: 'Search and fetch images from the web',
        color: '#667eea',
        icon: 'Search',
        // No inputs - this is a source node
    },
    remove_background: {
        label: 'Remove Background',
        description: 'Remove backgrounds from images',
        color: '#f093fb',
        icon: 'Scissors',
        // Single default input (handled by CustomNode)
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
        // No inputs - this is a source node (prompt-based)
    },
    upscale_image: {
        label: 'Upscale Image',
        description: 'AI-powered image super-resolution (2x/4x)',
        color: '#ec4899',
        icon: 'Maximize2',
    },
    merge_image: {
        label: 'Merge Image',
        description: 'Composite overlay onto base image',
        color: '#14b8a6',
        icon: 'Layers',
        // TWO input handles for base and overlay
        inputs: [
            { id: 'base', label: 'BASE', color: '#22c55e' },
            { id: 'overlay', label: 'OVER', color: '#f59e0b' },
        ],
    },
    media_input: {
        label: 'Media Input',
        description: 'Upload images manually',
        color: '#3b82f6',
        icon: 'ImagePlus',
        // No inputs - this is a source node (manual upload)
    },
    compositor: {
        label: 'Compositor',
        description: 'Layer-based image compositing',
        color: '#8b5cf6',
        icon: 'Layers2',
        // Dynamic inputs - handled by CompositorNode
        dynamicInputs: true,
    },
};

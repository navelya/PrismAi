import { ExecutionContext, NodeExecutionResult, ScrapeImagesConfig, ImageObject } from '../../types';

// Backend URL - uses environment variable in production, localhost in development
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
// Internal API key for authenticating with the Python backend (server-side only)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export const scrapeImagesExecutor = async (
    config: ScrapeImagesConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const scrapeConfig = config;

        // Use dynamically routed text input if available
        // The Prompt node outputs { text: string } OR it could just be a string
        const incomingPromptObj = input?.prompt_in || input?.text || input;
        const dynamicSearchTerm = typeof incomingPromptObj === 'object' ? incomingPromptObj.text : incomingPromptObj;

        const searchTerm = typeof dynamicSearchTerm === 'string' && dynamicSearchTerm.trim() !== '' ? dynamicSearchTerm : (scrapeConfig.searchTerm || 'images');

        const {
            limit,
            sources,
            imageSize,
            imageType,
            colorType,
            safeSearch,
        } = scrapeConfig;

        // Dynamically import to avoid bundling issues targeting node
        const { searchGoogleImages } = await import('../../../api/google-images');

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

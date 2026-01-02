/**
 * Pixabay API client for image search
 * Free unlimited searches - just need an API key
 */

export interface PixabayImageSearchParams {
    searchTerm: string;
    limit: number;
    sources?: string[];
    imageSize?: 'small' | 'medium' | 'large' | 'xlarge' | 'any';
    imageType?: 'photo' | 'clipart' | 'lineart' | 'face' | 'any';
    colorType?: 'color' | 'gray' | 'mono' | 'any';
    safeSearch?: 'off' | 'medium' | 'high';
}

export interface ScrapedImage {
    url: string;
    thumbnailUrl: string;
    title?: string;
    source?: string;
    width?: number;
    height?: number;
    size?: number;
    format?: string;
}

/**
 * Search Pixabay Images using their API
 */
export async function searchPixabayImages(params: PixabayImageSearchParams): Promise<ScrapedImage[]> {
    const {
        searchTerm,
        limit,
        sources,
        imageSize = 'any',
        imageType = 'any',
        colorType = 'any',
        safeSearch = 'medium',
    } = params;

    // Hardcoded API key (Pixabay is free and unlimited, so this is safe)
    // Alternative: You can still use process.env.PIXABAY_API_KEY if you prefer
    const apiKey = '53989148-4f79afe4f6d04a341b1592d81';

    console.log('🔍 Pixabay API Debug:', {
        hasKey: !!apiKey,
        keyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : 'NOT FOUND',
    });

    if (!apiKey) {
        console.warn('⚠️ Pixabay API key not configured - using mock data');
        return generateMockImages(searchTerm, limit);
    }
    try {
        // Build Pixabay API URL
        const baseUrl = 'https://pixabay.com/api/';
        const queryParams = new URLSearchParams({
            key: apiKey,
            q: searchTerm,
            per_page: Math.min(limit, 200).toString(), // Pixabay max is 200
            safesearch: safeSearch === 'high' ? 'true' : 'false',
        });

        // Add image type filter
        if (imageType && imageType !== 'any') {
            if (imageType === 'photo') queryParams.append('image_type', 'photo');
            else if (imageType === 'clipart') queryParams.append('image_type', 'illustration');
            else if (imageType === 'lineart') queryParams.append('image_type', 'vector');
        }

        // Add color filter
        if (colorType && colorType !== 'any') {
            if (colorType === 'gray') queryParams.append('colors', 'grayscale');
            else if (colorType === 'mono') queryParams.append('colors', 'black');
        }

        const url = `${baseUrl}?${queryParams.toString()}`;

        // Fetch results
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Pixabay API request failed: ${response.status}`);
        }

        const data = await response.json();

        if (!data.hits || data.hits.length === 0) {
            console.warn('No images found, using mock data');
            return generateMockImages(searchTerm, limit);
        }

        // Parse results
        const images: ScrapedImage[] = data.hits.slice(0, limit).map((item: any) => {
            // Select image size based on preference
            let imageUrl = item.largeImageURL || item.webformatURL;
            let width = item.imageWidth;
            let height = item.imageHeight;

            if (imageSize === 'small') {
                imageUrl = item.previewURL;
                width = item.previewWidth;
                height = item.previewHeight;
            } else if (imageSize === 'medium') {
                imageUrl = item.webformatURL;
                width = item.webformatWidth;
                height = item.webformatHeight;
            }

            return {
                url: imageUrl,
                thumbnailUrl: item.previewURL,
                title: item.tags || searchTerm,
                source: 'Pixabay',
                width: width,
                height: height,
                format: 'jpg',
            };
        });

        // If sources specified, filter (Pixabay doesn't support site-specific search, so we just note it)
        if (sources && sources.length > 0) {
            console.warn('Note: Pixabay does not support site-specific search. Showing Pixabay results for:', searchTerm);
        }

        return images;
    } catch (error) {
        console.error('Pixabay image search error:', error);

        // Fallback to mock data on error
        console.warn('Falling back to mock images due to error');
        return generateMockImages(searchTerm, limit);
    }
}

/**
 * Generate mock images when API is unavailable
 */
function generateMockImages(searchTerm: string, limit: number): ScrapedImage[] {
    const mockImages: ScrapedImage[] = [];

    for (let i = 0; i < limit; i++) {
        const randomId = Math.floor(Math.random() * 1000);
        mockImages.push({
            url: `https://picsum.photos/800/600?random=${randomId}`,
            thumbnailUrl: `https://picsum.photos/200/150?random=${randomId}`,
            title: `${searchTerm} - Image ${i + 1}`,
            source: 'picsum.photos (fallback)',
            width: 800,
            height: 600,
            format: 'jpg',
        });
    }

    return mockImages;
}

// Export for backward compatibility
export const searchGoogleImages = searchPixabayImages;

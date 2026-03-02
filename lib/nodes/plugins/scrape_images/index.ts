import { NodeSharedDef } from '../../core/types';
import { ScrapeImagesConfig } from '../../types';

export const scrapeImagesSharedDef: NodeSharedDef<ScrapeImagesConfig> = {
    type: 'scrape_images',
    family: 'generative',
    meta: {
        label: 'Scrape Images',
        description: 'Search and fetch images from the web',
        color: '#667eea',
        icon: 'Search',
    },
    handles: {
        inputs: [{ id: 'prompt_in', label: 'Prompt', expectedType: 'text', color: '#94a3b8' }],
        outputs: [{ id: 'images_out', label: 'Images', dataType: 'image_array' }],
    },
    defaultConfig: {
        searchTerm: 'images',
        limit: 10,
        imageSize: 'any',
        imageType: 'any',
        colorType: 'any',
        safeSearch: 'medium',
    },
    aiSchema: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Number of images to fetch' },
            safeSearch: { type: 'string', enum: ['off', 'medium', 'high'] }
        }
    }
};

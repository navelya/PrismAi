import { NodeSharedDef } from '../../core/types';
import { ScrapeImagesConfig } from '../../types';

export const scrapeImagesSharedDef: NodeSharedDef<ScrapeImagesConfig> = {
    type: 'scrape_images',
    family: 'generative',
    category: 'generative',
    creditCost: 1,
    meta: {
        label: 'Scrape Images',
        description: 'Search and fetch images from the web',
        color: '#667eea',
        icon: 'Search',
    },
    handles: {
        inputs: [{ id: 'prompt_in', label: 'Prompt', expectedType: 'text', isMandatory: true, color: '#94a3b8' }],
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
            limit: { type: 'number', description: 'Number of images to fetch. Default to 1 unless user explicitly asks for more images.' },
            imageSize: { type: 'string', enum: ['small', 'medium', 'large', 'xlarge', 'any'], description: 'Filter by image size. Default: any.' },
            imageType: { type: 'string', enum: ['photo', 'clipart', 'lineart', 'face', 'any'], description: 'Filter by image type. Default: any.' },
            safeSearch: { type: 'string', enum: ['off', 'medium', 'high'], description: 'Safe search level. Default: medium.' }
        }
    }
};
